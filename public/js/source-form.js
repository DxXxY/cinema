// "Добавить фильм" form: one URL field, the source type is detected automatically.
import { $, toast } from './dom.js';
import { socket } from './state.js';
import { isVkEmbedUrl, makeEmbedUrl } from './embed-url.js';

// Links to video files (MP4/WebM/HLS...) play in our own player with sync and subtitles;
// everything else (VK, YouTube, Twitch, other players) opens as an embed.
const DIRECT_FILE = /\.(mp4|m4v|webm|ogv|ogg|mov|m3u8)$/i;

export function initSourceForm() {
  $('mediaForm').addEventListener('submit', e => {
    e.preventDefault();
    const raw = $('mediaUrl').value.trim();
    let parsed;
    try {
      parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw Error();
    } catch { return toast('Введи корректную ссылку с http:// или https://'); }
    const type = DIRECT_FILE.test(parsed.pathname) ? 'direct' : 'embed';
    const url = type === 'embed' ? makeEmbedUrl(raw) : raw;
    socket.emit('media:set', { url, type, title: $('mediaTitle').value.trim() || 'Видео' });
    if (type === 'embed' && isVkEmbedUrl(url) && !new URL(url).searchParams.has('hash')) {
      toast('Если VK не откроется, возьми код через «Поделиться → Встроить»: некоторым роликам нужен hash');
    }
  });
}
