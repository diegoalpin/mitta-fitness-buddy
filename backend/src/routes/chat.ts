import { Router } from 'express';
import type { Response } from 'express';
import { streamChat } from '../llm/chat.js';
import { createLogger, preview } from '../log.js';
import type { ChatEvent, ChatMessage } from '../types/wire.js';

export const chatRouter = Router();

const log = createLogger('chat');

/**
 * Writes one SSE frame. JSON.stringify escapes newlines, so a multi-line
 * message can never accidentally terminate the frame.
 */
function send(res: Response, event: ChatEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

chatRouter.post('/chat', async (req, res) => {
  // Set by the requestLog middleware. Every line below carries it so one
  // request's logs can be pulled out of interleaved output.
  const id = String(res.locals.requestId ?? '-');

  const messages = parseMessages(req.body);

  if (!messages) {
    log.warn('rejected malformed body', { req: id });
    // Reject before any SSE header is written, so the client gets a real
    // status code rather than an error event on a 200 stream.
    res.status(400).json({ error: 'Body must be { messages: [{ role, content }] }' });
    return;
  }

  log.info('request', {
    req: id,
    turns: messages.length,
    text: preview(messages[messages.length - 1]?.content ?? ''),
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Tells nginx-style proxies not to buffer. Harmless if nothing is listening.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // The first token can be 60s away because Render's cold start happens inside
  // the model turn. Comment frames keep intermediaries from closing the socket.
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15_000);

  // If the user navigates away or hits stop, abandon the generator.
  //
  // This MUST be res, not req. On Node 16+ the request stream closes as soon
  // as its body has been read — a few milliseconds into a POST, long before
  // the model answers — so `req.on('close')` fired on every single turn and
  // broke the loop at the first event, returning an empty 200. The response
  // stream is what tracks the socket: a close before we have ended it
  // ourselves is a genuine disconnect.
  let aborted = false;
  res.on('close', () => {
    if (!res.writableEnded) aborted = true;
  });

  // Counters for the one summary line logged when the turn ends. Together they
  // answer "did this request actually produce text, and how fast?" — which a
  // per-event log alone makes you reconstruct by hand.
  const started = Date.now();
  let firstTextMs: number | undefined;
  let chunks = 0;
  let chars = 0;
  let tools = 0;
  let outcome = 'truncated';

  try {
    for await (const event of streamChat(messages)) {
      if (aborted) break;

      switch (event.type) {
        case 'text':
          if (firstTextMs === undefined) {
            firstTextMs = Date.now() - started;
            // Its own line, at info: the gap between `request` and this is the
            // silence the user stares at, and it is where cold starts show up.
            log.info('first text', { req: id, ms: firstTextMs });
          }
          chunks++;
          chars += event.text.length;
          log.debug('text', { req: id, chars: event.text.length, text: preview(event.text, 60) });
          break;

        case 'tool_start':
          tools++;
          log.info('tool →', { req: id, name: event.name });
          break;

        case 'tool_end':
          log.info('tool ←', {
            req: id,
            name: event.name,
            failed: event.isError,
            detail: event.detail ? preview(event.detail, 120) : undefined,
          });
          break;

        case 'error':
          outcome = 'error';
          log.error('stream error', { req: id, kind: event.kind, message: event.message });
          break;

        case 'done':
          outcome = 'done';
          break;
      }

      send(res, event);
    }
  } catch (err) {
    // streamChat yields errors rather than throwing, so reaching here is a bug.
    // Headers are already sent, so a 500 is impossible — send an error event.
    outcome = 'threw';
    log.error('unexpected throw', { req: id, message: String(err) });
    console.error(err);
    if (!aborted) {
      send(res, {
        type: 'error',
        kind: 'unknown',
        message: 'The response failed unexpectedly.',
      });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();

    log.info('response', {
      req: id,
      outcome: aborted ? 'aborted' : outcome,
      ms: Date.now() - started,
      firstTextMs,
      chunks,
      chars,
      tools,
    });
  }
});

/**
 * Narrows an untrusted request body to ChatMessage[], or null if invalid.
 * Everything off req.body is `any`; this is where it becomes typed.
 */
function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== 'object') return null;

  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string' || content.length === 0) return null;
    messages.push({ role, content });
  }

  // The Messages API requires the first turn be from the user.
  if (messages[0]?.role !== 'user') return null;

  return messages;
}
