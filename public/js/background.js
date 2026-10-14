// Animated "dead inside" background (Tokyo Ghoul vibe): falling columns of the
// 1000-7 countdown, flickering thin vertical lines and occasional glitches.
// Drawn on a canvas behind the page; colors follow the site palette.
const FPS = 30;
const CELL = 18;                 // column width / row height in px
const ACTIVE_SHARE = 0.4;        // share of columns with a falling stream
const PURPLE = '#a78bfa', PINK = '#f472b6', RED = '#f43f5e', CYAN = '#22d3ee';
const KANJI = '喰種';

function buildSequence() {
  let s = '', n = 1000;
  while (n > 6) { s += `${n}-7=${n - 7} `; n -= 7; }
  return s;
}
const SEQ = buildSequence();
const rand = (a, b) => a + Math.random() * (b - a);

// Options let the home page use a brighter, busier variant.
export function initBackground({ activeShare = ACTIVE_SHARE, brightness = 1, glitchEvery = [4000, 9000] } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'bg-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let w = 0, h = 0, dpr = 1, rows = 0, columns = [], lines = [];
  let glitchUntil = 0, nextGlitch = performance.now() + rand(glitchEvery[0] * 0.7, glitchEvery[1] * 0.8);

  const newStream = (col, fromTop) => {
    col.active = Math.random() < activeShare;
    col.head = fromTop ? -rand(0, 25) : rand(0, rows);
    col.speed = rand(2, 6.5);          // rows per second
    col.len = Math.floor(rand(8, 24));
    col.offset = Math.floor(rand(0, SEQ.length));
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    rows = Math.ceil(h / CELL);
    columns = Array.from({ length: Math.ceil(w / CELL) }, () => { const c = {}; newStream(c, false); return c; });
    lines = Array.from({ length: Math.max(4, Math.round(w / 220)) }, () => ({ x: Math.floor(rand(0, w)), alpha: rand(0.03, 0.08), flash: 0 }));
  }

  function drawStreams(dt, glitching) {
    ctx.font = `600 13px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    columns.forEach((col, i) => {
      col.head += col.speed * dt;
      if (col.head - col.len > rows) newStream(col, true);
      if (!col.active) return;
      const x = i * CELL + CELL / 2, head = Math.floor(col.head);
      for (let k = 0; k < col.len; k++) {
        const r = head - k;
        if (r < 0 || r >= rows) continue;
        let ch = SEQ[(col.offset + r) % SEQ.length];
        if (ch === ' ') continue;
        if (glitching && Math.random() < 0.15) ch = String(Math.floor(Math.random() * 10));
        if (k === 0) { ctx.fillStyle = PINK; ctx.globalAlpha = Math.min(1, 0.55 * brightness); }
        else { ctx.fillStyle = PURPLE; ctx.globalAlpha = Math.min(1, 0.28 * brightness) * (1 - k / col.len); }
        ctx.fillText(ch, x, r * CELL);
      }
    });
    ctx.globalAlpha = 1;
  }

  function drawLines() {
    for (const line of lines) {
      if (Math.random() < 0.004) { line.flash = 1; line.x = Math.floor(rand(0, w)); }
      line.flash *= 0.9;
      ctx.fillStyle = line.flash > 0.05 ? PINK : PURPLE;
      ctx.globalAlpha = line.alpha + line.flash * 0.35;
      ctx.fillRect(line.x, 0, 1, h);
    }
    ctx.globalAlpha = 1;
  }

  // Vertical 喰種 along the left edge, where the page leaves free space.
  function drawKanji(glitching) {
    const size = Math.max(56, Math.min(110, h * 0.13));
    ctx.font = `900 ${size}px "Yu Mincho", "MS Mincho", serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const x = 14, y0 = h - size * KANJI.length - 30;
    const draw = (dx, dy) => [...KANJI].forEach((ch, i) => ctx.fillText(ch, x + dx, y0 + i * size + dy));
    if (glitching) {
      ctx.globalAlpha = 0.14; ctx.fillStyle = RED; draw(-rand(3, 9), 0);
      ctx.fillStyle = CYAN; draw(rand(3, 9), rand(-3, 3));
    }
    ctx.globalAlpha = 0.07; ctx.fillStyle = PURPLE; draw(0, 0);
    ctx.globalAlpha = 1;
  }

  // Shift a few horizontal slices of what is already drawn, plus tinted bars.
  function drawGlitch() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 5; i++) {
      const y = Math.floor(rand(0, canvas.height)), bh = Math.floor(rand(2, 26) * dpr);
      ctx.drawImage(canvas, 0, y, canvas.width, bh, Math.floor(rand(-30, 30) * dpr), y, canvas.width, bh);
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = Math.random() < 0.5 ? PINK : CYAN;
      ctx.fillRect(0, y, canvas.width, Math.max(1, bh / 3));
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let last = performance.now(), frameTimer = 0, raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - frameTimer < 1000 / FPS) return;
    frameTimer = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (now > nextGlitch) { glitchUntil = now + rand(120, 320); nextGlitch = now + rand(glitchEvery[0], glitchEvery[1]); }
    const glitching = now < glitchUntil;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawKanji(glitching);
    drawLines();
    drawStreams(dt, glitching);
    if (glitching) drawGlitch();
  }

  function renderStatic() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawKanji(false); drawLines(); drawStreams(0, false);
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); if (reduceMotion) renderStatic(); }, 150);
  });
  resize();
  if (reduceMotion) return renderStatic();

  // Don't burn CPU in a background tab.
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
  raf = requestAnimationFrame(frame);
}
