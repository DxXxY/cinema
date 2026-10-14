// "Добавить фильм" form: source mode switch and URL submission.
import { $, toast } from './dom.js';
import { socket } from './state.js';
import { isVkEmbedUrl, makeEmbedUrl } from './embed-url.js';

let mode = 'direct';

function setMode(next) {
  mode = next;
  $('directMode').classList.toggle('active', mode === 'direct');
  $('embedMode').classList.toggle('active', mode === 'embed');
  $('mediaUrl').placeholder = mode === 'direct' ? 'https://example.com/movie.mp4' : 'Ссылка на VK Видео, YouTube или Twitch';
  $('sourceNote').textContent = mode === 'direct'
    ? 'Прямые MP4, WebM и HLS (.m3u8). Для них работает синхронизация воспроизведения.'
    : 'Вставь обычную ссылку на VK Видео, YouTube или Twitch — сайт попробует открыть оригинальный плеер. Некоторые видео запрещают встраивание.';
}

export function initSourceForm() {
  $('directMode').onclick = () => setMode('direct');
  $('embedMode').onclick = () => setMode('embed');
  $('mediaForm').addEventListener('submit', e => {
    e.preventDefault();
    const raw = $('mediaUrl').value.trim();
    let url;
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw Error();
      url = mode === 'embed' ? makeEmbedUrl(raw) : raw;
    } catch { return toast('Введи корректную ссылку с http:// или https://'); }
    socket.emit('media:set', { url, type: mode, title: $('mediaTitle').value.trim() || 'Видео' });
    if (mode === 'embed' && isVkEmbedUrl(url) && !new URL(url).searchParams.has('hash')) {
      toast('Если VK не откроется, возьми код через «Поделиться → Встроить»: некоторым роликам нужен hash');
    }
  });
}
