import { config } from './config.js';
import { buildApp } from './app.js';

const app = buildApp();

app.listen(config.port, () => {
  console.log(`backend listening on http://localhost:${config.port}`);
  console.log('This build has NO authentication — do not expose it publicly.');
});
