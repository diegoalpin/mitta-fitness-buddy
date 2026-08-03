import 'dotenv/config';

/**
 * Every environment variable in the app is read here and nowhere else
 * (handoff §7.5 rule 3). When BYOK lands, per-request credentials replace
 * these fields without a hunt through the codebase.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail loudly at boot rather than mysteriously on the first request.
    // Rejecting the empty string is intentional: an empty bearer token is a
    // misconfiguration, not a valid value.
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Copy backend/.env.example to backend/.env and fill it in.`,
    );
  }
  return value;
}

/**
 * Which inference provider serves /api/chat. Both emit the same ChatEvent
 * stream, so nothing outside llm/ cares which one is selected.
 */
export type LlmProvider = 'anthropic' | 'openrouter';

function requiredProvider(): LlmProvider {
  const value = process.env.LLM_PROVIDER ?? 'anthropic';
  if (value !== 'anthropic' && value !== 'openrouter') {
    throw new Error(
      `LLM_PROVIDER must be "anthropic" or "openrouter", got "${value}"`,
    );
  }
  return value;
}

/** How much detail src/log.ts prints. See that file for what each level shows. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function requiredLogLevel(): LogLevel {
  const value = process.env.LOG_LEVEL ?? 'info';
  if (value !== 'debug' && value !== 'info' && value !== 'warn' && value !== 'error') {
    throw new Error(
      `LOG_LEVEL must be one of debug|info|warn|error, got "${value}"`,
    );
  }
  return value;
}

const llmProvider = requiredProvider();

export const config = {
  mcpServerUrl: required('MCP_SERVER_URL'),
  mcpBearerToken: required('MCP_BEARER_TOKEN'),

  llmProvider,

  // Only the selected provider's key is demanded. Requiring both would make an
  // OpenRouter-only deployment fail at boot over a credential it never uses.
  // The unselected provider's key is the empty string and is never read.
  anthropicApiKey: llmProvider === 'anthropic' ? required('ANTHROPIC_API_KEY') : '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',

  openrouterApiKey:
    llmProvider === 'openrouter' ? required('OPENROUTER_API_KEY') : '',
  // "openrouter/free" is the Free Router: it fails over across free
  // tool-capable models instead of pinning one. Pinning a single free model
  // (google/gemma-4-31b-it:free, say) means inheriting that model's shared
  // upstream pool, which returns 429 for long stretches. Set OPENROUTER_MODEL
  // to a specific slug when you need to evaluate one model in particular.
  openrouterModel: process.env.OPENROUTER_MODEL ?? 'openrouter/free',

  // Not required: Render injects PORT, local dev falls back.
  port: Number(process.env.PORT ?? 8787),

  // "info" gives one line per request plus a summary per answer. "debug" adds
  // a line per streamed event, which is loud but shows text leaving the server
  // token by token.
  logLevel: requiredLogLevel(),

  // Diagnostic only. Logs streamed content-block types so the MCP connector's
  // block shapes can be re-verified if the API changes.
  debugBlocks: process.env.BACKEND_DEBUG_BLOCKS === '1',
} as const;
