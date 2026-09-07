import { OpenRouter } from '@openrouter/sdk';
import {
  ConnectionError,
  OpenRouterError,
  RequestTimeoutError,
} from '@openrouter/sdk/models/errors';
import type {
  ChatFunctionTool,
  ChatMessages,
  ChatToolCall,
} from '@openrouter/sdk/models';
import { config } from '../../config.js';
import { buildSystemPrompt } from '../systemPrompt.js';
import { callMcpTool, listMcpTools } from '../mcpClient.js';
import type { ChatEvent, ChatMessage } from '../../types/wire.js';

/**
 * THE SELF-HOSTED TOOL LOOP.
 *
 * OpenRouter is a plain chat-completions endpoint — there is no server-side
 * MCP connector to lean on the way providers/anthropic.ts does. So this file
 * owns what Anthropic's infrastructure does for free: fetch the tool
 * catalogue, translate it, run the model, execute the calls it asks for, feed
 * the results back, repeat.
 *
 * It emits exactly the same ChatEvent stream as the Anthropic provider, so the
 * route handler, the wire format, and the frontend cannot tell the two apart.
 *
 * When BYOK lands (handoff §7) this loop is the part that survives — only
 * mcpClient.ts's credential handling changes.
 */

/**
 * Cap on model turns per request. Each round is one model response plus any
 * tools it asked for, so a five-step lookup needs five rounds. Bounded so a
 * model that keeps calling tools without concluding cannot spin forever —
 * the same role MAX_RESUMPTIONS plays on the Anthropic path.
 */
const MAX_TOOL_ROUNDS = 8;

/**
 * The token budget is OPENROUTER_MAX_TOKENS, not a constant here, because what
 * it has to cover depends on the model. A non-reasoning model spends it on the
 * visible answer alone; a reasoning model like openai/gpt-5.6-luna spends it on
 * hidden reasoning first and the answer second. Training answers include
 * markdown tables, so a reasoning model needs room for both.
 *
 * Free-tier models sit behind community capacity and can stall. Fail in
 * minutes rather than hanging the SSE stream indefinitely.
 */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

const client = new OpenRouter({
  apiKey: config.openrouterApiKey,
  timeoutMs: REQUEST_TIMEOUT_MS,
  // Attribution headers. Optional, and OpenRouter uses them for dashboard
  // ranking only — they carry nothing about the athlete.
  appTitle: 'Smart Coach Buddy',
});

/** One tool call being assembled from streamed fragments. */
interface PendingCall {
  id: string;
  name: string;
  /** JSON text, accumulated across deltas. Not parseable until complete. */
  args: string;
}

