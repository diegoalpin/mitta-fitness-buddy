import { config } from '../config.js';
import { streamChat as anthropicStreamChat } from './providers/anthropic.js';
import { streamChat as openrouterStreamChat } from './providers/openrouter.js';
import type { ChatEvent, ChatMessage } from '../types/wire.js';

/**
 * The single entry point the HTTP layer sees (handoff §4.2, §7.5 rule 1).
 *
 * Providers are selected once at boot from LLM_PROVIDER. Both emit the same
 * AsyncGenerator<ChatEvent> — a shape with no provider types in it — so
 * routes/chat.ts, the wire format, and the frontend are unaware of which one
 * is running.
 *
 * The two differ enormously underneath: Anthropic's MCP connector runs the
 * tool loop on Anthropic's infrastructure, while OpenRouter needs us to hold
 * the MCP connection and run the loop ourselves. That difference is contained
 * entirely within providers/.
 */

// Resolved at module load, not per request: the provider cannot change without
// a restart, and picking it once keeps the hot path free of branching.
const streamChatImpl =
  config.llmProvider === 'openrouter' ? openrouterStreamChat : anthropicStreamChat;

export function streamChat(messages: ChatMessage[]): AsyncGenerator<ChatEvent> {
  return streamChatImpl(messages);
}
