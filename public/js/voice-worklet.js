// AudioWorklet processors for voice chat that goes through our own server.
// mic-capture: microphone -> either raw 20 ms blocks at the device rate (for the
//   Opus encoder in voice.js) or, as a fallback, 16 kHz 8-bit μ-law frames (40 ms).
//   voice.js says which one it wants with { raw, legacy }.
// voice-player: audio from one speaker (μ-law frames or decoded Opus PCM) ->
//   small jitter buffer -> speakers.
const RATE = 16000;
const FRAME = 640;              // 40 ms at 16 kHz
const VAD_LEVEL = 0.01;         // RMS below this counts as silence
const VAD_HANGOVER = 8;         // keep sending 8 frames (~320 ms) after speech
const START_BUFFER = sampleRate * 0.08;  // wait for 80 ms of audio before playing
const MAX_BUFFER = sampleRate * 0.4;     // above 400 ms behind, drop to catch up
const CATCHUP_BUFFER = sampleRate * 0.12;

function encodeMulaw(s) {
  let x = Math.max(-1, Math.min(1, s)) * 32767 | 0;
  const sign = x < 0 ? 0x80 : 0;
  if (sign) x = -x;
  x = Math.min(x, 32635) + 0x84;
  let exp = 7;
  for (let mask = 0x4000; (x & mask) === 0 && exp > 0; mask >>= 1) exp--;
  return ~(sign | (exp << 4) | ((x >> (exp + 3)) & 0x0f)) & 0xff;
}

const MULAW_TABLE = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff, exp = (u >> 4) & 7;
  const x = ((((u & 0x0f) << 3) + 0x84) << exp) - 0x84;
  MULAW_TABLE[i] = (u & 0x80 ? -x : x) / 32768;
}

class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / RATE;
    this.phase = 0; this.acc = 0; this.count = 0;
    this.frame = new Uint8Array(FRAME); this.n = 0; this.energy = 0; this.hang = 0;
    this.raw = new Float32Array(Math.round(sampleRate / 50)); this.rawN = 0; // 20 ms
    this.sendRaw = false; this.sendLegacy = true;
    this.port.onmessage = e => { this.sendRaw = !!e.data.raw; this.sendLegacy = !!e.data.legacy; };
  }

  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      if (this.sendRaw) {
        this.raw[this.rawN++] = input[i];
        if (this.rawN === this.raw.length) {
          const block = this.raw;
          this.raw = new Float32Array(block.length); this.rawN = 0;
          this.port.postMessage(block, [block.buffer]);
        }
      }
      if (!this.sendLegacy) continue;
      // Downsample by averaging each window of input samples (simple low-pass).
      this.acc += input[i]; this.count++; this.phase++;
      if (this.phase < this.ratio) continue;
      this.phase -= this.ratio;
      const s = this.acc / this.count;
      this.acc = 0; this.count = 0;
      this.energy += s * s;
      this.frame[this.n++] = encodeMulaw(s);
      if (this.n === FRAME) this.flush();
    }
    return true;
  }

  flush() {
    // Send only while someone is speaking: silence costs no traffic.
    if (Math.sqrt(this.energy / FRAME) > VAD_LEVEL) this.hang = VAD_HANGOVER;
    if (this.hang > 0) {
      this.hang--;
      const out = this.frame.slice().buffer;
      this.port.postMessage(out, [out]);
    }
    this.n = 0; this.energy = 0;
  }
}

class VoicePlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = []; this.cur = null; this.idx = 0; this.buffered = 0; // in device-rate samples
    this.playing = false; this.tail = 0;
    this.port.onmessage = e => {
      // An ArrayBuffer is a μ-law frame at 16 kHz; otherwise { pcm, rate } decoded from Opus.
      let frame, rate;
      if (e.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(e.data);
        frame = new Float32Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) frame[i] = MULAW_TABLE[bytes[i]];
        rate = RATE;
      } else { frame = e.data.pcm; rate = e.data.rate; }
      frame = this.toDeviceRate(frame, rate);
      this.queue.push(frame); this.buffered += frame.length;
      // Fell too far behind (network hiccup): drop the oldest audio to catch up.
      if (this.buffered > MAX_BUFFER) {
        while (this.buffered > CATCHUP_BUFFER && this.queue.length > 1) this.buffered -= this.queue.shift().length;
      }
    };
  }

  // Linear interpolation up to the device rate. The last sample of the previous
  // frame is kept so there is no step at the seam between frames.
  toDeviceRate(frame, rate) {
    if (!frame.length) return frame;
    const last = frame[frame.length - 1];
    if (rate !== sampleRate) {
      const ratio = rate / sampleRate;
      const out = new Float32Array(Math.round(frame.length / ratio));
      for (let i = 0; i < out.length; i++) {
        const p = i * ratio - 1, k = Math.floor(p), f = p - k;
        const a = k < 0 ? this.tail : frame[k], b = frame[k + 1] ?? last;
        out[i] = a + (b - a) * f;
      }
      frame = out;
    }
    this.tail = last;
    return frame;
  }

  nextSample() {
    if (!this.cur || this.idx >= this.cur.length) {
      this.cur = this.queue.shift(); this.idx = 0;
      if (!this.cur) return null;
    }
    this.buffered--;
    return this.cur[this.idx++];
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!this.playing && this.buffered >= START_BUFFER) this.playing = true;
    for (let i = 0; i < out.length; i++) {
      if (!this.playing) { out[i] = 0; continue; }
      const s = this.nextSample();
      if (s === null) { this.playing = false; out[i] = 0; continue; } // ran dry: refill before playing again
      out[i] = s;
    }
    return true;
  }
}

registerProcessor('mic-capture', MicCapture);
registerProcessor('voice-player', VoicePlayer);
