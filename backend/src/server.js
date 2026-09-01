import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vocabulary from './routes/vocabulary.js';
import words from './routes/words.js';
import links from './routes/links.js';
import { requireAppPassword, login } from './auth.js';

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.post('/api/login', login);
app.use('/api/vocabulary', requireAppPassword, vocabulary);
app.use('/api/words', requireAppPassword, words);
app.use('/api/links', requireAppPassword, links);

// In the release image the built site sits next to the backend and is served by
// this same process, so the site and the API share one origin — which is why the
// browser can keep using relative /api URLs and nothing has to be configured at
// build time. In development there is no dist/ and this block is skipped: Vite
// serves the frontend on 5173 and proxies /api here (vite.config.js).
const distDir = path.resolve(fileURLToPath(new URL('../../dist', import.meta.url)));
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    // Unknown /api paths fall through to the JSON 404 below instead of getting
    // the HTML page back.
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT) || 3000;

// Binds to all interfaces so Docker can publish the port. run_dev.sh publishes
// it on 127.0.0.1 only for local dev regardless — this backend holds the
// service_role key, and even with APP_PASSWORD set, binding to localhost is
// one less thing to think about while developing.
app.listen(port, '0.0.0.0', () => {
  console.log(`API listening on http://localhost:${port}`);
});
