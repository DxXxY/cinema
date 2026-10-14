// Playback timecodes next to participant names.
// Every client reports its position every 2 s; between reports the display
// ticks forward locally for those who are playing.
import { socket, store } from './state.js';
import { getLocalPosition } from './player.js';

const REPORT_MS = 2000;
const OUT_OF_SYNC_SEC = 3;
const positions = new Map(); // socket id -> { time, playing, at }

function formatTime(sec) {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function estimate(pos, now) {
  if (!pos) return null;
  return pos.playing ? pos.time + (now - pos.at) / 1000 : pos.time;
}

export function renderTimecodes() {
  const now = Date.now();
  const mine = estimate(positions.get(socket.id), now);
  for (const el of document.querySelectorAll('#people .timecode')) {
    const pos = positions.get(el.dataset.id);
    const t = estimate(pos, now);
    el.hidden = t === null;
    if (t === null) continue;
    el.textContent = `${pos.playing ? '▶' : '⏸'} ${formatTime(t)}`;
    const off = el.dataset.id !== socket.id && mine !== null && Math.abs(t - mine) > OUT_OF_SYNC_SEC;
    el.classList.toggle('out-of-sync', off);
    el.title = off ? `Расходится с тобой на ${Math.round(Math.abs(t - mine))} с` : 'Позиция в видео';
  }
}

function report() {
  const pos = store.roomState?.media ? getLocalPosition() : null;
  if (pos) socket.emit('media:position', pos);
}

export function initPositions() {
  socket.on('room:positions', list => {
    const now = Date.now();
    positions.clear();
    for (const p of list) positions.set(p.id, { time: p.time, playing: p.playing, at: now });
    renderTimecodes();
  });
  setInterval(report, REPORT_MS);
  setInterval(renderTimecodes, 1000);
}