export async function* streamChat(
  messages: ChatMessage[],
): AsyncGenerator<ChatEvent> {
  try {
    // Isolated from the main try/catch: any failure here is by definition the
    // MCP server being unreachable, which the wire format has a specific kind
    // for. Sniffing the transport's error classes downstream would be less
    // precise — it throws a StreamableHTTPError for an HTTP-level failure
    // (a suspended or sleeping Render service) that looks nothing like an
    // OpenRouter SDK error.
    let tools;
    try {
      tools = await loadTools();
    } catch (err) {
      console.error('[streamChat:openrouter] could not load MCP tools', err);
      yield {
        type: 'error',
        kind: 'tool_unavailable',
        message:
          'The training-data server could not be reached, so no lookups are available. Try again in a moment.',
      };
      return;
    }

    // OpenRouter takes the system prompt as the first message rather than a
    // separate parameter, which is the one shape difference from Anthropic.
    const turns: ChatMessages[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // Tracked across rounds, not within one. A turn that runs tools and then
    // finishes without ever emitting visible text would otherwise reach the
    // UI as a successful `done` with an empty message bubble.
    let emittedText = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.chat.send({
        chatRequest: {
          model: config.openrouterModel,
          messages: turns,
          tools,
          maxTokens: config.openrouterMaxTokens,
          // Omitted entirely unless configured. Sending an effort to a model
          // that does not reason is harmless, but the default model is the
          // Free Router — one request can land on any of several models, and
          // there is no single effort that suits all of them.
          ...(config.openrouterReasoningEffort && {
            reasoningEffort: config.openrouterReasoningEffort,
          }),
          stream: true,
        },
      });

      // send() is typed as "buffered result OR event stream" regardless of the
      // stream flag, so narrow it. Anything else means OpenRouter ignored the
      // flag, which we cannot stream from.
      if (!(Symbol.asyncIterator in response)) {
        yield {
          type: 'error',
          kind: 'unknown',
          message: 'The model returned an unreadable response. Try again.',
        };
        return;
      }

      let assistantText = '';
      let finishReason: string | null = null;
      const pending = new Map<number, PendingCall>();

      for await (const chunk of response) {
        // Mid-stream errors arrive as a payload field, not a thrown exception.
        // Free-tier capacity exhaustion shows up here rather than as an HTTP
        // status, so it must be checked explicitly or the turn ends silently.
        if (chunk.error) {
          console.error('[streamChat:openrouter] stream error', chunk.error);
          yield streamErrorEvent(chunk.error.code, chunk.error.message);
          return;
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        if (config.debugBlocks && choice.finishReason) {
          console.log('[chunk] finish_reason', choice.finishReason);
        }

        const { content, toolCalls } = choice.delta;

        if (content) {
          assistantText += content;
          emittedText = true;
          yield { type: 'text', text: content };
        }

        // delta.reasoning is deliberately dropped. Reasoning models stream
        // their chain of thought in this separate field, and the Anthropic
        // path keeps thinking hidden too — surfacing it here would make the
        // two providers behave differently in the UI.

        for (const fragment of toolCalls ?? []) {
          accumulate(pending, fragment);
        }

        if (choice.finishReason) finishReason = choice.finishReason;
      }

      // Anything other than a tool request ends the turn. `length` means the
      // answer was truncated at MAX_TOKENS; the user still sees the partial
      // text already streamed, so treat it as done rather than an error.
      if (finishReason !== 'tool_calls' || pending.size === 0) {
        if (!emittedText) {
          // The model ended the turn without saying anything visible — most
          // often a reasoning model that spent the turn in `reasoning` and
          // never wrote an answer. On a reasoning model that usually means the
          // token budget went entirely on thinking, which is a config problem
          // rather than a bad question. Reporting it beats a blank message
          // bubble the user cannot distinguish from a hung request.
          yield {
            type: 'error',
            kind: 'unknown',
            message:
              'The model finished without producing an answer. Try rephrasing, or — ' +
              'on a reasoning model — raise OPENROUTER_MAX_TOKENS or lower ' +
              'OPENROUTER_REASONING_EFFORT.',
          };
          return;
        }
        yield { type: 'done' };
        return;
      }

      // Rebuild the assistant turn exactly as the model produced it. Dropping
      // the tool_calls here would orphan the tool results that follow and the
      // next request would 400.
      const calls = [...pending.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call);

      turns.push({
        role: 'assistant',
        content: assistantText || null,
        toolCalls: calls.map(
          (call): ChatToolCall => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.args },
          }),
        ),
      });

      // Run them in order. The MCP server is read-only, so sequential execution
      // costs latency but nothing else, and it keeps the UI badges ordered.
      for (const call of calls) {
        yield { type: 'tool_start', id: call.id, name: call.name };

        const result = await runTool(call);

        yield {
          type: 'tool_end',
          id: call.id,
          name: call.name,
          isError: result.isError,
          // On a tool error the MCP server returns a readable message, and on
          // a 429 it includes the rate-limit remaining/limit — handoff §5
          // wants that surfaced.
          detail: result.isError ? result.text.slice(0, 200) : undefined,
        };

        turns.push({
          role: 'tool',
          toolCallId: call.id,
          content: result.text,
        });
      }
    }

    yield {
      type: 'error',
      kind: 'unknown',
      message:
        'The assistant kept looking things up without finishing. Try asking something narrower.',
    };
  } catch (err) {
    yield toChatEvent(err);
  }
}

/**
 * MCP tool definitions translated to OpenAI-style function tools.
 *
 * MCP's inputSchema is already JSON Schema, so this is a re-wrap rather than a
 * conversion. Names pass through untouched — OpenRouter allows
 * [a-zA-Z0-9_-]{1,64} and the Intervals.icu tools (get_wellness_range and
 * friends) are well inside that.
 */
async function loadTools(): Promise<ChatFunctionTool[]> {
  const tools = await listMcpTools();

  return tools.map(
    (tool): ChatFunctionTool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }),
  );
}

