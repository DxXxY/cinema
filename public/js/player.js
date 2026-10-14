// Video stage: direct files (MP4/WebM/HLS) and embedded players.
import { $, setHint, toast, showError, loadScript } from './dom.js';
import { socket, store } from './state.js';
import { isVkEmbedUrl } from './embed-url.js';
import { initVkPlayer, resetVk, isVkReady, syncVkPlayback } from './vk.js';

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

function syncPlayback(state) {
  const target = Math.max(0, state.time || 0) + (state.playing ? Math.max(0, (Date.now() - (state.updatedAt || Date.now())) / 1000) : 0);
  applyingRemote = true;
  if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 1.25) { try { video.currentTime = target; } catch {} }
  if (state.playing && video.paused) {
    video.play()?.catch?.(() => toast('Нажми Play: браузер заблокировал автозапуск'));
  } else if (!state.playing && !video.paused) video.pause();
  $('syncStatus').textContent = state.playing ? 'СМОТРИТЕ ВМЕСТЕ' : 'СИНХРОННО';
  setTimeout(() => { applyingRemote = false; }, 250);
}

function sendControl(action) {
  if (applyingRemote || store.roomState?.media?.type !== 'direct') return;
  socket.emit('media:control', { action, time: video.currentTime });
}

export function initPlayer() {
  video.addEventListener('play', () => sendControl('play'));
  video.addEventListener('pause', () => sendControl('pause'));
  video.addEventListener('seeked', () => sendControl('seek'));
  video.addEventListener('error', () => {
    if (video.error && store.roomState?.media?.type === 'direct') showError('Видео не загрузилось. Проверь ссылку, CORS и доступность файла.');
  });
}
