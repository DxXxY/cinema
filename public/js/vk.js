// VK Video player control through the VK JS API (loaded lazily).
import { $, setHint, loadScript } from './dom.js';
import { socket, store } from './state.js';
import { isVkEmbedUrl } from './embed-url.js';

const VK_API_URL = 'https://vk.com/js/api/videoplayer.js';
const INIT_RETRY_MS = 1500, INIT_ATTEMPTS = 20;
const embed = $('embed');

let vkPlayer = null, vkReady = false, vkApplyingRemote = false, vkInAd = false;
let vkLastControlAt = 0, vkLastObservedTime = null, vkLastObservedAt = 0;
let vkAttachTimer = null, vkSession = 0, vkPlaying = false;
let vkSeekedSeen = false;    // the player reports seeks itself; no need to guess from timeupdate
let vkPendingSeek = null;    // { target, at, playing }: a seek we made to follow the room
let vkJumpCandidate = null;  // { time, at }: a timeupdate jump waiting for confirmation

export const isVkReady = () => !!vkPlayer && vkReady;

// During an ad VK reports the ad's time, not the film's.
export const getVkPosition = () => (isVkReady() && !vkInAd ? { time: vkTime(), playing: vkPlaying } : null);

// Play/pause from a hotkey; the player events then sync the room.
export function toggleVkPlayback() {
  if (!isVkReady()) return false;
  if (vkPlaying) vkPlayer.pause?.(); else vkPlayer.play?.();
  return true;
}

