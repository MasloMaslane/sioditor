import { createApp } from './app.js';
import { SessionStore } from './store.js';

const port = Number(process.env.PORT ?? 8787);
const root = process.env.DATA_DIR ?? './data';
const reviewToken = process.env.REVIEW_TOKEN;

createApp({
  store: new SessionStore(root),
  ...(reviewToken ? { reviewToken } : {}),
}).listen(port, () => {
  console.log(`sioditor ingest listening on :${port}, storing in ${root}`);
  if (!reviewToken) console.warn('REVIEW_TOKEN is unset: recordings are readable by anyone');
});
