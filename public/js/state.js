// Shared socket and room state used by every module.
// WebSocket first (skips the long-polling handshake), polling as a fallback.
export const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });

const params = new URLSearchParams(location.search);
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

export const store = {
  roomId: params.get('room') || randomId(),
  roomKey: params.get('key') || '', // invite key of a locked room
  displayName: localStorage.getItem('tc-name') || `Гость${Math.floor(10 + Math.random() * 90)}`,
  roomState: null,
};
