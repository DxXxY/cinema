const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
const rooms = new Map();
const clean = (v, max = 500) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { users: new Map(), media: null, playing: false, time: 0, updatedAt: Date.now() });
  return rooms.get(id);
}
function currentTime(room) { return room.playing ? room.time + (Date.now() - room.updatedAt) / 1000 : room.time; }
function broadcastState(id) {
  const room = rooms.get(id); if (!room) return;
  io.to(id).emit('room:state', { users: [...room.users.values()], media: room.media, playing: room.playing, time: currentTime(room), updatedAt: Date.now() });
}
io.on('connection', socket => {
  socket.on('room:join', (data = {}, ack = () => {}) => {
    const id = clean(data.roomId, 80) || Math.random().toString(36).slice(2, 10);
    const name = clean(data.name, 24) || 'Гость';
    const oldId = socket.data.roomId;
    if (oldId && rooms.has(oldId)) {
      const old = rooms.get(oldId); old.users.delete(socket.id); socket.leave(oldId); broadcastState(oldId);
      if (!old.users.size) rooms.delete(oldId);
    }
    const room = getRoom(id); socket.data.roomId = id; socket.data.name = name;
    room.users.set(socket.id, { id: socket.id, name }); socket.join(id); broadcastState(id);
    ack({ ok: true, roomId: id, state: { users: [...room.users.values()], media: room.media, playing: room.playing, time: currentTime(room), updatedAt: Date.now() } });
  });
  socket.on('room:rename', (data = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomId); if (!room) return ack({ ok: false });
    const name = clean(data.name, 24) || 'Гость'; socket.data.name = name;
    room.users.set(socket.id, { id: socket.id, name }); broadcastState(socket.data.roomId); ack({ ok: true });
  });
  socket.on('media:set', (data = {}) => {
    const room = rooms.get(socket.data.roomId); if (!room) return;
    const url = clean(data.url, 2000); if (!url) return;
    room.media = { url, type: data.type === 'embed' ? 'embed' : 'direct', title: clean(data.title, 120) || 'Видео' };
    room.playing = false; room.time = 0; room.updatedAt = Date.now(); broadcastState(socket.data.roomId);
  });
  socket.on('media:control', (data = {}) => {
    const room = rooms.get(socket.data.roomId); if (!room?.media || room.media.type !== 'direct') return;
    if (data.action === 'play') { if (Number.isFinite(data.time)) room.time = Math.max(0, data.time); room.playing = true; room.updatedAt = Date.now(); }
    else if (data.action === 'pause') { room.time = Number.isFinite(data.time) ? Math.max(0, data.time) : currentTime(room); room.playing = false; room.updatedAt = Date.now(); }
    else if (data.action === 'seek') { room.time = Number.isFinite(data.time) ? Math.max(0, data.time) : 0; room.updatedAt = Date.now(); }
    else return;
    broadcastState(socket.data.roomId);
  });
  socket.on('chat:send', (data = {}) => {
    const id = socket.data.roomId; if (!id || !rooms.has(id)) return;
    const message = clean(data.message, 500); if (!message) return;
    io.to(id).emit('chat:message', { id: socket.id, name: socket.data.name || 'Гость', message, at: Date.now() });
  });
  socket.on('voice:ready', () => { if (socket.data.roomId) socket.to(socket.data.roomId).emit('voice:ready', { id: socket.id }); });
  for (const event of ['voice:offer', 'voice:answer', 'voice:ice']) {
    socket.on(event, data => {
      const target = io.sockets.sockets.get(data?.to); const id = socket.data.roomId;
      if (!id || !target || target.data.roomId !== id) return;
      target.emit(event, { ...data, from: socket.id });
    });
  }
  socket.on('disconnect', () => {
    const id = socket.data.roomId; if (!id || !rooms.has(id)) return;
    const room = rooms.get(id); room.users.delete(socket.id); broadcastState(id); if (!room.users.size) rooms.delete(id);
  });
});
server.listen(PORT, () => console.log(`Together Cinema: http://localhost:${PORT}`));
