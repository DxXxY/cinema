const { rooms, clean, getRoom, currentTime, snapshot, removeUser } = require('./rooms');

module.exports = function registerSocketHandlers(io) {
  function broadcastState(id) {
    const room = rooms.get(id);
    if (room) io.to(id).emit('room:state', snapshot(room));
  }

  function leaveRoom(socket) {
    const id = socket.data.roomId;
    if (!id) return;
    socket.leave(id);
    removeUser(id, socket.id);
    broadcastState(id);
  }

  io.on('connection', socket => {
    socket.on('room:join', (data = {}, ack = () => {}) => {
      const id = clean(data.roomId, 80) || Math.random().toString(36).slice(2, 10);
      const name = clean(data.name, 24) || 'Гость';
      if (socket.data.roomId && socket.data.roomId !== id) leaveRoom(socket);
      const room = getRoom(id);
      socket.data.roomId = id;
      socket.data.name = name;
      room.users.set(socket.id, { id: socket.id, name });
      socket.join(id);
      broadcastState(id);
      ack({ ok: true, roomId: id, state: snapshot(room) });
    });

    socket.on('room:rename', (data = {}, ack = () => {}) => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return ack({ ok: false });
      const name = clean(data.name, 24) || 'Гость';
      socket.data.name = name;
      room.users.set(socket.id, { id: socket.id, name });
      broadcastState(socket.data.roomId);
      ack({ ok: true });
    });

    socket.on('media:set', (data = {}) => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      const url = clean(data.url, 2000);
      if (!url) return;
      room.media = { url, type: data.type === 'embed' ? 'embed' : 'direct', title: clean(data.title, 120) || 'Видео' };
      room.playing = false;
      room.time = 0;
      room.updatedAt = Date.now();
      broadcastState(socket.data.roomId);
    });

    socket.on('media:control', (data = {}) => {
      const room = rooms.get(socket.data.roomId);
      if (!room?.media) return;
      const time = Number.isFinite(data.time) ? Math.max(0, data.time) : null;
      if (data.action === 'play') {
        if (time !== null) room.time = time;
        room.playing = true;
      } else if (data.action === 'pause') {
        room.time = time ?? currentTime(room);
        room.playing = false;
      } else if (data.action === 'seek') {
        room.time = time ?? 0;
      } else return;
      room.updatedAt = Date.now();
      broadcastState(socket.data.roomId);
    });

    socket.on('chat:send', (data = {}) => {
      const id = socket.data.roomId;
      if (!id || !rooms.has(id)) return;
      const message = clean(data.message, 500);
      if (!message) return;
      io.to(id).emit('chat:message', { id: socket.id, name: socket.data.name || 'Гость', message, at: Date.now() });
    });

    // WebRTC signalling: relay only between members of the same room.
    // Without `to` it is announced to the whole room, with `to` only to that peer.
    socket.on('voice:ready', (data = {}) => {
      const id = socket.data.roomId;
      if (!id) return;
      if (!data?.to) return socket.to(id).emit('voice:ready', { id: socket.id });
      const target = io.sockets.sockets.get(data.to);
      if (target?.data.roomId === id) target.emit('voice:ready', { id: socket.id, reply: true });
    });
    socket.on('voice:bye', () => {
      if (socket.data.roomId) socket.to(socket.data.roomId).emit('voice:bye', { id: socket.id });
    });
    for (const event of ['voice:offer', 'voice:answer', 'voice:ice']) {
      socket.on(event, data => {
        const target = io.sockets.sockets.get(data?.to);
        const id = socket.data.roomId;
        if (!id || !target || target.data.roomId !== id) return;
        target.emit(event, { ...data, from: socket.id });
      });
    }

    socket.on('disconnect', () => leaveRoom(socket));
  });
};
