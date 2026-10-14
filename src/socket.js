const { rooms, clean, randomKey, getRoom, currentTime, snapshot, addMessage, removeUser } = require('./rooms');

const REACTIONS = ['❤️', '😂', '😱', '🔥', '😭', '👏'];
const MAX_SUBTITLES = 500_000; // characters of WebVTT

// Allows at most `limit` events per `windowMs` for one socket and key.
function rateLimited(socket, key, limit, windowMs) {
  const now = Date.now();
  const times = (socket.data[key] || []).filter(t => now - t < windowMs);
  socket.data[key] = times;
  if (times.length >= limit) return true;
  times.push(now);
  return false;
}

module.exports = function registerSocketHandlers(io) {
  function broadcastState(id) {
    const room = rooms.get(id);
    if (room) io.to(id).emit('room:state', snapshot(room));
  }

  const voiceRoom = id => `${id}:voice`;
  const memberRoom = socket => {
    const room = rooms.get(socket.data.roomId);
    return room?.users.has(socket.id) ? room : null;
  };

  function setVoice(socket, on) {
    const user = memberRoom(socket)?.users.get(socket.id);
    if (!user) return;
    socket.data.voice = on;
    user.voice = on;
    user.opus = on && !!socket.data.opus;
    if (on) socket.join(voiceRoom(socket.data.roomId)); else socket.leave(voiceRoom(socket.data.roomId));
    broadcastState(socket.data.roomId);
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
      const id = clean(data.roomId, 80) || randomKey();
      const name = clean(data.name, 24) || 'Гость';
      // A locked room only lets in people who have the invite key.
      const existing = rooms.get(id);
      if (existing?.key && data.key !== existing.key && !existing.users.has(socket.id)) return ack({ ok: false, error: 'locked' });
      if (socket.data.roomId && socket.data.roomId !== id) leaveRoom(socket);
      const room = getRoom(id);
      socket.data.roomId = id;
      socket.data.name = name;
      room.users.set(socket.id, { id: socket.id, name, voice: !!socket.data.voice, opus: !!socket.data.voice && !!socket.data.opus });
      socket.join(id);
      broadcastState(id);
      ack({ ok: true, roomId: id, state: snapshot(room), messages: room.messages, positions: [...room.positions.values()] });
    });

    socket.on('room:rename', (data = {}, ack = () => {}) => {
      const room = memberRoom(socket);
      if (!room) return ack({ ok: false });
      const name = clean(data.name, 24) || 'Гость';
      socket.data.name = name;
      room.users.set(socket.id, { ...room.users.get(socket.id), name });
      broadcastState(socket.data.roomId);
      ack({ ok: true });
    });

    socket.on('room:lock', (data = {}) => {
      const room = memberRoom(socket);
      if (!room) return;
      room.key = data.locked ? randomKey() : null;
      broadcastState(socket.data.roomId);
    });

    // Fresh room state for the "sync" button.
    socket.on('room:sync', (_data, ack = () => {}) => {
      const room = memberRoom(socket);
      ack(room ? snapshot(room) : null);
    });

    socket.on('media:set', (data = {}) => {
      const room = memberRoom(socket);
      if (!room) return;
      const url = clean(data.url, 2000);
      if (!url) return;
      room.media = { url, type: data.type === 'embed' ? 'embed' : 'direct', title: clean(data.title, 120) || 'Видео' };
      room.playing = data.autoplay === true; // a film picked from search starts for everyone at once
      room.time = 0;
      room.updatedAt = Date.now();
      room.positions.clear();
      room.subtitles = null;
      broadcastState(socket.data.roomId);
      io.to(socket.data.roomId).emit('room:positions', []);
    });

    socket.on('media:control', (data = {}) => {
      const room = memberRoom(socket);
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

    // Each client reports its own playback position; shown next to participant names.
    socket.on('media:position', (data = {}) => {
      const room = memberRoom(socket);
      if (!room?.media) return;
      if (!Number.isFinite(data.time) || data.time < 0 || data.time > 1e6) return;
      room.positions.set(socket.id, { id: socket.id, time: data.time, playing: !!data.playing });
      io.to(socket.data.roomId).emit('room:positions', [...room.positions.values()]);
    });

    socket.on('subtitles:set', (data = {}, ack = () => {}) => {
      const room = memberRoom(socket);
      if (!room?.media) return ack({ ok: false, error: 'Сначала запусти видео' });
      const vtt = typeof data.vtt === 'string' ? data.vtt : '';
      if (!vtt.startsWith('WEBVTT')) return ack({ ok: false, error: 'Файл не похож на субтитры' });
      if (vtt.length > MAX_SUBTITLES) return ack({ ok: false, error: 'Файл слишком большой' });
      room.subtitles = { id: Date.now(), name: clean(data.name, 120) || 'Субтитры', vtt };
      broadcastState(socket.data.roomId);
      ack({ ok: true });
    });
    socket.on('subtitles:clear', () => {
      const room = memberRoom(socket);
      if (!room?.subtitles) return;
      room.subtitles = null;
      broadcastState(socket.data.roomId);
    });
    socket.on('subtitles:get', (_data, ack = () => {}) => ack(memberRoom(socket)?.subtitles || null));

    socket.on('chat:send', (data = {}) => {
      const room = memberRoom(socket);
      if (!room || rateLimited(socket, 'chatTimes', 8, 5000)) return;
      const message = clean(data.message, 500);
      if (!message) return;
      const msg = { id: socket.id, name: socket.data.name || 'Гость', message, at: Date.now() };
      addMessage(room, msg);
      io.to(socket.data.roomId).emit('chat:message', msg);
    });

    socket.on('reaction', (data = {}) => {
      if (!memberRoom(socket) || !REACTIONS.includes(data.emoji) || rateLimited(socket, 'reactTimes', 6, 2000)) return;
      io.to(socket.data.roomId).emit('reaction', { id: socket.id, name: socket.data.name || 'Гость', emoji: data.emoji });
    });

    // Voice chat: audio frames are relayed only to room members with voice on.
    // `opus` says this client can encode and decode Opus; others then send it Opus
    // instead of the fallback 16 kHz μ-law frames.
    socket.on('voice:join', (data = {}) => { socket.data.opus = data?.opus === true; setVoice(socket, true); });
    socket.on('voice:leave', () => setVoice(socket, false));
    socket.on('voice:data', chunk => {
      const id = socket.data.roomId;
      if (!id || !socket.data.voice || !Buffer.isBuffer(chunk) || chunk.length > 4096) return;
      socket.to(voiceRoom(id)).volatile.emit('voice:data', socket.id, chunk);
    });

    socket.on('disconnect', () => leaveRoom(socket));
  });
};
