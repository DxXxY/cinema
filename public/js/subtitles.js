// Subtitles for direct videos: one person uploads .srt/.vtt, everyone sees them.
// The server stores the file as WebVTT; clients fetch it when its id changes.
import { $, showPopup } from './dom.js';
import { socket, store } from './state.js';

const video = $('video');
let loadedId = null, trackUrl = null;

// Russian .srt files are often in Windows-1251 rather than UTF-8.
function decode(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('windows-1251').decode(buffer); }
}

function toVtt(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (text.startsWith('WEBVTT')) return text;
  // SRT -> VTT: comma in timestamps becomes a dot.
  return 'WEBVTT\n\n' + text.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}

function removeTrack() {
  video.querySelectorAll('track').forEach(t => t.remove());
  if (trackUrl) URL.revokeObjectURL(trackUrl);
  trackUrl = null;
}

function showTrack(subs) {
  removeTrack();
  trackUrl = URL.createObjectURL(new Blob([subs.vtt], { type: 'text/vtt' }));
  const track = document.createElement('track');
  Object.assign(track, { kind: 'subtitles', label: subs.name, srclang: 'ru', src: trackUrl, default: true });
  video.append(track);
  track.addEventListener('load', () => { track.track.mode = 'showing'; });
  track.track.mode = 'showing';
}

// Called on every room state.
export function applySubtitles(state) {
  const subs = state.subtitles;
  const direct = state.media?.type === 'direct';
  $('subsFile').disabled = !direct;
  $('subsFile').parentElement.classList.toggle('disabled', !direct);
  $('subsName').textContent = subs ? `📄 ${subs.name}` : direct ? 'Нет субтитров' : 'Доступно для прямых видео';
  $('subsClear').hidden = !subs;
  const id = subs?.id ?? null;
  if (id === loadedId) return;
  loadedId = id;
  if (!subs) return removeTrack();
  socket.emit('subtitles:get', {}, full => { if (full && full.id === loadedId) showTrack(full); });
}

export function initSubtitles() {
  $('subsFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (store.roomState?.media?.type !== 'direct') return showPopup({ title: 'Субтитры — только для прямых видео', detail: 'У YouTube, VK и Twitch есть свои субтитры в плеере', error: true });
    if (file.size > 1_000_000) return showPopup({ title: 'Файл слишком большой', detail: 'Максимум около 1 МБ', error: true });
    const vtt = toVtt(decode(await file.arrayBuffer()));
    socket.emit('subtitles:set', { name: file.name, vtt }, r => {
      if (r?.ok) showPopup({ title: 'Субтитры загружены', detail: 'Теперь они видны у всех в комнате', value: file.name });
      else showPopup({ title: 'Не удалось загрузить субтитры', detail: r?.error || 'Проверь файл', error: true });
    });
  });
  $('subsClear').onclick = () => socket.emit('subtitles:clear');
}
