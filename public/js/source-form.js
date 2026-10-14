// "Добавить фильм" form: one URL field, the source type is detected automatically.
import { $, toast } from './dom.js';
import { socket } from './state.js';
import { isVkEmbedUrl, makeEmbedUrl } from './embed-url.js';

// Links to video files (MP4/WebM/HLS...) play in our own player with sync and subtitles;
// everything else (VK, YouTube, Twitch, other players) opens as an embed.
const DIRECT_FILE = /\.(mp4|m4v|webm|ogv|ogg|mov|m3u8)$/i;

// Sets the room video from any supported link. Also used for a room created on the home page.
export function submitMedia(raw, title) {
  let parsed;
  try {
    parsed = new URL(raw.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw Error();
  } catch { return toast('Введи корректную ссылку с http:// или https://'); }
  const type = DIRECT_FILE.test(parsed.pathname) ? 'direct' : 'embed';
  const url = type === 'embed' ? makeEmbedUrl(parsed.href) : parsed.href;
  socket.emit('media:set', { url, type, title: title?.trim() || 'Видео' });
  if (type === 'embed' && isVkEmbedUrl(url) && !new URL(url).searchParams.has('hash')) {
    toast('Если VK не откроется, возьми код через «Поделиться → Встроить»: некоторым роликам нужен hash');
  }
}

export function initSourceForm() {
  $('mediaForm').addEventListener('submit', e => {
    e.preventDefault();
    submitMedia($('mediaUrl').value, $('mediaTitle').value);
  });
  // Link field inside the empty player of a new room.
  $('emptyForm').addEventListener('submit', e => {
    e.preventDefault();
    submitMedia($('emptyUrl').value, '');
  });
}
