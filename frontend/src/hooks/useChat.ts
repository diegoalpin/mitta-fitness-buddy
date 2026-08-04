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

  // Bumped by reset(). A turn captures this value when it starts and stops
  // writing state the moment it no longer matches — see the guards in run()
  // and the comment on reset() for why that is not optional.
  const generationRef = useRef(0);

  const run = useCallback(async (history: ChatMessage[]) => {
    const generation = generationRef.current;
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
        // A New Chat landed mid-turn. Bail before touching any state: an event
        // arriving between the abort and the throw would otherwise resurrect
        // text the user just discarded.
        if (generationRef.current !== generation) return;

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
        // Same generation check as the finally block: a real failure landing in
        // the same tick as a New Chat must not post its banner to the fresh chat.
        if (generationRef.current === generation) {
          setError({
            kind: 'unknown',
            message: 'The connection dropped. Try again.',
          });
        }
      }
    } finally {
      // A New Chat during this turn bumped the generation. Everything below
      // writes conversation state, and the commit in particular would drop this
      // turn's partial answer into the conversation the user just cleared —
      // aborting a stream unwinds straight through here. Guard as a wrapper
      // rather than an early return: a `return` inside finally would also
      // swallow an in-flight exception.
      if (generationRef.current === generation) {
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

  /**
   * Discards the conversation and starts over. There is no history feature, so
   * this is genuinely destructive — it is deliberately not offered while the
   * chat is already empty.
   *
   * Bumping the generation BEFORE aborting is the whole trick. run()'s finally
   * block commits any accumulated text, and an abort unwinds through it; done
   * in the other order, the dying turn would append half of the old answer to
   * the conversation we just emptied.
   */
  const reset = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;

    setMessages([]);
    setDraft('');
    setActivity([]);
    setError(null);
    setPhase('idle');
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

  return { messages, draft, activity, phase, error, send, stop, retry, reset };
}