export function resetVk() {
  vkSession++;
  // The iframe element is reused for the next video, so an old player object
  // would keep receiving its messages and handle every event twice.
  try { vkPlayer?.destroy?.(); } catch {}
  vkPlayer = null; vkReady = false; vkApplyingRemote = false; vkPlaying = false; vkInAd = false;
  vkLastObservedTime = null; vkLastObservedAt = 0;
  vkSeekedSeen = false; vkPendingSeek = null; vkJumpCandidate = null;
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

// The player is usable only after it answers "inited". An init message sent while
// the iframe is still loading is lost, and then every command would be queued
// forever — so keep re-sending init until the player answers. VK answers only
// once, so earlier candidates keep listening too; the first one to hear it wins.
function startAttach(session) {
  const candidates = [];
  let attempts = 0;
  const dropCandidates = keep => {
    for (const c of candidates.splice(0)) if (c !== keep) try { c.destroy?.(); } catch {}
  };
  const tryInit = () => {
    if (session !== vkSession || vkReady) return dropCandidates();
    try {
      if (!embed.isConnected || !isVkEmbedUrl(embed.src) || !window.VK?.VideoPlayer) return;
      const player = window.VK.VideoPlayer(embed);
      candidates.push(player);
      player.on('inited', () => {
        if (session !== vkSession) { try { player.destroy?.(); } catch {} return; }
        if (vkReady) return;
        dropCandidates(player);
        vkPlayer = player; vkReady = true;
        if (vkAttachTimer) clearInterval(vkAttachTimer);
        vkAttachTimer = null;
        bindVkEvents();
        setHint('VK Видео подключено — синхронизация доступна');
        if (store.roomState) syncVkPlayback(store.roomState);
      });
    } catch (err) {
      console.warn('VK Video API init failed', err);
    }
  };
  embed.addEventListener('load', () => { if (session === vkSession && !vkReady) tryInit(); }, { once: true });
  tryInit();
  vkAttachTimer = setInterval(() => {
    if (session !== vkSession || vkReady) return dropCandidates();
    if (++attempts >= INIT_ATTEMPTS) {
      clearInterval(vkAttachTimer);
      vkAttachTimer = null;
      dropCandidates();
      return setHint('VK-видео открыто, но API управления не подключилось');
    }
    tryInit();
  }, INIT_RETRY_MS);
}

function bindVkEvents() {
  const onStart = () => {
    vkPlaying = true;
    if (vkInAd || vkApplyingRemote) return;
    if (store.roomState?.playing) {
      // The room is already playing, so this viewer started late (e.g. the browser
      // blocked autoplay): catch up instead of rewinding everyone. Right after our
      // own seek the room state is not updated yet — leave it alone then.
      if (Date.now() - vkLastControlAt > 2000) syncVkPlayback(store.roomState);
      return;
    }
    sendVkControl('play');
  };
  vkPlayer.on('started', onStart);
  vkPlayer.on('resumed', onStart);
  vkPlayer.on('paused', () => {
    vkPlaying = false;
    if (!vkInAd) sendVkControl('pause');
  });

  vkPlayer.on('seeked', payload => {
    vkSeekedSeen = true;
    vkJumpCandidate = null;
    if (vkInAd) return;
    const t = normalizeVkTime(payload);
    if (t === null) return;
    vkLastObservedTime = t; vkLastObservedAt = Date.now();
    if (isOwnSeek(t)) return;
    sendVkControl('seek', t);
  });

  // Ads: their time is not the film's time, and VK ignores seeks while one plays.
  // Catch up with the room when it ends.
  vkPlayer.on('adStarted', () => { vkInAd = true; vkJumpCandidate = null; setHint('VK показывает рекламу — после неё догоним комнату'); });
  vkPlayer.on('adCompleted', () => {
    vkInAd = false;
    vkLastObservedTime = null;
    setHint('VK Видео подключено — синхронизация доступна');
    setTimeout(() => { if (store.roomState && !vkInAd) syncVkPlayback(store.roomState); }, 600);
  });

  // Fallback for players that don't report "seeked": detect a jump in timeupdate.
  // A jump is sent only after the next timeupdate confirms playback continues from
  // there — single odd readings while buffering must not move the whole room.
  vkPlayer.on('timeupdate', payload => {
    if (vkInAd) return;
    const t = normalizeVkTime(payload);
    if (t === null) return;
    const now = Date.now();
    if (!vkSeekedSeen && !vkApplyingRemote && vkLastObservedTime !== null) {
      if (vkJumpCandidate) {
        const expected = vkJumpCandidate.time + (vkPlaying ? (now - vkJumpCandidate.at) / 1000 : 0);
        if (Math.abs(t - expected) < 1.5 && !isOwnSeek(vkJumpCandidate.time)) sendVkControl('seek', t);
        vkJumpCandidate = null;
      } else {
        const elapsed = (now - vkLastObservedAt) / 1000;
        if (Math.abs(t - vkLastObservedTime - elapsed) > 2.5) vkJumpCandidate = { time: t, at: now };
      }
    }
    vkLastObservedTime = t; vkLastObservedAt = now;
  });
}

// A seek event caused by syncVkPlayback (following the room), not by this viewer.
function isOwnSeek(t) {
  const pending = vkPendingSeek;
  if (!pending || Date.now() - pending.at > 10000) return false;
  const expected = pending.target + (pending.playing ? (Date.now() - pending.at) / 1000 : 0);
  if (Math.abs(t - expected) > 3) return false;
  vkPendingSeek = null;
  return true;
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

function sendVkControl(action, time = vkTime()) {
  const media = store.roomState?.media;
  if (vkApplyingRemote || vkInAd || !vkReady || media?.type !== 'embed' || !isVkEmbedUrl(media.url)) return;
  vkLastControlAt = Date.now();
  vkLastObservedTime = time; vkLastObservedAt = vkLastControlAt;
  socket.emit('media:control', { action, time });
}

const roomTarget = state => Math.max(0, Number(state.time) || 0) + (state.playing ? Math.max(0, (Date.now() - (state.updatedAt || Date.now())) / 1000) : 0);

export function syncVkPlayback(state, threshold = 2) {
  if (!isVkReady() || vkInAd || state?.media?.type !== 'embed' || !isVkEmbedUrl(state.media.url)) return;
  let target = roomTarget(state);
  const duration = vkDuration();
  if (Number.isFinite(duration) && duration > 0 && target > duration + 5) {
    // Reject stale/corrupt timestamps rather than seeking to the end of the video.
    target = vkTime();
    console.warn('Ignored invalid VK sync timestamp outside video duration');
  }
  vkApplyingRemote = true;
  vkJumpCandidate = null;
  try {
    if (Number.isFinite(target) && Math.abs(vkTime() - target) > threshold) {
      vkPendingSeek = { target, at: Date.now(), playing: state.playing };
      vkPlayer.seek?.(target);
      verifySeek(vkSession, state.updatedAt);
    }
    if (state.playing) vkPlayer.play?.(); else vkPlayer.pause?.();
    vkPlaying = state.playing;
    vkLastObservedTime = target; vkLastObservedAt = Date.now();
    $('syncStatus').textContent = state.playing ? 'СМОТРИТЕ ВМЕСТЕ' : 'СИНХРОННО';
  } catch (err) { console.warn('VK sync failed', err); }
  setTimeout(() => { vkApplyingRemote = false; }, 900);
}

// A seek sent while the player is still buffering can be dropped by VK.
// Check a moment later and repeat it if the player is still elsewhere.
function verifySeek(session, updatedAt, attempt = 1) {
  setTimeout(() => {
    const state = store.roomState;
    // Give up if the video or the room state changed meanwhile — a newer sync handles it.
    if (session !== vkSession || !isVkReady() || vkInAd || !state || state.updatedAt !== updatedAt) return;
    const target = roomTarget(state);
    if (Math.abs(vkTime() - target) <= 4) return;
    vkPendingSeek = { target, at: Date.now(), playing: state.playing };
    vkApplyingRemote = true;
    try { vkPlayer.seek?.(target); } catch {}
    setTimeout(() => { vkApplyingRemote = false; }, 900);
    if (attempt < 3) verifySeek(session, updatedAt, attempt + 1);
  }, 3000);
}
