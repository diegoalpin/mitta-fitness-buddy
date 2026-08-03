import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../config.js';

/**
 * THE MCP CLIENT HALF (handoff §7).
 *
 * The Anthropic provider never touches this file — Anthropic's infrastructure
 * connects to our MCP server itself. Every other provider needs it: OpenRouter
 * speaks plain chat-completions, so WE hold the MCP connection and run the
 * tool loop.
 *
 * This is the first piece of the BYOK rewrite landing early. It reads the
 * operator's bearer token from config like everything else today; when BYOK
 * arrives, the credential becomes per-request and only this file's connect()
 * changes.
 */

/** One MCP tool, in the shape provider adapters need to translate from. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** The flattened result of one tool call. */
export interface McpToolResult {
  text: string;
  isError: boolean;
}

/**
 * The MCP server runs on Render's free tier, which sleeps. A cold start is
 * 30-60s and lands on whichever request wakes it — usually the initial
 * listTools. Anything under a minute will spuriously fail a first request.
 */
const MCP_TIMEOUT_MS = 120_000;

let connecting: Promise<Client> | null = null;

/**
 * One connection per process, reused across requests. We cache the in-flight
 * promise rather than the resolved client so that concurrent first requests
 * share a single connect instead of racing to open several.
 */
function getClient(): Promise<Client> {
  if (!connecting) {
    connecting = connect().catch((err: unknown) => {
      // Never cache a failed connect. The usual cause is a cold or briefly
      // unreachable MCP server, and the next request should get a fresh try
      // rather than inheriting a permanently rejected promise.
      connecting = null;
      throw err;
    });
  }
  return connecting;
}

async function connect(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(config.mcpServerUrl),
    {
      // The MCP server authenticates with a static bearer token, not OAuth,
      // so we set the header directly instead of supplying an authProvider.
      requestInit: {
        headers: { Authorization: `Bearer ${config.mcpBearerToken}` },
      },
    },
  );

  const client = new Client({
    name: 'smart-coach-buddy',
    version: '1.0.0',
  });

  await client.connect(transport, { timeout: MCP_TIMEOUT_MS });
  return client;
}

/**
 * The server's tool catalogue. Fetched per turn rather than cached: it is one
 * cheap round trip on an already-open connection, and it means a tool added to
 * the MCP server shows up without restarting this process.
 */
export async function listMcpTools(): Promise<McpTool[]> {
  const client = await getClient();
  const { tools } = await client.listTools(undefined, {
    timeout: MCP_TIMEOUT_MS,
  });

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as Record<string, unknown>,
  }));
}

/**
 * Runs one tool and flattens the result to text.
 *
 * A tool that fails is NOT an exception here — MCP reports it as a normal
 * result with isError set, and the model needs to see the message so it can
 * correct itself. Only transport failures throw.
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const client = await getClient();

  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: MCP_TIMEOUT_MS },
  );

  return {
    text: flattenContent(result.content),
    isError: result.isError === true,
  };
}

/**
 * MCP content is an array of typed blocks. The Intervals.icu server returns
 * text, but image/audio/resource blocks are legal — describe rather than drop
 * them so a schema change surfaces as odd output instead of silence.
 */
function flattenContent(content: unknown): string {
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type === 'text' && typeof text === 'string') {
      parts.push(text);
    } else if (typeof type === 'string') {
      parts.push(`[${type} content omitted]`);
    }
  }
  return parts.join('\n');
}
