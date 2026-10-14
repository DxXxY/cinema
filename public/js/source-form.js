// "Добавить фильм" form: one field for a film title or a link. A link's source
// type is detected automatically; a title shows search suggestions (search.js).
import { $, toast } from './dom.js';
import { socket, store } from './state.js';
import { isVkEmbedUrl, makeEmbedUrl } from './embed-url.js';
import { attachSearch, looksLikeLink } from './search.js';

// Links to video files (MP4/WebM/HLS...) play in our own player with sync and subtitles;
// everything else (VK, YouTube, Twitch, other players) opens as an embed.
const DIRECT_FILE = /\.(mp4|m4v|webm|ogv|ogg|mov|m3u8)$/i;

// Sets the room video from any supported link. Also used for a room created on the home page.
// autoplay: the video starts for everyone right away (a film picked from search).
export function submitMedia(raw, title, { autoplay = false } = {}) {
  let parsed;
  const text = raw.trim();
  try {
    parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw Error();
  } catch { return toast('Введи название фильма или корректную ссылку'); }
  const type = DIRECT_FILE.test(parsed.pathname) ? 'direct' : 'embed';
  const url = type === 'embed' ? makeEmbedUrl(parsed.href) : parsed.href;
  const send = () => socket.emit('media:set', { url, type, title: title?.trim() || 'Видео', autoplay });
  // Not in the room yet (still connecting): the server would drop the link, so wait for the join.
  if (store.joined) send();
  else { toast('Подключаемся к комнате…'); socket.once('room:state', send); }
  if (!autoplay && type === 'embed' && isVkEmbedUrl(url) && !new URL(url).searchParams.has('hash')) {
    toast('Если VK не откроется, возьми код через «Поделиться → Встроить»: некоторым роликам нужен hash');
  }
}

// A field that takes either a link (sets it on submit) or a film title (search).
function initFilmField(form, input, getTitle = () => '') {
  const search = attachSearch(input, item => {
    submitMedia(item.url, item.title, { autoplay: true });
    toast(`▶ ${item.title}`);
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (looksLikeLink(text)) submitMedia(text, getTitle());
    else search.submit();
  });
}

export function initSourceForm() {
  initFilmField($('mediaForm'), $('mediaUrl'), () => $('mediaTitle').value);
  // Field inside the empty player of a new room.
  initFilmField($('emptyForm'), $('emptyUrl'));
}
