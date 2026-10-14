// AudioWorklet processors for voice chat that goes through our own server.
// mic-capture: microphone -> 16 kHz mono -> 8-bit μ-law frames (40 ms each).
// voice-player: μ-law frames from one speaker -> small jitter buffer -> speakers.
const RATE = 16000;
const FRAME = 640;              // 40 ms at 16 kHz
const VAD_LEVEL = 0.01;         // RMS below this counts as silence
const VAD_HANGOVER = 8;         // keep sending 8 frames (~320 ms) after speech
const START_BUFFER = RATE * 0.08;  // wait for 80 ms of audio before playing
const MAX_BUFFER = RATE * 0.4;     // above 400 ms behind, drop to catch up
const CATCHUP_BUFFER = RATE * 0.12;

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
  }

  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
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
    this.queue = []; this.cur = null; this.idx = 0; this.buffered = 0;
    this.playing = false; this.step = RATE / sampleRate; this.frac = 0; this.a = 0; this.b = 0;
    this.port.onmessage = e => {
      const bytes = new Uint8Array(e.data);
      const frame = new Float32Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) frame[i] = MULAW_TABLE[bytes[i]];
      this.queue.push(frame); this.buffered += frame.length;
      // Fell too far behind (network hiccup): drop the oldest audio to catch up.
      if (this.buffered > MAX_BUFFER) {
        while (this.buffered > CATCHUP_BUFFER && this.queue.length > 1) this.buffered -= this.queue.shift().length;
      }
    };
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
      // Upsample 16 kHz -> device rate with linear interpolation.
      this.frac += this.step;
      while (this.frac >= 1) {
        const s = this.nextSample();
        if (s === null) { this.playing = false; this.frac = 0; this.a = this.b = 0; break; }
        this.a = this.b; this.b = s; this.frac -= 1;
      }
      out[i] = this.playing ? this.a + (this.b - this.a) * this.frac : 0;
    }
    return true;
  }
}

registerProcessor('mic-capture', MicCapture);
registerProcessor('voice-player', VoicePlayer);
