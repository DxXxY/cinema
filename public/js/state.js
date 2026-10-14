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
};
