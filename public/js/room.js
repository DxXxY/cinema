// Room membership, participants list, name, invite links and room lock.
import { $, toast, setHint, showPopup } from './dom.js';
import { socket, store } from './state.js';
import { roomPath } from './ids.js';

export function initRoom(onState, onJoined) {
  $('roomId').textContent = store.roomId;
  $('displayName').value = store.displayName;

  const join = () => socket.emit('room:join', { roomId: store.roomId, key: store.roomKey, name: store.displayName }, result => {
    if (result?.error === 'locked') return showLocked();
    if (!result?.ok) return;
    store.joined = true;
    store.roomId = result.roomId;
    $('roomId').textContent = store.roomId;
    if (result.state) onState(result.state);
    onJoined(result);
  });
  // Re-join on every (re)connect: after a dropped connection the server
  // sees a new socket that is not in any room yet.
  socket.on('connect', () => { setHint('● Подключено к комнате'); join(); });
  if (socket.connected) join();
  socket.on('disconnect', () => { store.joined = false; setHint('Связь потеряна — переподключаемся...'); });
  socket.on('room:state', onState);

  const copyInvite = () => copyText(roomUrl(), 'Ссылка-приглашение скопирована', 'Отправь её другу — и вы окажетесь в одной комнате');
  $('copyRoom').onclick = copyInvite;
  $('copyTop').onclick = copyInvite;
  $('copyId').onclick = () => store.roomKey
    ? copyInvite() // a locked room can't be entered by ID alone
    : copyText(store.roomId, 'ID комнаты скопирован', 'Друг вводит его на главной в поле «Войти в комнату»');
  $('lockRoom').onclick = () => socket.emit('room:lock', { locked: !store.roomState?.locked });
  $('saveName').onclick = () => {
    store.displayName = $('displayName').value.trim().slice(0, 24) || 'Гость';
    $('displayName').value = store.displayName;
    localStorage.setItem('tc-name', store.displayName);
    socket.emit('room:rename', { name: store.displayName }, r => { if (r?.ok) toast('Имя сохранено'); });
  };
}

function showLocked() {
  setHint('Комната закрыта');
  $('empty').querySelector('h3').textContent = 'Комната закрыта 🔒';
  $('empty').querySelector('p').textContent = 'Попроси у участников свежую ссылку-приглашение — по старой ссылке или ID сюда не попасть.';
  $('emptyForm').hidden = true;
  showPopup({ title: 'Комната закрыта', detail: 'Нужна ссылка-приглашение от участников комнаты', error: true });
}

// Lock button and the invite key in the address bar.
export function renderRoomLock(state) {
  store.roomKey = state.key || '';
  history.replaceState({}, '', roomUrl());
  $('lockRoom').textContent = state.locked ? '🔓 Открыть комнату' : '🔒 Закрыть комнату';
  $('lockRoom').classList.toggle('locked', !!state.locked);
  $('lockNote').textContent = state.locked ? 'Зайти можно только по ссылке-приглашению' : 'Зайти может любой, у кого есть ссылка или ID';
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
    const row = document.createElement('div'); row.className = 'person'; row.dataset.id = user.id;
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = (user.name || '?').slice(0, 1).toUpperCase();
    const name = document.createElement('span'); name.className = 'person-name'; name.textContent = user.name || 'Гость';
    row.append(avatar, name);
    const timecode = document.createElement('span'); timecode.className = 'timecode'; timecode.dataset.id = user.id; timecode.hidden = true; row.append(timecode);
    if (user.voice) { const mic = document.createElement('span'); mic.className = 'mic-tag'; mic.title = 'В голосовой связи'; mic.textContent = '🎙'; row.append(mic); }
    if (user.id === socket.id) { const tag = document.createElement('span'); tag.className = 'you-tag'; tag.textContent = 'ЭТО ТЫ'; row.append(tag); }
    list.append(row);
  }
}

function roomUrl() {
  return new URL(roomPath(store.roomId, store.roomKey), location.origin).toString();
}

async function copyText(text, title, detail) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = fallbackCopy(text); }
  if (ok) showPopup({ title, detail, value: text });
  else showPopup({ title: 'Не получилось скопировать', detail: 'Выдели и скопируй вручную:', value: text, error: true });
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.append(area); area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  area.remove();
  return ok;
}
