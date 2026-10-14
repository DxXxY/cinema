// In-memory room storage. Rooms disappear on server restart.
const rooms = new Map();

const clean = (v, max = 500) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { users: new Map(), media: null, playing: false, time: 0, updatedAt: Date.now() });
  return rooms.get(id);
}

function currentTime(room) {
  return room.playing ? room.time + (Date.now() - room.updatedAt) / 1000 : room.time;
}

function snapshot(room) {
  return { users: [...room.users.values()], media: room.media, playing: room.playing, time: currentTime(room), updatedAt: Date.now() };
}

// Removes a user and deletes the room once it is empty.
function removeUser(id, socketId) {
  const room = rooms.get(id);
  if (!room) return;
  room.users.delete(socketId);
  if (!room.users.size) rooms.delete(id);
}

module.exports = { rooms, clean, getRoom, currentTime, snapshot, removeUser };
