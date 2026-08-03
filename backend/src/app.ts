import express from 'express';
import { requestLog } from './middleware/requestLog.js';
import { healthRouter } from './routes/health.js';
import { chatRouter } from './routes/chat.js';

export function buildApp() {
  const app = express();

  // First, so it also covers requests that never reach a route — a body that
  // fails to parse still gets its → and ← pair.
  app.use(requestLog);

  // Conversation history is resent every turn and can grow large.
  app.use(express.json({ limit: '4mb' }));

  app.use(healthRouter);
  app.use('/api', chatRouter);

  return app;
}

// No CORS middleware, deliberately. In dev, Vite proxies /api so the browser
// sees a same-origin request. Adding CORS would only widen who can reach an
// unauthenticated backend.
