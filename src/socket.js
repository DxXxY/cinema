const { rooms, clean, getRoom, currentTime, snapshot, removeUser } = require('./rooms');

module.exports = function registerSocketHandlers(io) {
  function broadcastState(id) {
    const room = rooms.get(id);
    if (room) io.to(id).emit('room:state', snapshot(room));
  }

  const voiceRoom = id => `${id}:voice`;

  function setVoice(socket, on) {
    const id = socket.data.roomId;
    const user = rooms.get(id)?.users.get(socket.id);
    if (!user) return;
    socket.data.voice = on;
    user.voice = on;
    if (on) socket.join(voiceRoom(id)); else socket.leave(voiceRoom(id));
    broadcastState(id);
  }

  function leaveRoom(socket) {
    const id = socket.data.roomId;
    if (!id) return;
    socket.data.voice = false;
    socket.leave(voiceRoom(id));
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
      room.users.set(socket.id, { id: socket.id, name, voice: !!socket.data.voice });
      socket.join(id);
      broadcastState(id);
      ack({ ok: true, roomId: id, state: snapshot(room) });
    });

    socket.on('room:rename', (data = {}, ack = () => {}) => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return ack({ ok: false });
      const name = clean(data.name, 24) || 'Гость';
      socket.data.name = name;
      room.users.set(socket.id, { ...room.users.get(socket.id), name });
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

    // Voice chat: audio frames are relayed only to room members with voice on.
    socket.on('voice:join', () => setVoice(socket, true));
    socket.on('voice:leave', () => setVoice(socket, false));
    socket.on('voice:data', chunk => {
      const id = socket.data.roomId;
      if (!id || !socket.data.voice || !Buffer.isBuffer(chunk) || chunk.length > 4096) return;
      socket.to(voiceRoom(id)).volatile.emit('voice:data', socket.id, chunk);
    });

    socket.on('disconnect', () => leaveRoom(socket));
  });
};
