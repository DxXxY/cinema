const express = require('express');
const compression = require('compression');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const registerSocketHandlers = require('./src/socket');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));
// Lightweight endpoint for Render health checks and uptime pingers.
app.get('/health', (_req, res) => res.send('ok'));

// WebRTC servers for voice chat. A TURN server is needed when users are behind
// strict NAT (mobile internet, many home routers). Set on Render:
// TURN_URLS (comma-separated), TURN_USERNAME, TURN_CREDENTIAL.
app.get('/ice-config', (_req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turnUrls = (process.env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (turnUrls.length) iceServers.push({ urls: turnUrls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  res.set('Cache-Control', 'no-store').json({ iceServers });
});

registerSocketHandlers(io);

server.listen(PORT, () => console.log(`Together Cinema: http://localhost:${PORT}`));
