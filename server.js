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

registerSocketHandlers(io);

server.listen(PORT, () => console.log(`Together Cinema: http://localhost:${PORT}`));
