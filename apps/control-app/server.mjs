// Agent Stack control app. Run: node apps/control-app/server.mjs   (or app.cmd at the repo root)
// Loopback only, a random token on every API call, Host and Origin checks, JSON only. Read-only in M2.1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStore, loadSettings } from './src/state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

export function createServer({ store, token = crypto.randomBytes(16).toString('hex'), uiDir = path.join(here, 'ui') }) {
  const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x'), host = req.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, { error: 'bad host' });
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['x-stack-token'] !== token) return send(res, 401, { error: 'Open the app from the link it printed; this page has no valid token.' });
        if (req.headers.origin && new URL(req.headers.origin).host !== host) return send(res, 403, { error: 'bad origin' });
        if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, await store.get());
        return send(res, 404, { error: 'not found' });
      }
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.resolve(uiDir, rel);
      if (!file.startsWith(path.resolve(uiDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) { send(res, 400, { error: e.message }); }
  });
  return { server, token };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = path.resolve(here, '..', '..');
  const store = createStore({ settings: loadSettings({ repo }) });
  const { server, token } = createServer({ store });
  const want = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4790;
  let port = want;
  server.on('error', (e) => { if (e.code === 'EADDRINUSE' && port < want + 10) server.listen(++port, '127.0.0.1'); else throw e; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/?t=${token}`;
    console.log(`Agent Stack control app\n\n  ${url}\n\nLeave this window open. Ctrl+C stops it. (Read-only in this version.)`);
    store.start(); store.refresh().catch(() => {});
    if (!process.argv.includes('--no-open')) spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true }).unref();
  });
}