/**
 * Executes one accumulated call.
 *
 * Malformed arguments are returned to the model as an error result rather than
 * thrown: a smaller model emitting slightly-wrong JSON is an ordinary event,
 * and it can usually correct itself on the next round if we tell it what broke.
 */
async function runTool(call: PendingCall): Promise<{ text: string; isError: boolean }> {
  let args: Record<string, unknown>;
  try {
    // An argument-less call streams as "" rather than "{}".
    args = call.args.trim() === '' ? {} : JSON.parse(call.args);
  } catch {
    return {
      text: `Invalid JSON arguments for ${call.name}. Call it again with valid JSON.`,
      isError: true,
    };
  }

  try {
    return await callMcpTool(call.name, args);
  } catch (err) {
    // A transport failure against the MCP server. Report it to the model
    // instead of aborting — it may have other tools worth trying, and the
    // user gets a partial answer rather than a bare error.
    console.error('[streamChat:openrouter] tool call failed', call.name, err);
    return {
      text: `The ${call.name} lookup could not be reached.`,
      isError: true,
    };
  }
}

/**
 * Folds one streamed fragment into the call being assembled.
 *
 * Tool calls arrive split across deltas and keyed by `index`: the id and name
 * land on the first fragment for that index, then `arguments` trickles in as
 * JSON text fragments that are not parseable until the stream ends. This is
 * the fiddly part of OpenAI-style streaming and the reason we use the SDK
 * rather than parsing SSE by hand.
 */
function accumulate(
  pending: Map<number, PendingCall>,
  fragment: { index: number; id?: string | undefined; function?: { name?: string | undefined; arguments?: string | undefined } | undefined },
): void {
  const existing = pending.get(fragment.index);
  const call: PendingCall = existing ?? { id: '', name: '', args: '' };

  if (fragment.id) call.id = fragment.id;
  if (fragment.function?.name) call.name = fragment.function.name;
  if (fragment.function?.arguments) call.args += fragment.function.arguments;

  pending.set(fragment.index, call);
}

/** Maps a mid-stream error payload to a wire-format error kind. */
function streamErrorEvent(code: number, message: string): ChatEvent {
  if (code === 429) {
    return {
      type: 'error',
      kind: 'rate_limit',
      message:
        'OpenRouter is rate limiting this model. Wait a moment and try again — free models throttle hard, paid ones only under load.',
    };
  }
  return {
    type: 'error',
    kind: 'unknown',
    message: `The model stopped mid-response: ${message}`,
  };
}

/**
 * Maps a thrown error to the coarse wire-format error kinds. OpenRouter's
 * typed exception classes are used here and nowhere else in the app.
 *
 * Unlike the Anthropic path, MCP-server failures CAN reach this function —
 * we hold that connection ourselves. A failure during the initial listTools
 * lands here; a failure during an individual call is caught in runTool.
 */
function toChatEvent(err: unknown): ChatEvent {
  // Log the real error server-side; never send internals to the browser.
  console.error('[streamChat:openrouter]', err);

  if (err instanceof OpenRouterError) {
    if (err.statusCode === 401 || err.statusCode === 403) {
      return {
        type: 'error',
        kind: 'upstream_auth',
        message:
          'The server could not authenticate with OpenRouter. Check OPENROUTER_API_KEY.',
      };
    }

    // 402 is OpenRouter's "out of credits" — a spent free-tier daily quota on
    // the free path, and simply an empty balance on a paid model.
    if (err.statusCode === 402) {
      return {
        type: 'error',
        kind: 'upstream_auth',
        message:
          'OpenRouter rejected the request for lack of credit. Top up the account, or — on a free model — wait for the daily quota to reset.',
      };
    }

    if (err.statusCode === 429) {
      return {
        type: 'error',
        kind: 'rate_limit',
        message:
          'OpenRouter is rate limiting this model. Free models throttle hard — wait a moment and try again.',
      };
    }

    return {
      type: 'error',
      kind: 'unknown',
      message: 'Something went wrong generating a response. Try again.',
    };
  }

  if (err instanceof ConnectionError || err instanceof RequestTimeoutError) {
    // Covers both OpenRouter and — since we hold the MCP connection on this
    // path — the MCP server itself.
    return {
      type: 'error',
      kind: 'tool_unavailable',
      message:
        'Could not reach OpenRouter or the training-data server. Check your network and try again.',
    };
  }

  return {
    type: 'error',
    kind: 'unknown',
    message: 'Something went wrong generating a response. Try again.',
  };
}
