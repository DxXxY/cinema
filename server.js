const express = require('express');
const compression = require('compression');
const http = require('http');
const path = require('path');
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
