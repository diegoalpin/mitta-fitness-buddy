// Copy of backend/src/types/wire.ts. Keep in sync by hand.
/**
 * The contract between the browser and the backend.
 *
 * RULE (handoff §7.5): nothing in this file may reference a type, field name,
 * or concept from the Anthropic SDK or the MCP connector. When BYOK replaces
 * the connector with a self-hosted MCP client, this file must not change.
 */

/** One turn of conversation. The frontend owns the history and resends it. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Request body for POST /api/chat. */
export interface ChatRequest {
  messages: ChatMessage[];
}

/**
 * A classification of failures the UI renders differently.
 * Deliberately coarse — the UI only needs to know what to tell the user.
 */
export type ChatErrorKind =
  | 'bad_request'        // malformed messages array
  | 'upstream_auth'      // our credentials rejected — an operator problem
  | 'rate_limit'         // the LLM provider is throttling us
  | 'tool_unavailable'   // the MCP server could not be reached
  | 'unknown';

/** Events streamed from POST /api/chat, one per SSE `data:` line. */
export type ChatEvent =
  /** A chunk of assistant prose. Concatenate in arrival order. */
  | { type: 'text'; text: string }
  /** A training-data lookup started. `id` is unique within one response. */
  | { type: 'tool_start'; id: string; name: string }
  /** That lookup finished. `detail` carries a readable message when isError. */
  | { type: 'tool_end'; id: string; name: string; isError: boolean; detail?: string }
  /** The assistant turn is complete. Always the last event on a success path. */
  | { type: 'done' }
  /** Terminal failure. No further events follow. */
  | { type: 'error'; kind: ChatErrorKind; message: string };
