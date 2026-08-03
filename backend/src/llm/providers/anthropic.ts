import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { buildSystemPrompt } from '../systemPrompt.js';
import type { ChatEvent, ChatMessage } from '../../types/wire.js';

/**
 * THE THROWAWAY BOUNDARY (handoff §4.2).
 *
 * Anthropic's MCP connector has Anthropic's infrastructure connect to our MCP
 * server directly, so this provider needs no MCP client, no tool translation,
 * and no agent loop. That convenience cannot carry a per-user Intervals
 * credential, so BYOK (handoff §7) will rewrite this file against
 * @modelcontextprotocol/sdk's client half — see llm/mcpClient.ts, which the
 * OpenRouter provider already uses.
 *
 * When that happens, ONLY this file changes. It exposes an AsyncGenerator of
 * ChatEvent — a shape with no Anthropic types in it — and nothing else in the
 * codebase imports @anthropic-ai/sdk.
 */

/**
 * Generous, because on Claude Sonnet 5 thinking is ON by default and
 * max_tokens caps thinking AND response text together. A budget sized only for
 * the answer truncates mid-sentence. Training answers are long and tool
 * results are large.
 */
const MAX_TOKENS = 32_000;

/**
 * The connector runs a server-side tool loop; if it hits its iteration limit
 * the turn pauses with stop_reason "pause_turn". We resume by appending the
 * assistant turn and re-sending. Capped so a pathological case cannot spin.
 */
const MAX_RESUMPTIONS = 5;

/** Must match the mcp_toolset's mcp_server_name exactly, or the request 400s. */
const MCP_SERVER_NAME = 'intervals-icu';

const client = new Anthropic({
  apiKey: config.anthropicApiKey,
  // NOTE: the TypeScript SDK takes MILLISECONDS (the Python SDK takes seconds).
  // Anthropic fetches the MCP server, so Render's 30-60s cold start lands
  // INSIDE the model turn. Budget generously.
  timeout: 15 * 60 * 1000,
  // Retrying a long streaming call is worse than failing fast and letting the
  // user resend — a retry restarts the whole turn, cold start included.
  maxRetries: 0,
});

export async function* streamChat(
  messages: ChatMessage[],
): AsyncGenerator<ChatEvent> {
  // The Anthropic message type appears here and nowhere else in the app.
  const turns: Anthropic.Beta.BetaMessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // mcp_tool_result blocks carry only `tool_use_id`, not the tool's name, so
  // we remember the name from the matching mcp_tool_use block to keep the UI
  // badge labelled when the lookup finishes.
  const toolNames = new Map<string, string>();

  try {
    for (let attempt = 0; attempt <= MAX_RESUMPTIONS; attempt++) {
      const stream = client.beta.messages.stream({
        model: config.anthropicModel,
        max_tokens: MAX_TOKENS,
        // Thinking is deliberately not configured: on Claude Sonnet 5 omitting
        // it runs adaptive thinking, which is what we want. Its output stays
        // hidden (display defaults to "omitted"), so nothing leaks to the UI.
        betas: ['mcp-client-2025-11-20'],
        // mcp_servers and the matching mcp_toolset entry are BOTH required.
        // Sending one without the other is a validation error.
        mcp_servers: [
          {
            type: 'url',
            name: MCP_SERVER_NAME,
            url: config.mcpServerUrl,
            authorization_token: config.mcpBearerToken,
          },
        ],
        tools: [{ type: 'mcp_toolset', mcp_server_name: MCP_SERVER_NAME }],
        system: buildSystemPrompt(),
        messages: turns,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block;

          if (config.debugBlocks) console.log('[block]', block.type);

          if (block.type === 'mcp_tool_use') {
            toolNames.set(block.id, block.name);
            yield { type: 'tool_start', id: block.id, name: block.name };
          }

          if (block.type === 'mcp_tool_result') {
            yield {
              type: 'tool_end',
              id: block.tool_use_id,
              name: toolNames.get(block.tool_use_id) ?? 'intervals.icu',
              isError: block.is_error,
              // On a tool error the MCP server returns a readable message, and
              // on a 429 it includes the rate-limit remaining/limit — handoff
              // §5 wants that surfaced.
              detail: block.is_error ? extractText(block.content) : undefined,
            };
          }
        }

        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text', text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();

      if (final.stop_reason !== 'pause_turn') {
        yield { type: 'done' };
        return;
      }

      // Paused mid-turn. Append the assistant turn and re-send to resume.
      // Do NOT inject a "continue" user message — that changes the conversation.
      turns.push({ role: 'assistant', content: final.content });
    }

    yield {
      type: 'error',
      kind: 'unknown',
      message:
        'The assistant kept pausing without finishing. Try asking something narrower.',
    };
  } catch (err) {
    yield toChatEvent(err);
  }
}

/**
 * MCP tool results carry either a plain string or an array of text blocks.
 * Pull a readable string out, truncated — this goes in a one-line UI badge,
 * not a log.
 */
function extractText(content: string | Array<{ text: string }>): string | undefined {
  if (typeof content === 'string') {
    return content.slice(0, 200) || undefined;
  }
  for (const item of content) {
    if (typeof item?.text === 'string' && item.text.length > 0) {
      return item.text.slice(0, 200);
    }
  }
  return undefined;
}

/**
 * Maps a thrown error to the coarse wire-format error kinds. Anthropic's typed
 * exception classes are used here and nowhere else in the app.
 *
 * Note that MCP-server failures usually do NOT reach this function: Anthropic
 * fetches our MCP server, so if it is down the failure surfaces as a tool
 * result with is_error set — a `tool_end` event, not a thrown exception. The
 * OpenRouter provider, which holds the MCP connection itself, does not share
 * that property.
 */
function toChatEvent(err: unknown): ChatEvent {
  // Log the real error server-side; never send internals to the browser.
  console.error('[streamChat:anthropic]', err);

  if (err instanceof Anthropic.AuthenticationError) {
    return {
      type: 'error',
      kind: 'upstream_auth',
      message:
        'The server could not authenticate with Anthropic. Check ANTHROPIC_API_KEY.',
    };
  }

  if (err instanceof Anthropic.RateLimitError) {
    return {
      type: 'error',
      kind: 'rate_limit',
      message: 'Anthropic is rate limiting this key. Wait a moment and try again.',
    };
  }

  if (err instanceof Anthropic.APIConnectionError) {
    return {
      type: 'error',
      kind: 'tool_unavailable',
      message: 'Could not reach Anthropic. Check your network and try again.',
    };
  }

  return {
    type: 'error',
    kind: 'unknown',
    message: 'Something went wrong generating a response. Try again.',
  };
}
