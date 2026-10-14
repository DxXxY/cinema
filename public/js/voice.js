// Voice chat relayed through our own server over the existing Socket.IO
// connection. No WebRTC/TURN: it works wherever the site itself opens.
// Audio processing lives in voice-worklet.js (16 kHz μ-law, ~128 kbit/s while talking).
import { $ } from './dom.js';
import { socket, store } from './state.js';

const SPEAKING_HOLD_MS = 350;
const players = new Map();      // speaker socket id -> AudioWorkletNode
const speakingUntil = new Map(); // socket id -> timestamp
let enabled = false, muted = false, ctx = null, micStream = null, master = null;
let volume = Number(localStorage.getItem('tc-voice-volume') ?? 100);
if (!Number.isFinite(volume)) volume = 100;

function updateStatus() {
  if (!enabled) return void ($('voiceStatus').textContent = 'Выключена');
  const others = (store.roomState?.users || []).filter(u => u.voice && u.id !== socket.id).length;
  const who = others ? `в голосе ещё: ${others}` : 'ждём собеседника (он тоже должен включить голос)';
  $('voiceStatus').textContent = `${muted ? 'Микрофон выключен' : 'Включена'} — ${who}`;
}

function updateControls() {
  $('micMute').disabled = !enabled;
  $('micMute').textContent = muted ? '🔇 Микрофон выключен' : '🎙 Микрофон включён';
  $('micMute').classList.toggle('muted', muted);
}

async function enableVoice() {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
    $('voiceStatus').textContent = 'Браузер не поддерживает голосовую связь или сайт открыт не по HTTPS';
    $('voiceToggle').checked = false;
    return;
  }
  // Created synchronously inside the click so the browser lets it play sound.
  ctx = new AudioContext();
  try {
    [micStream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }),
      ctx.audioWorklet.addModule('/js/voice-worklet.js'),
    ]);
    const mic = new AudioWorkletNode(ctx, 'mic-capture');
    mic.port.onmessage = e => {
      if (muted) return;
      speakingUntil.set(socket.id, Date.now() + SPEAKING_HOLD_MS);
      socket.volatile.emit('voice:data', e.data);
    };
    // The capture node must be connected to the output to be processed; keep it silent.
    const silent = ctx.createGain();
    silent.gain.value = 0;
    ctx.createMediaStreamSource(micStream).connect(mic).connect(silent).connect(ctx.destination);
    // All remote voices go through one gain node: the volume slider.
    master = ctx.createGain();
    master.gain.value = volume / 100;
    master.connect(ctx.destination);
    await ctx.resume();
  } catch {
    cleanup();
    $('voiceStatus').textContent = 'Нет доступа к микрофону — разреши его в настройках сайта';
    $('voiceToggle').checked = false;
    return;
  }
  enabled = true;
  muted = false;
  socket.emit('voice:join');
  updateStatus();
  updateControls();
}

function cleanup() {
  micStream?.getTracks().forEach(t => t.stop());
  micStream = null;
  players.clear();
  ctx?.close();
  ctx = null;
  master = null;
}

function disableVoice() {
  enabled = false;
  socket.emit('voice:leave');
  cleanup();
  updateStatus();
  updateControls();
}

function playChunk(from, chunk) {
  let player = players.get(from);
  if (!player) {
    player = new AudioWorkletNode(ctx, 'voice-player', { numberOfInputs: 0, outputChannelCount: [1] });
    player.connect(master);
    players.set(from, player);
  }
  player.port.postMessage(chunk, [chunk]);
}

// Highlights the avatar of whoever is talking right now.
function renderSpeaking() {
  const now = Date.now();
  for (const row of document.querySelectorAll('#people .person[data-id]')) {
    row.classList.toggle('speaking', (speakingUntil.get(row.dataset.id) || 0) > now);
  }
}

// Called on every room state: drop players of users who left, refresh the counter.
export function pruneVoicePeers(users) {
  const ids = new Set(users.filter(u => u.voice).map(u => u.id));
  for (const [id, player] of players) if (!ids.has(id)) { player.disconnect(); players.delete(id); }
  for (const id of speakingUntil.keys()) if (!ids.has(id) && id !== socket.id) speakingUntil.delete(id);
  updateStatus();
  renderSpeaking();
}

export function initVoice() {
  socket.on('voice:data', (from, chunk) => {
    if (!enabled || !ctx || !(chunk instanceof ArrayBuffer)) return;
    speakingUntil.set(from, Date.now() + SPEAKING_HOLD_MS);
    playChunk(from, chunk);
  });
  // A reconnect gives a new socket that is not in voice yet.
  // initVoice runs after initRoom, so the room is re-joined first.
  socket.on('connect', () => { if (enabled) socket.emit('voice:join'); });
  $('voiceToggle').addEventListener('change', e => { if (e.target.checked) enableVoice(); else disableVoice(); });
  $('micMute').onclick = () => { muted = !muted; updateStatus(); updateControls(); };

  const slider = $('voiceVolume');
  slider.value = volume;
  $('voiceVolumeValue').textContent = `${volume}%`;
  slider.addEventListener('input', () => {
    volume = Number(slider.value);
    $('voiceVolumeValue').textContent = `${volume}%`;
    if (master) master.gain.value = volume / 100;
    try { localStorage.setItem('tc-voice-volume', String(volume)); } catch {}
  });
  setInterval(renderSpeaking, 150);
}
