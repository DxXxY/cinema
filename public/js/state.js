// Shared socket and room state used by every module.
// WebSocket first (skips the long-polling handshake), polling as a fallback.
export const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });

export const store = {
  roomId: new URLSearchParams(location.search).get('room') || Math.random().toString(36).slice(2, 10),
  displayName: localStorage.getItem('tc-name') || `Гость${Math.floor(10 + Math.random() * 90)}`,
  roomState: null,
};
