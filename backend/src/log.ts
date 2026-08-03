import { config } from './config.js';
import type { LogLevel } from './config.js';

/**
 * A dependency-free console logger. Every module that logs goes through here
 * so the output has one shape and one level switch (LOG_LEVEL).
 *
 * Lines look like:
 *
 *   14:22:07.418 info  chat  request req=8f3a1c04 turns=3 text="how did my..."
 *
 * That is `key=value` after the message on purpose — it greps cleanly
 * (`| grep req=8f3a1c04` pulls one whole request out of interleaved output)
 * without pulling in a JSON logger we would then have to pretty-print to read.
 *
 * The frontend has a deliberate twin at frontend/src/lib/log.ts that prints the
 * same format to the browser console. Both stamp UTC, so a browser line and a
 * terminal line for the same request can be compared directly.
 */

/** Values render as `key=value`, so keep them scalar. `undefined` is omitted. */
export type Fields = Record<string, string | number | boolean | undefined>;

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = RANK[config.logLevel];

/** UTC time-of-day, matching the frontend logger. Date is noise for local dev. */
function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function render(fields?: Fields): string {
  if (!fields) return '';

  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    // Omitted, not printed as "undefined": an absent field should not look
    // like a field whose value went wrong.
    if (value === undefined) continue;
    // Quote anything with whitespace so `key=value` stays parseable by eye.
    const text =
      typeof value === 'string' && /[\s"=]/.test(value) ? JSON.stringify(value) : value;
    parts.push(`${key}=${text}`);
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
}

export function createLogger(scope: string): Logger {
  function write(level: LogLevel, message: string, fields?: Fields): void {
    if (RANK[level] < threshold) return;

    const line = `${stamp()} ${level.padEnd(5)} ${scope.padEnd(4)} ${message}${render(fields)}`;

    // warn and error go to stderr, so `npm run dev 2> errors.log` separates
    // the failures from the chatter.
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

/**
 * Collapses text to one truncated line for a log field.
 *
 * Logging whole conversation turns would bury the signal and write the user's
 * training data to disk wherever stdout is captured. A preview is enough to
 * confirm the right text arrived.
 */
export function preview(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}
