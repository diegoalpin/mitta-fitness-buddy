import { Router } from 'express';

export const healthRouter = Router();

// Liveness only. Deliberately does NOT probe the MCP server or Anthropic —
// a health check that wakes a cold Render instance would take 60s.
healthRouter.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});
