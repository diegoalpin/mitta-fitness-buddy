import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { createLogger } from '../log.js';

const log = createLogger('http');

/**
 * One line when a request arrives, one when it completes, for every route.
 *
 * Each request also gets a short id, echoed back as X-Request-Id. That header
 * is the point of this middleware: the browser reads it and prints the same id,
 * so a line in DevTools and a line in this terminal can be matched up without
 * inferring it from timestamps. Routes read it off res.locals.requestId to tag
 * their own logs.
 *
 * Note for when this stops being same-origin: the browser can only read
 * X-Request-Id because Vite proxies /api. A cross-origin deployment would need
 * Access-Control-Expose-Headers, at which point the id silently disappears from
 * the frontend logs rather than erroring.
 */
export const requestLog: RequestHandler = (req, res, next) => {
  // Eight hex characters — enough to be unique across a dev session, short
  // enough to eyeball. Not a trace id; nothing downstream consumes it.
  const id = randomUUID().slice(0, 8);
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);

  const started = Date.now();
  log.info(`→ ${req.method} ${req.originalUrl}`, { req: id });

  res.on('finish', () => {
    log.info(`← ${req.method} ${req.originalUrl}`, {
      req: id,
      status: res.statusCode,
      ms: Date.now() - started,
    });
  });

  // 'close' firing after 'finish' is the normal path. 'close' WITHOUT the
  // response having ended means the browser hung up mid-stream — a stopped
  // generation, a reload, or a crashed tab. Worth its own line, because on an
  // SSE route it otherwise looks identical to a slow answer.
  res.on('close', () => {
    if (!res.writableEnded) {
      log.warn(`⨯ ${req.method} ${req.originalUrl}`, {
        req: id,
        ms: Date.now() - started,
        reason: 'client disconnected',
      });
    }
  });

  next();
};
