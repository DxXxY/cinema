// Voice chat relayed through our own server over the existing Socket.IO
// connection. No WebRTC/TURN: it works wherever the site itself opens.
// Audio processing lives in voice-worklet.js (16 kHz μ-law, ~128 kbit/s while talking).
import { $ } from './dom.js';
import { socket, store } from './state.js';

const players = new Map(); // speaker socket id -> AudioWorkletNode
let enabled = false, ctx = null, micStream = null;

function updateStatus() {
  if (!enabled) return void ($('voiceStatus').textContent = 'Выключена');
  const others = (store.roomState?.users || []).filter(u => u.voice && u.id !== socket.id).length;
  $('voiceStatus').textContent = others ? `Включена — в голосе ещё: ${others}` : 'Включена — ждём собеседника (он тоже должен включить голос)';
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
    mic.port.onmessage = e => socket.volatile.emit('voice:data', e.data);
    // The capture node must be connected to the output to be processed; keep it silent.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    ctx.createMediaStreamSource(micStream).connect(mic).connect(mute).connect(ctx.destination);
    await ctx.resume();
  } catch {
    cleanup();
    $('voiceStatus').textContent = 'Нет доступа к микрофону — разреши его в настройках сайта';
    $('voiceToggle').checked = false;
    return;
  }
  enabled = true;
  socket.emit('voice:join');
  updateStatus();
}

function cleanup() {
  micStream?.getTracks().forEach(t => t.stop());
  micStream = null;
  players.clear();
  ctx?.close();
  ctx = null;
}

function disableVoice() {
  enabled = false;
  socket.emit('voice:leave');
  cleanup();
  updateStatus();
}

function playChunk(from, chunk) {
  let player = players.get(from);
  if (!player) {
    player = new AudioWorkletNode(ctx, 'voice-player', { numberOfInputs: 0, outputChannelCount: [1] });
    player.connect(ctx.destination);
    players.set(from, player);
  }
  player.port.postMessage(chunk, [chunk]);
}

// Called on every room state: drop players of users who left, refresh the counter.
export function pruneVoicePeers(users) {
  const ids = new Set(users.filter(u => u.voice).map(u => u.id));
  for (const [id, player] of players) if (!ids.has(id)) { player.disconnect(); players.delete(id); }
  updateStatus();
}

export function initVoice() {
  socket.on('voice:data', (from, chunk) => { if (enabled && ctx && chunk instanceof ArrayBuffer) playChunk(from, chunk); });
  // A reconnect gives a new socket that is not in voice yet.
  // initVoice runs after initRoom, so the room is re-joined first.
  socket.on('connect', () => { if (enabled) socket.emit('voice:join'); });
  $('voiceToggle').addEventListener('change', e => { if (e.target.checked) enableVoice(); else disableVoice(); });
}
