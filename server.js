const express = require('express');
const compression = require('compression');
const http = require('http');
const path = require('path');
const { Readable } = require('stream');
const { Server } = require('socket.io');
const registerSocketHandlers = require('./src/socket');
const { rooms } = require('./src/rooms');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1.5e6 }); // room for subtitle files

app.use(compression());
// Old invite links (/?room=abc&key=...) now lead to /room/abc?key=...
app.get('/', (req, res, next) => {
  if (!req.query.room) return next();
  const key = req.query.key ? `?key=${encodeURIComponent(req.query.key)}` : '';
  res.redirect(302, `/room/${encodeURIComponent(req.query.room)}${key}`);
});
app.get(['/room', '/room/:id'], (_req, res) => res.sendFile(path.join(PUBLIC, 'room.html')));
app.use(express.static(PUBLIC));
// Lightweight endpoint for Render health checks and uptime pingers.
app.get('/health', (_req, res) => res.send('ok'));

// Windows installer served from our own address. The file lives in the latest
// GitHub release (GitHub doesn't accept 100+ MB files in the repo itself);
// the server streams it through, including Range requests so a broken
// download can be resumed.
const INSTALLER_URL = process.env.INSTALLER_URL || 'https://github.com/DxXxY/cinema/releases/latest/download/Together-Cinema-Setup.exe';
app.get('/download/windows', async (req, res) => {
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  try {
    const upstream = await fetch(INSTALLER_URL, {
      headers: req.headers.range ? { Range: req.headers.range } : {},
      redirect: 'follow',
      signal: abort.signal,
    });
    if (!upstream.ok) {
      res.status(503).set('Retry-After', '3600').type('html').send(downloadUnavailablePage());
      return upstream.body?.cancel();
    }
    res.status(upstream.status); // 200, or 206 for a resumed download
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="Together-Cinema-Setup.exe"',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    });
    for (const header of ['content-length', 'content-range', 'last-modified', 'etag']) {
      const value = upstream.headers.get(header);
      if (value) res.set(header, value);
    }
    if (req.method === 'HEAD') return upstream.body?.cancel();
    Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
  } catch {
    if (!res.headersSent) res.status(502).type('html').send(downloadUnavailablePage());
    else res.destroy();
  }
});

function downloadUnavailablePage() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Together Cinema для Windows</title><link rel="stylesheet" href="/styles.css"></head>
<body><main style="min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px"><div class="panel" style="max-width:440px;padding:32px">
<div class="orb" style="margin:0 auto 16px">⬇</div><h1 style="font-size:24px;letter-spacing:-.5px;margin:0 0 10px">Скоро будет</h1>
<p style="color:var(--muted);font-size:13px;line-height:1.7;margin:0 0 22px">Приложение для Windows ещё готовится к выкладке или сервер не смог его получить. Попробуй чуть позже — а пока всё работает прямо в браузере.</p>
<a class="button primary" href="/" style="text-decoration:none">На главную</a></div></main></body></html>`;
}

// Room status for the home page (join form, recent rooms). The title of a locked
// room is shown only to someone who has its invite key.
app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  res.set('Cache-Control', 'no-store');
  if (!room) return res.json({ exists: false });
  const allowed = !room.key || req.query.key === room.key;
  res.json({ exists: true, locked: !!room.key, allowed, users: room.users.size, title: allowed ? room.media?.title || null : null });
});

registerSocketHandlers(io);

// Render's free plan puts the service to sleep after 15 min without requests,
// and waking up takes 30-60 s. Ping our own public URL to stay awake.
// RENDER_EXTERNAL_URL is set by Render automatically; KEEP_AWAKE=0 turns this off.
if (process.env.RENDER_EXTERNAL_URL && process.env.KEEP_AWAKE !== '0') {
  setInterval(() => fetch(`${process.env.RENDER_EXTERNAL_URL}/health`).catch(() => {}), 10 * 60 * 1000);
}

server.listen(PORT, () => console.log(`Together Cinema: http://localhost:${PORT}`));
