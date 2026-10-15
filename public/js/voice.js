// Voice chat relayed through our own server over the existing Socket.IO
// connection. No WebRTC/TURN: it works wherever the site itself opens.
// Audio processing lives in voice-worklet.js. Two wire formats:
//  - Opus via WebCodecs, 48 kHz, ~40 kbit/s: packet = [1, ...opus bytes];
//  - fallback 16 kHz 8-bit μ-law (~128 kbit/s): packet = one raw 640-byte frame.
// A client sends Opus only when everyone else in voice can decode it (the `opus`
// flag in the room state); every client can play both formats.
import { $, toast } from './dom.js';
import { socket, store } from './state.js';

const SPEAKING_HOLD_MS = 350;
const OPUS_RATE = 48000;
const OPUS_ENCODER = {
  codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 1, bitrate: 40000,
  opus: { application: 'voip', signal: 'voice', complexity: 9, frameDuration: 20000, usedtx: false, useinbandfec: false },
};
const OPUS_DECODER = { codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 1 };
const OPUS_TAG = 1;
const LEGACY_FRAME = 640;
// Sending only while someone talks: speech starts a burst that lasts a little
// after the last loud block, and a short pre-roll keeps the first syllable.
const VAD_LEVEL = 0.006, VAD_HANGOVER = 15, VAD_PREROLL = 3; // blocks of 20 ms

const players = new Map();      // speaker socket id -> AudioWorkletNode
const decoders = new Map();     // speaker socket id -> { decoder, ts }
const speakingUntil = new Map(); // socket id -> timestamp
let enabled = false, muted = false, ctx = null, micStream = null, master = null, micNode = null;
let opusOk = false, encoder = null, encoderBroken = false, useOpus = false, sentMode = '';
let vadHang = 0, preroll = [], encodedBlocks = 0;
let volume = Number(localStorage.getItem('tc-voice-volume') ?? 100);
if (!Number.isFinite(volume)) volume = 100;

function updateStatus() {
  if (!enabled) return void ($('voiceStatus').textContent = 'Выключена');
  refreshMode();
  const others = (store.roomState?.users || []).filter(u => u.voice && u.id !== socket.id).length;
  const who = others ? `в голосе ещё: ${others}` : 'ждём собеседника (он тоже должен включить голос)';
  $('voiceStatus').textContent = `${muted ? 'Микрофон выключен' : 'Включена'} — ${who}`;
}

function updateControls() {
  $('micMute').disabled = !enabled;
  $('micMute').textContent = muted ? '🔇 Микрофон выключен' : '🎙 Микрофон включён';
  $('micMute').classList.toggle('muted', muted);
  document.dispatchEvent(new Event('tc:voice')); // the cinema hall mirrors these controls
}

export const voiceState = () => ({ enabled, muted });

async function enableVoice() {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
    $('voiceStatus').textContent = 'Браузер не поддерживает голосовую связь или сайт открыт не по HTTPS';
    $('voiceToggle').checked = false;
    return;
  }
  // Created synchronously inside the click so the browser lets it play sound.
  try { ctx = new AudioContext({ sampleRate: OPUS_RATE }); } catch { ctx = new AudioContext(); }
  try {
    [micStream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }),
      ctx.audioWorklet.addModule('/js/voice-worklet.js'),
    ]);
    opusOk = await detectOpus();
    encoderBroken = false;
    const mic = micNode = new AudioWorkletNode(ctx, 'mic-capture');
    mic.port.onmessage = e => {
      if (muted) return;
      if (e.data instanceof ArrayBuffer) { // fallback μ-law frame
        if (useOpus) return;
        speakingUntil.set(socket.id, Date.now() + SPEAKING_HOLD_MS);
        socket.volatile.emit('voice:data', e.data);
      } else if (useOpus) encodeBlock(e.data);
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
  sentMode = '';
  socket.emit('voice:join', { opus: opusOk });
  updateStatus();
  updateControls();
}

