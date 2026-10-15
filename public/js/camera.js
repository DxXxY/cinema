// Webcams in the cinema hall. Like the voice, video goes through our own server
// (no WebRTC): frames are encoded with VP8 via WebCodecs, relayed by Socket.IO
// to the people in the hall and decoded per sender into a <canvas>.
// Packet: [kind=2, flags (bit 0 = keyframe), seq hi, seq lo, ...VP8 data].
import { socket } from './state.js';

const KIND_VP8 = 2;
const HEADER = 4;
const KEY_INTERVAL_MS = 2000;   // a fresh keyframe every 2 s heals lost frames
const KEYREQ_GAP_MS = 1000;     // ask one sender for a keyframe at most once a second
// Quality by the number of cameras: the server sends every frame to everyone else
// in the hall, so with more people each camera gets smaller.
const PROFILES = {
  medium: { width: 480, height: 360, fps: 20, bitrate: 350_000 },
  small: { width: 320, height: 240, fps: 15, bitrate: 150_000 },
};

let stream = null, video = null, canvas = null, ctx2d = null, encoder = null, timer = 0;
let profile = PROFILES.medium, seq = 0, frameNo = 0, lastKeyAt = 0, forceKey = false;
const remotes = new Map(); // sender id -> { decoder, lastSeq, needKey, keyReqAt, canvas }

export const cameraSupported = () =>
  typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function' && typeof VideoFrame === 'function' && !!navigator.mediaDevices?.getUserMedia;

export const localStream = () => stream;

const encoderConfig = p => ({ codec: 'vp8', width: p.width, height: p.height, bitrate: p.bitrate, framerate: p.fps, latencyMode: 'realtime' });

export async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, max: 30 }, facingMode: 'user' },
    audio: false,
  });
  video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play().catch(() => {});
  canvas = document.createElement('canvas');
  ctx2d = canvas.getContext('2d', { alpha: false });
  configureEncoder();
  socket.on('cam:keyreq', onKeyRequest);
  return stream;
}

export function stopCamera() {
  clearInterval(timer); timer = 0;
  socket.off('cam:keyreq', onKeyRequest);
  try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch {}
  encoder = null;
  stream?.getTracks().forEach(t => t.stop());
  stream = null; video = null; canvas = null; ctx2d = null;
}

// Picks the quality for this many cameras in the hall; re-configures on change.
export function setCameraCount(count) {
  const next = count <= 3 ? PROFILES.medium : PROFILES.small;
  if (next === profile) return;
  profile = next;
  if (stream) configureEncoder();
}

function onKeyRequest() { forceKey = true; }

function configureEncoder() {
  clearInterval(timer);
  try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch {}
  canvas.width = profile.width; canvas.height = profile.height;
  encoder = new VideoEncoder({
    output: chunk => {
      const packet = new Uint8Array(HEADER + chunk.byteLength);
      packet[0] = KIND_VP8;
      packet[1] = chunk.type === 'key' ? 1 : 0;
      seq = (seq + 1) & 0xffff;
      packet[2] = seq >> 8; packet[3] = seq & 0xff;
      chunk.copyTo(packet.subarray(HEADER));
      socket.volatile.emit('cam:data', packet.buffer);
    },
    error: err => console.warn('Camera encoder failed', err),
  });
  encoder.configure(encoderConfig(profile));
  forceKey = true;
  timer = setInterval(captureFrame, 1000 / profile.fps);
}

function captureFrame() {
  if (!encoder || encoder.state !== 'configured' || !video || video.readyState < 2) return;
  if (encoder.encodeQueueSize > 2) return; // a slow PC: skip frames instead of piling up delay
  // Crop the camera picture to the target 4:3 frame.
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(canvas.width / vw, canvas.height / vh);
  const w = vw * scale, h = vh * scale;
  ctx2d.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  const now = performance.now();
  const keyFrame = forceKey || now - lastKeyAt > KEY_INTERVAL_MS;
  const frame = new VideoFrame(canvas, { timestamp: Math.round(frameNo++ * 1e6 / profile.fps) });
  try { encoder.encode(frame, { keyFrame }); } finally { frame.close(); }
  if (keyFrame) { lastKeyAt = now; forceKey = false; }
}

// ——— Receiving ———

// `target` is the <canvas> of the sender's tile; it may change when tiles are rebuilt.
export function receiveCamData(from, buffer, target) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength <= HEADER || typeof VideoDecoder !== 'function') return;
  const head = new Uint8Array(buffer, 0, HEADER);
  if (head[0] !== KIND_VP8) return;
  const key = (head[1] & 1) === 1;
  const packetSeq = (head[2] << 8) | head[3];
  let r = remotes.get(from);
  if (!r) { r = { decoder: null, lastSeq: -1, needKey: true, keyReqAt: 0, canvas: target }; remotes.set(from, r); }
  r.canvas = target;
  // A missing frame breaks every frame after it until the next keyframe.
  if (r.lastSeq >= 0 && packetSeq !== ((r.lastSeq + 1) & 0xffff)) r.needKey = true;
  r.lastSeq = packetSeq;
  if (r.needKey && !key) return askKey(from, r);
  if (!r.decoder || r.decoder.state === 'closed') r.decoder = makeDecoder(from, r);
  try {
    r.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: packetSeq * 1000, data: new Uint8Array(buffer, HEADER) }));
    r.needKey = false;
  } catch (err) {
    console.warn('Camera decode failed', err);
    resetDecoder(r);
    askKey(from, r);
  }
}

function makeDecoder(from, r) {
  const decoder = new VideoDecoder({
    output: frame => {
      const c = r.canvas;
      if (c) {
        if (c.width !== frame.displayWidth) c.width = frame.displayWidth;
        if (c.height !== frame.displayHeight) c.height = frame.displayHeight;
        c.getContext('2d').drawImage(frame, 0, 0);
      }
      frame.close();
    },
    error: err => { console.warn('Camera decoder failed', err); resetDecoder(r); askKey(from, r); },
  });
  decoder.configure({ codec: 'vp8', optimizeForLatency: true });
  return decoder;
}

function resetDecoder(r) {
  try { if (r.decoder && r.decoder.state !== 'closed') r.decoder.close(); } catch {}
  r.decoder = null;
  r.needKey = true;
}

function askKey(from, r) {
  const now = Date.now();
  if (now - r.keyReqAt < KEYREQ_GAP_MS) return;
  r.keyReqAt = now;
  socket.emit('cam:keyreq', { from });
}

// The camera of `id` is off or the person left: free its decoder.
export function dropRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  resetDecoder(r);
  remotes.delete(id);
}

export function dropAllRemotes() {
  for (const id of [...remotes.keys()]) dropRemote(id);
}
