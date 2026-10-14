const express = require('express');
const compression = require('compression');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const registerSocketHandlers = require('./src/socket');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1.5e6 }); // room for subtitle files

app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));
// Lightweight endpoint for Render health checks and uptime pingers.
app.get('/health', (_req, res) => res.send('ok'));

registerSocketHandlers(io);

// Render's free plan puts the service to sleep after 15 min without requests,
// and waking up takes 30-60 s. Ping our own public URL to stay awake.
// RENDER_EXTERNAL_URL is set by Render automatically; KEEP_AWAKE=0 turns this off.
if (process.env.RENDER_EXTERNAL_URL && process.env.KEEP_AWAKE !== '0') {
  setInterval(() => fetch(`${process.env.RENDER_EXTERNAL_URL}/health`).catch(() => {}), 10 * 60 * 1000);
}

server.listen(PORT, () => console.log(`Together Cinema: http://localhost:${PORT}`));
