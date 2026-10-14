// Room membership, participants list, name and invite links.
import { $, toast, setHint } from './dom.js';
import { socket, store } from './state.js';

export function initRoom(onState) {
  $('roomId').textContent = store.roomId;
  $('displayName').value = store.displayName;

  const join = () => socket.emit('room:join', { roomId: store.roomId, name: store.displayName }, result => {
    if (!result?.ok) return;
    store.roomId = result.roomId;
    $('roomId').textContent = store.roomId;
    history.replaceState({}, '', roomUrl());
    if (result.state) onState(result.state);
  });
  // Re-join on every (re)connect: after a dropped connection the server
  // sees a new socket that is not in any room yet.
  socket.on('connect', () => { setHint('● Подключено к комнате'); join(); });
  if (socket.connected) join();
  socket.on('disconnect', () => setHint('Связь потеряна — переподключаемся...'));
  socket.on('room:state', onState);

  $('copyRoom').onclick = () => copyText(roomUrl());
  $('copyTop').onclick = () => copyText(roomUrl());
  $('copyId').onclick = () => copyText(store.roomId);
  $('saveName').onclick = () => {
    store.displayName = $('displayName').value.trim().slice(0, 24) || 'Гость';
    $('displayName').value = store.displayName;
    localStorage.setItem('tc-name', store.displayName);
    socket.emit('room:rename', { name: store.displayName }, r => { if (r?.ok) toast('Имя сохранено'); });
  };
}

export function renderPeople(users) {
  $('roomCount').textContent = users.length;
  const list = $('people');
  list.replaceChildren();
  if (!users.length) {
    const e = document.createElement('div'); e.className = 'system-message'; e.textContent = 'Пока никого нет';
    return list.append(e);
  }
  for (const user of users) {
    const row = document.createElement('div'); row.className = 'person';
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = (user.name || '?').slice(0, 1).toUpperCase();
    const name = document.createElement('span'); name.className = 'person-name'; name.textContent = user.name || 'Гость';
    row.append(avatar, name);
    if (user.voice) { const mic = document.createElement('span'); mic.className = 'mic-tag'; mic.title = 'В голосовой связи'; mic.textContent = '🎙'; row.append(mic); }
    if (user.id === socket.id) { const tag = document.createElement('span'); tag.className = 'you-tag'; tag.textContent = 'ЭТО ТЫ'; row.append(tag); }
    list.append(row);
  }
}

function roomUrl() {
  const url = new URL(location.href);
  url.searchParams.set('room', store.roomId);
  return url.toString();
}

function copyText(text) {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('Скопировано!')).catch(() => fallbackCopy(text));
  else fallbackCopy(text);
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.append(area); area.select();
  try { document.execCommand('copy'); toast('Скопировано!'); } catch { toast('Не получилось скопировать'); }
  area.remove();
}
