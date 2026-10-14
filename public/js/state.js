// Shared socket and room state used by every module.
import { randomId } from './ids.js';

// WebSocket first (skips the long-polling handshake), polling as a fallback.
export const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });

const params = new URLSearchParams(location.search);
const pathId = location.pathname.match(/^\/room\/([^/]+)/)?.[1];

export const store = {
  roomId: (pathId && decodeURIComponent(pathId)) || params.get('room') || randomId(),
  roomKey: params.get('key') || '', // invite key of a locked room
  displayName: localStorage.getItem('tc-name') || `Гость${Math.floor(10 + Math.random() * 90)}`,
  roomState: null,
  joined: false, // true between a successful room:join and a disconnect
};

// Room playback position. The server's updatedAt is on the server's clock, and
// a viewer's own clock can be off by hours — so time is counted from the moment
// this client received the state (stampState), never from updatedAt.
export function stampState(state) {
  if (state) state.receivedAt = Date.now();
  return state;
}

export function roomTime(state) {
  if (!state) return 0;
  const elapsed = state.playing ? Math.max(0, (Date.now() - (state.receivedAt ?? Date.now())) / 1000) : 0;
  return Math.max(0, Number(state.time) || 0) + elapsed;
}
