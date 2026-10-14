// VK Video player control through the VK JS API (loaded lazily).
import { $, setHint, loadScript } from './dom.js';
import { socket, store } from './state.js';
import { isVkEmbedUrl } from './embed-url.js';

const VK_API_URL = 'https://vk.com/js/api/videoplayer.js';
const embed = $('embed');

let vkPlayer = null, vkReady = false, vkApplyingRemote = false;
let vkLastControlAt = 0, vkLastObservedTime = null, vkLastObservedAt = 0;
let vkAttachTimer = null, vkSession = 0;

export const isVkReady = () => !!vkPlayer && vkReady;

export function resetVk() {
  vkSession++;
  vkPlayer = null; vkReady = false; vkApplyingRemote = false;
  vkLastObservedTime = null; vkLastObservedAt = 0;
  if (vkAttachTimer) clearInterval(vkAttachTimer);
  vkAttachTimer = null;
}

export function initVkPlayer() {
  resetVk();
  const session = vkSession;
  loadScript(VK_API_URL)
    .then(() => { if (session === vkSession) startAttach(session); })
    .catch(() => { if (session === vkSession) setHint('Не удалось загрузить VK API — управление недоступно'); });
}

function startAttach(session) {
  const attach = () => {
    if (session !== vkSession) return true;
    if (vkReady) return true;
    try {
      if (!embed.isConnected || !isVkEmbedUrl(embed.src)) return false;
      if (!window.VK?.VideoPlayer) return false;
      const candidate = window.VK.VideoPlayer(embed);
      if (!candidate) return false;
      vkPlayer = candidate; vkReady = true;
      if (vkAttachTimer) clearInterval(vkAttachTimer);
      vkAttachTimer = null;
      setHint('VK Видео подключено — синхронизация доступна');
      if (store.roomState) syncVkPlayback(store.roomState);
      if (typeof vkPlayer.on === 'function') bindVkEvents();
      return true;
    } catch (err) {
      console.warn('VK Video API init failed', err);
      return false;
    }
  };
  embed.addEventListener('load', attach, { once: true });
  // The iframe may still be loading; retry briefly instead of failing silently.
  if (attach()) return;
  let attempts = 0;
  vkAttachTimer = setInterval(() => {
    attempts++;
    if (attach() || attempts >= 30) {
      if (vkAttachTimer) clearInterval(vkAttachTimer);
      vkAttachTimer = null;
      if (!vkReady && session === vkSession) setHint('VK-видео открыто, но API управления не подключилось');
    }
  }, 500);
}

function bindVkEvents() {
  vkPlayer.on('started', () => sendVkControl('play'));
  vkPlayer.on('resumed', () => sendVkControl('play'));
  vkPlayer.on('paused', () => sendVkControl('pause'));
  // timeupdate fires continuously. Compare it with elapsed wall time so ordinary
  // playback is not mistaken for a seek; only send a command for a real jump.
  vkPlayer.on('timeupdate', payload => {
    if (vkApplyingRemote) return;
    const t = normalizeVkTime(payload);
    if (t === null) return;
    const now = Date.now();
    if (vkLastObservedTime !== null && vkLastObservedAt) {
      const elapsed = (now - vkLastObservedAt) / 1000;
      const delta = t - vkLastObservedTime;
      if (Math.abs(delta - elapsed) > 2.5 && now - vkLastControlAt > 700) {
        vkLastControlAt = now;
        socket.emit('media:control', { action: 'seek', time: t });
      }
    }
    vkLastObservedTime = t; vkLastObservedAt = now;
  });
}

function vkDuration() {
  try {
    const d = vkPlayer?.getDuration?.();
    return Number(d?.duration ?? d?.time ?? d);
  } catch { return NaN; }
}

function normalizeVkTime(value) {
  let t = Number(value?.time ?? value?.currentTime ?? value);
  if (!Number.isFinite(t) || t < 0) return null;
  // VK usually reports seconds, but some events expose milliseconds. Use the
  // duration as a sanity check so ms values don't become huge seeks.
  const duration = vkDuration();
  if (Number.isFinite(duration) && duration > 0) {
    if (t > duration + 5 && t / 1000 <= duration + 5) t /= 1000;
    // Ignore out-of-range readings; they could push everyone to the end of the video.
    if (t > duration + 5) return null;
  } else if (t > 24 * 60 * 60) {
    return null;
  }
  return t;
}

function vkTime() {
  try { return normalizeVkTime(vkPlayer?.getCurrentTime?.()) ?? 0; } catch { return 0; }
}

function sendVkControl(action) {
  const media = store.roomState?.media;
  if (vkApplyingRemote || !vkReady || media?.type !== 'embed' || !isVkEmbedUrl(media.url)) return;
  const time = vkTime();
  vkLastControlAt = Date.now();
  vkLastObservedTime = time; vkLastObservedAt = vkLastControlAt;
  socket.emit('media:control', { action, time });
}

export function syncVkPlayback(state) {
  if (!isVkReady() || state?.media?.type !== 'embed' || !isVkEmbedUrl(state.media.url)) return;
  let target = Math.max(0, Number(state.time) || 0) + (state.playing ? Math.max(0, (Date.now() - (state.updatedAt || Date.now())) / 1000) : 0);
  const duration = vkDuration();
  if (Number.isFinite(duration) && duration > 0 && target > duration + 5) {
    // Reject stale/corrupt timestamps rather than seeking to the end of the video.
    target = vkTime();
    console.warn('Ignored invalid VK sync timestamp outside video duration');
  }
  vkApplyingRemote = true;
  try {
    if (Number.isFinite(target) && Math.abs(vkTime() - target) > 2) vkPlayer.seek?.(target);
    if (state.playing) vkPlayer.play?.(); else vkPlayer.pause?.();
    vkLastObservedTime = target; vkLastObservedAt = Date.now();
    $('syncStatus').textContent = state.playing ? 'СМОТРИТЕ ВМЕСТЕ' : 'СИНХРОННО';
  } catch (err) { console.warn('VK sync failed', err); }
  setTimeout(() => { vkApplyingRemote = false; }, 900);
}
