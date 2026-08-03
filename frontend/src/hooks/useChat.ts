import { useCallback, useRef, useState } from 'react';
import { streamChat } from '../lib/streamChat';
import { createLogger } from '../lib/log';
import type { ChatErrorKind, ChatMessage } from '../types/wire';

const log = createLogger('ui');

/**
 * All conversation state lives here. Components below ChatView take props and
 * hold no state of their own, which is what keeps them easy to reason about.
 *
 * React concepts this file demonstrates, roughly in order:
 *   - useState for values that should cause a re-render
 *   - useRef for a value that must NOT cause one (the abort controller)
 *   - the functional state updater, and why an async loop requires it
 *   - useCallback to keep a function's identity stable across renders
 */

/**
 * Three phases, not a boolean. `waiting` (request sent, nothing back yet) is
 * visually distinct from `streaming` (text arriving), and it is the state that
 * has to survive a 60s cold start without looking broken. Collapsing these
 * into one `isLoading` flag is the mistake that makes the app feel hung.
 */
export type Phase = 'idle' | 'waiting' | 'streaming';

export interface ToolActivity {
  id: string;
  name: string;
  state: 'running' | 'done' | 'failed';
  detail?: string;
}

/** Narrowed from the wire's error event — by the time it is stored we already
 *  know it is an error, so the discriminant is dropped. */
export interface ChatError {
  kind: ChatErrorKind;
  message: string;
}

export function useChat() {
  /** Committed turns only. The in-flight answer is NOT in here — see `draft`. */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** The assistant text streaming in right now. */
  const [draft, setDraft] = useState('');
  /** Tool badges for the in-flight turn. */
  const [activity, setActivity] = useState<ToolActivity[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ChatError | null>(null);

  // A ref, not state: replacing the controller must not trigger a render.
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (history: ChatMessage[]) => {
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('waiting');
    setError(null);
    setDraft('');
    setActivity([]);

    // A local accumulator alongside the `draft` state. State updates are async
    // and batched, so `draft` cannot be read back reliably inside this loop —
    // but we need the full text at the end to commit it.
    let accumulated = '';
    let failed = false;

    try {
      for await (const event of streamChat(history, controller.signal)) {
        switch (event.type) {
          case 'text': {
            accumulated += event.text;
            setPhase('streaming');
            // MUST be the functional form. `setDraft(draft + event.text)` would
            // read the `draft` captured when this callback was created — stale
            // on every iteration after the first — and silently lose text.
            setDraft((prev) => prev + event.text);
            break;
          }

          case 'tool_start': {
            setActivity((prev) => [
              ...prev,
              { id: event.id, name: event.name, state: 'running' },
            ]);
            break;
          }

          case 'tool_end': {
            setActivity((prev) => {
              const next: ToolActivity = {
                id: event.id,
                name: event.name,
                state: event.isError ? 'failed' : 'done',
                detail: event.detail,
              };
              const index = prev.findIndex((a) => a.id === event.id);
              // No match means an event arrived out of order or a block shape
              // surprised us. Append rather than drop — a duplicate badge is a
              // far better bug than one stuck forever on "running".
              if (index === -1) return [...prev, next];
              const copy = [...prev];
              copy[index] = next;
              return copy;
            });
            break;
          }

          case 'error': {
            failed = true;
            setError({ kind: event.kind, message: event.message });
            break;
          }

          case 'done':
            break;
        }
      }
    } catch (err) {
      // An abort is a user action, not a failure. Anything else is real.
      if ((err as Error | undefined)?.name === 'AbortError') {
        log.info('stopped by user');
      } else {
        failed = true;
        log.error('turn failed', { message: (err as Error | undefined)?.message ?? String(err) });
        setError({
          kind: 'unknown',
          message: 'The connection dropped. Try again.',
        });
      }
    } finally {
      abortRef.current = null;

      // Commit whatever text arrived, including on a stop or a mid-stream
      // failure — a partial answer is worth more to the user than nothing.
      if (accumulated.length > 0) {
        setMessages((prev) => [...prev, { role: 'assistant', content: accumulated }]);
      } else if (!failed) {
        // Finished cleanly but said nothing. Better to say so than to render
        // an empty bubble the user cannot tell apart from a rendering bug.
        setError({
          kind: 'unknown',
          message: 'The assistant returned an empty response. Try again.',
        });
      }

      setDraft('');
      setActivity([]);
      setPhase('idle');
    }
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || phase !== 'idle') return;

      const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
      setMessages(next);
      void run(next);
    },
    [messages, phase, run],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    if (phase !== 'idle') return;

    // Resend from the last user turn, dropping any assistant turn after it
    // (a partial answer committed before the failure).
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex === -1) return;

    const history = messages.slice(0, lastUserIndex + 1);
    setMessages(history);
    setError(null);
    void run(history);
  }, [messages, phase, run]);

  return { messages, draft, activity, phase, error, send, stop, retry };
}
