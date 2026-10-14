// Video stage: direct files (MP4/WebM/HLS) and embedded players.
import { $, setHint, toast, showError, loadScript } from './dom.js';
import { socket, store } from './state.js';
import { isVkEmbedUrl } from './embed-url.js';
import { initVkPlayer, resetVk, isVkReady, syncVkPlayback, getVkPosition } from './vk.js';

const HLS_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
const video = $('video'), embed = $('embed'), empty = $('empty'), errorBox = $('error');

let hls = null, applyingRemote = false, loadedMediaKey = '';

export function applyPlayerState(state) {
  if (state.media) {
    const mediaKey = `${state.media.type}|${state.media.url}`;
    if (loadedMediaKey !== mediaKey) { loadedMediaKey = mediaKey; loadMedia(state.media); }
  } else {
    loadedMediaKey = '';
    $('currentTitle').textContent = 'Выберите видео';
    $('syncStatus').textContent = 'ОЖИДАНИЕ';
  }
  if (state.media?.type === 'direct' && video.src) syncPlayback(state);
  if (state.media?.type === 'embed' && isVkEmbedUrl(state.media.url) && isVkReady()) syncVkPlayback(state);
}

// This viewer's own playback position, or null when it can't be read
// (YouTube/Twitch embeds don't expose it).
export function getLocalPosition() {
  const media = store.roomState?.media;
  if (!media) return null;
  if (media.type === 'direct') return video.src && Number.isFinite(video.currentTime) ? { time: video.currentTime, playing: !video.paused } : null;
  return isVkEmbedUrl(media.url) ? getVkPosition() : null;
}

function clearPlayer() {
  resetVk();
  if (hls) { hls.destroy(); hls = null; }
  video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
  embed.hidden = true; embed.removeAttribute('src');
  empty.hidden = false; errorBox.hidden = true;
}

function loadMedia(media) {
  clearPlayer();
  $('currentTitle').textContent = media.title || 'Видео';
  $('syncStatus').textContent = media.type === 'direct' ? 'СИНХРОННО' : 'EMBED';

  if (media.type === 'embed') {
    embed.hidden = false; empty.hidden = true; embed.src = media.url;
    if (isVkEmbedUrl(media.url)) { setHint('VK Видео: подключаем управление плеером…'); initVkPlayer(); }
    else setHint('Embed-плеер: управление зависит от сервиса');
    return;
  }

  video.hidden = false; empty.hidden = true;
  setHint('Прямая ссылка — синхронизация включена');
  if (/\.m3u8($|\?)/i.test(media.url) && !video.canPlayType('application/vnd.apple.mpegurl')) {
    loadHls(media.url, loadedMediaKey);
  } else {
    video.src = media.url;
    video.load();
  }
}

// hls.js is ~400 KB, so it is fetched only when an HLS stream is opened.
async function loadHls(url, mediaKey) {
  try { await loadScript(HLS_URL); } catch { return showError('Не удалось загрузить HLS-плеер. Проверьте интернет и обновите страницу.'); }
  if (mediaKey !== loadedMediaKey) return; // another video was chosen meanwhile
  if (!window.Hls?.isSupported()) return showError('Этот браузер не поддерживает HLS-потоки.');
  hls = new Hls();
  hls.loadSource(url);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, () => { if (store.roomState) syncPlayback(store.roomState); });
  hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) showError('Не удалось загрузить HLS-поток. Проверьте ссылку и доступ к источнику.'); });
}

function syncPlayback(state, threshold = 1.25) {
  const target = Math.max(0, state.time || 0) + (state.playing ? Math.max(0, (Date.now() - (state.updatedAt || Date.now())) / 1000) : 0);
  applyingRemote = true;
  if (Number.isFinite(target) && Math.abs(video.currentTime - target) > threshold) { try { video.currentTime = target; } catch {} }
  if (state.playing && video.paused) {
    video.play()?.catch?.(() => toast('Нажми Play: браузер заблокировал автозапуск'));
  } else if (!state.playing && !video.paused) video.pause();
  $('syncStatus').textContent = state.playing ? 'СМОТРИТЕ ВМЕСТЕ' : 'СИНХРОННО';
  setTimeout(() => { applyingRemote = false; }, 250);
}

// Where the room is right now according to the server state.
export function expectedRoomTime(state = store.roomState) {
  if (!state?.media) return null;
  return Math.max(0, state.time || 0) + (state.playing ? Math.max(0, (Date.now() - (state.updatedAt || Date.now())) / 1000) : 0);
}

// "Синхронизироваться": fetch the current room state and jump to it precisely.
function forceSync() {
  const media = store.roomState?.media;
  if (!media) return toast('Сначала запустите видео');
  if (media.type === 'embed' && !isVkEmbedUrl(media.url)) return toast('Этот плеер не даёт сайту управлять собой — перемотайте вручную');
  socket.emit('room:sync', {}, state => {
    if (!state?.media) return;
    if (state.media.type === 'direct') syncPlayback(state, 0.3);
    else if (isVkReady()) syncVkPlayback(state, 0.5);
    else return toast('VK-плеер ещё не подключился');
    toast('⟳ Синхронизировано с комнатой');
  });
}

// Fullscreen for the whole stage, so reactions stay visible over the video.
function toggleStageFullscreen() {
  const stage = $('stage');
  if (document.fullscreenElement) document.exitFullscreen?.();
  else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => toast('Браузер не разрешил полноэкранный режим'));
  else video.webkitEnterFullscreen?.(); // iPhone Safari: only the video itself can go fullscreen
}

function sendControl(action) {
  if (applyingRemote || store.roomState?.media?.type !== 'direct') return;
  socket.emit('media:control', { action, time: video.currentTime });
}

export function initPlayer() {
  $('syncBtn').onclick = forceSync;
  $('stageFullscreen').onclick = toggleStageFullscreen;
  video.addEventListener('play', () => sendControl('play'));
  video.addEventListener('pause', () => sendControl('pause'));
  video.addEventListener('seeked', () => sendControl('seek'));
  video.addEventListener('error', () => {
    if (video.error && store.roomState?.media?.type === 'direct') showError('Видео не загрузилось. Проверь ссылку, CORS и доступность файла.');
  });
}