function cleanup() {
  micStream?.getTracks().forEach(t => t.stop());
  micStream = null;
  micNode = null;
  closeEncoder();
  for (const { decoder } of decoders.values()) try { decoder.close(); } catch {}
  decoders.clear();
  vadHang = 0; preroll = []; sentMode = ''; useOpus = false;
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

function playerFor(from) {
  let player = players.get(from);
  if (!player) {
    player = new AudioWorkletNode(ctx, 'voice-player', { numberOfInputs: 0, outputChannelCount: [1] });
    player.connect(master);
    players.set(from, player);
  }
  return player;
}

// ——— Opus (WebCodecs) ———

async function detectOpus() {
  try {
    if (typeof AudioEncoder !== 'function' || typeof AudioDecoder !== 'function' || typeof AudioData !== 'function') return false;
    if (ctx.sampleRate !== OPUS_RATE) return false; // the encoder takes the device rate as is
    const [enc, dec] = await Promise.all([AudioEncoder.isConfigSupported(OPUS_ENCODER), AudioDecoder.isConfigSupported(OPUS_DECODER)]);
    return !!(enc.supported && dec.supported);
  } catch { return false; }
}

function closeEncoder() {
  try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch {}
  encoder = null;
}

function startEncoder() {
  encoder = new AudioEncoder({
    output: chunk => {
      if (muted || !enabled || !useOpus || chunk.byteLength <= 2) return; // ≤2 bytes: silence marker, nothing to play
      const packet = new Uint8Array(1 + chunk.byteLength);
      packet[0] = OPUS_TAG;
      chunk.copyTo(packet.subarray(1));
      speakingUntil.set(socket.id, Date.now() + SPEAKING_HOLD_MS);
      socket.volatile.emit('voice:data', packet.buffer);
    },
    error: err => { console.warn('Opus encoder failed, falling back to μ-law', err); encoderBroken = true; closeEncoder(); refreshMode(); },
  });
  encoder.configure(OPUS_ENCODER);
}

function feedEncoder(block) {
  if (!encoder || encoder.state !== 'configured') startEncoder();
  if (encoder.encodeQueueSize > 10) return; // the encoder is behind: drop rather than add delay
  const data = new AudioData({
    format: 'f32', sampleRate: OPUS_RATE, numberOfFrames: block.length, numberOfChannels: 1,
    timestamp: encodedBlocks++ * 20000, data: block,
  });
  try { encoder.encode(data); } finally { data.close(); }
}

// One 20 ms block from the mic: encode it while speaking (plus pre-roll and hangover).
function encodeBlock(block) {
  let energy = 0;
  for (let i = 0; i < block.length; i++) energy += block[i] * block[i];
  try {
    if (Math.sqrt(energy / block.length) > VAD_LEVEL) {
      if (vadHang === 0) { for (const b of preroll) feedEncoder(b); preroll = []; }
      vadHang = VAD_HANGOVER;
      feedEncoder(block);
    } else if (vadHang > 0) {
      vadHang--;
      feedEncoder(block);
    } else {
      preroll.push(block);
      if (preroll.length > VAD_PREROLL) preroll.shift();
    }
  } catch (err) {
    console.warn('Opus encoding failed, falling back to μ-law', err);
    encoderBroken = true; closeEncoder(); refreshMode();
  }
}

function decodeOpus(from, bytes) {
  let entry = decoders.get(from);
  if (!entry || entry.decoder.state === 'closed') {
    const decoder = new AudioDecoder({
      output: audio => {
        const pcm = new Float32Array(audio.numberOfFrames);
        audio.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
        const rate = audio.sampleRate;
        audio.close();
        if (enabled && ctx) playerFor(from).port.postMessage({ pcm, rate }, [pcm.buffer]);
      },
      error: err => { console.warn('Opus decoder failed', err); decoders.delete(from); },
    });
    decoder.configure(OPUS_DECODER);
    entry = { decoder, ts: 0 };
    decoders.set(from, entry);
  }
  try {
    entry.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: (entry.ts += 20000), data: bytes }));
  } catch (err) {
    console.warn('Opus decode failed', err);
    try { entry.decoder.close(); } catch {}
    decoders.delete(from);
  }
}

// Opus only if everyone else in voice can decode it; otherwise the μ-law fallback.
function refreshMode() {
  const peers = (store.roomState?.users || []).filter(u => u.voice && u.id !== socket.id);
  useOpus = opusOk && !encoderBroken && peers.every(u => u.opus);
  const mode = useOpus ? 'opus' : 'legacy';
  if (mode === sentMode || !micNode) return;
  sentMode = mode;
  vadHang = 0; preroll = [];
  micNode.port.postMessage({ raw: useOpus, legacy: !useOpus });
}

// Highlights the avatar of whoever is talking right now.
function renderSpeaking() {
  const now = Date.now();
  for (const row of document.querySelectorAll('#people .person[data-id], .hall-tile[data-id]')) {
    row.classList.toggle('speaking', (speakingUntil.get(row.dataset.id) || 0) > now);
  }
}

// Called on every room state: drop players of users who left, refresh the counter.
export function pruneVoicePeers(users) {
  const ids = new Set(users.filter(u => u.voice).map(u => u.id));
  for (const [id, player] of players) if (!ids.has(id)) { player.disconnect(); players.delete(id); }
  for (const [id, { decoder }] of decoders) if (!ids.has(id)) { try { decoder.close(); } catch {} decoders.delete(id); }
  for (const id of speakingUntil.keys()) if (!ids.has(id) && id !== socket.id) speakingUntil.delete(id);
  updateStatus();
  renderSpeaking();
}

// Mic on/off: the button in the voice card and the Windows app hotkey.
export function toggleMute() {
  if (!enabled) return toast('🎙 Сначала включи голосовую связь');
  muted = !muted;
  updateStatus();
  updateControls();
  toast(muted ? '🔇 Микрофон выключен' : '🎙 Микрофон включён');
}

export function initVoice() {
  socket.on('voice:data', (from, chunk) => {
    if (!enabled || !ctx || !(chunk instanceof ArrayBuffer) || !chunk.byteLength) return;
    if (chunk.byteLength === LEGACY_FRAME) {
      speakingUntil.set(from, Date.now() + SPEAKING_HOLD_MS);
      playerFor(from).port.postMessage(chunk, [chunk]);
    } else if (new Uint8Array(chunk)[0] === OPUS_TAG && typeof AudioDecoder === 'function') {
      speakingUntil.set(from, Date.now() + SPEAKING_HOLD_MS);
      decodeOpus(from, new Uint8Array(chunk, 1));
    }
  });
  // A reconnect gives a new socket that is not in voice yet.
  // initVoice runs after initRoom, so the room is re-joined first.
  socket.on('connect', () => { if (enabled) { sentMode = ''; socket.emit('voice:join', { opus: opusOk }); } });
  $('voiceToggle').addEventListener('change', e => { if (e.target.checked) enableVoice(); else disableVoice(); });
  $('micMute').onclick = toggleMute;

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
