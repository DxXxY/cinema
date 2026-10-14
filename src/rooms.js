// In-memory room storage. Rooms disappear on server restart.
const crypto = require('crypto');

const rooms = new Map();
const EMPTY_ROOM_TTL = 10 * 60 * 1000; // keep an empty room (video, chat) for 10 minutes
const MAX_MESSAGES = 50;

const clean = (v, max = 500) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const randomKey = () => crypto.randomBytes(6).toString('base64url');

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    room = {
      users: new Map(), positions: new Map(), messages: [], subtitles: null, key: null,
      media: null, playing: false, time: 0, updatedAt: Date.now(), deleteTimer: null,
    };
    rooms.set(id, room);
  }
  if (room.deleteTimer) { clearTimeout(room.deleteTimer); room.deleteTimer = null; }
  return room;
}

function currentTime(room) {
  return room.playing ? room.time + (Date.now() - room.updatedAt) / 1000 : room.time;
}

// Sent only to room members, so it may include the invite key.
function snapshot(room) {
  return {
    users: [...room.users.values()], media: room.media, playing: room.playing, time: currentTime(room), updatedAt: Date.now(),
    locked: !!room.key, key: room.key,
    subtitles: room.subtitles && { id: room.subtitles.id, name: room.subtitles.name },
  };
}

function addMessage(room, message) {
  room.messages.push(message);
  if (room.messages.length > MAX_MESSAGES) room.messages.shift();
}

// Removes a user. An empty room is paused and deleted only after EMPTY_ROOM_TTL,
// so a dropped connection or page reload doesn't lose the video and chat.
function removeUser(id, socketId) {
  const room = rooms.get(id);
  if (!room) return;
  room.users.delete(socketId);
  room.positions.delete(socketId);
  if (room.users.size) return;
  room.time = currentTime(room);
  room.playing = false;
  room.updatedAt = Date.now();
  clearTimeout(room.deleteTimer);
  room.deleteTimer = setTimeout(() => { if (!room.users.size) rooms.delete(id); }, EMPTY_ROOM_TTL);
  room.deleteTimer.unref?.();
}

module.exports = { rooms, clean, randomKey, getRoom, currentTime, snapshot, addMessage, removeUser };
