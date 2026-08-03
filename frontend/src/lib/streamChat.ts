import { createLogger, preview } from './log';
import type { ChatEvent, ChatMessage } from '../types/wire';

const log = createLogger('chat');

/**
 * POSTs the conversation and yields backend events as they arrive.
 *
 * No React in this file — it is ordinary async JavaScript, which makes it
 * testable on its own and keeps the hook focused on state.
 *
 * Why not the browser's built-in `EventSource`? It only issues GET requests
 * and cannot send a body. We need to POST the conversation history, so we
 * read the response body stream and parse SSE frames ourselves. That is the
 * standard approach here, not a workaround.
 */
export async function* streamChat(
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const started = Date.now();
  log.info('request', {
    turns: messages.length,
    text: preview(messages[messages.length - 1]?.content ?? ''),
  });

  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (err) {
    // fetch only rejects when the request never completed: backend down, DNS,
    // or the user aborting. Log it here, where we still know it was the POST
    // itself that failed, then let the caller classify it.
    log.error('request failed', {
      ms: Date.now() - started,
      message: (err as Error | undefined)?.message ?? String(err),
    });
    throw err;
  }

  // Set by the backend's requestLog middleware. Grep this id in the backend
  // terminal to see the server's account of this exact request.
  const requestId = res.headers.get('X-Request-Id') ?? undefined;

  log.info('response', { status: res.status, req: requestId, ms: Date.now() - started });

  if (!res.ok || !res.body) {
    // A non-200 means we never got to the SSE stream — a validation failure
    // or the backend being down.
    log.error('no stream', { status: res.status, req: requestId });
    yield {
      type: 'error',
      kind: res.status === 400 ? 'bad_request' : 'unknown',
      message:
        res.status === 400
          ? 'The server rejected that message.'
          : `Could not reach the server (${res.status}). Is the backend running?`,
    };
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  // Mirrors the backend's counters. When the two summaries disagree, the loss
  // is in transport — the proxy or the SSE parse — rather than in the model.
  let firstTextMs: number | undefined;
  let chunks = 0;
  let chars = 0;
  let tools = 0;
  let outcome = 'truncated';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;

      // SSE frames are separated by a blank line. A chunk from the network can
      // split a frame anywhere, so we buffer until we see a complete one.
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of frame.split('\n')) {
          // Lines starting with ':' are comments — our keepalives. Skip them.
          if (!line.startsWith('data:')) continue;

          const event = JSON.parse(line.slice(5).trim()) as ChatEvent;

          switch (event.type) {
            case 'text':
              if (firstTextMs === undefined) {
                firstTextMs = Date.now() - started;
                log.info('first text', { req: requestId, ms: firstTextMs });
              }
              chunks++;
              chars += event.text.length;
              log.debug('text', {
                req: requestId,
                chars: event.text.length,
                text: preview(event.text, 60),
              });
              break;

            case 'tool_start':
              tools++;
              log.info('tool →', { req: requestId, name: event.name });
              break;

            case 'tool_end':
              log.info('tool ←', {
                req: requestId,
                name: event.name,
                failed: event.isError,
              });
              break;

            case 'error':
              outcome = 'error';
              log.error('stream error', {
                req: requestId,
                kind: event.kind,
                message: event.message,
              });
              break;

            case 'done':
              outcome = 'done';
              break;
          }

          yield event;
        }
      }
    }
  } finally {
    // In `finally` because the consumer can abandon this generator mid-stream
    // (the stop button), and an interrupted turn is exactly the one you want
    // a summary for.
    log.info('stream end', {
      req: requestId,
      outcome: signal.aborted ? 'aborted' : outcome,
      ms: Date.now() - started,
      firstTextMs,
      chunks,
      chars,
      tools,
    });
  }
}
