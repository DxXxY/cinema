// Home page: create a room, join by ID or invite link, recent rooms.
import { $ } from './dom.js';
import { randomId, roomPath } from './ids.js';
import { getRecent, forgetRoom } from './recent.js';
import { initBackground } from './background.js';

const savedName = () => { try { return localStorage.getItem('tc-name') || ''; } catch { return ''; } };

function isHttpUrl(text) {
  try { return ['http:', 'https:'].includes(new URL(text).protocol); } catch { return false; }
}

// Accepts a bare ID, a /room/<id>?key=… link (with or without https://) or an old /?room=… link.
function parseRoomInput(text) {
  text = text.trim();
  if (!text) return null;
  const asUrl = isHttpUrl(text) ? text : /\/room\/|[?&]room=/.test(text) ? `https://${text}` : null;
  if (asUrl) {
    const u = new URL(asUrl);
    const fromPath = u.pathname.match(/^\/room\/([^/]+)/)?.[1];
    const id = fromPath ? decodeURIComponent(fromPath) : u.searchParams.get('room');
    return id ? { id, key: u.searchParams.get('key') || '' } : null;
  }
  return /^[\w-]{1,80}$/.test(text) ? { id: text, key: '' } : null;
}

async function roomStatus(id, key = '') {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(id)}${key ? `?key=${encodeURIComponent(key)}` : ''}`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

function setNote(el, text, error) {
  el.textContent = text;
  el.classList.toggle('form-error', !!error);
  el.hidden = !text;
}

function initCreate() {
  $('createName').value = savedName();
  $('createForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('createName').value.trim().slice(0, 24);
    const roomId = randomId();
    try {
      if (name) localStorage.setItem('tc-name', name);
      // The room page reads this once after joining and locks the room.
      if ($('createLock').checked) sessionStorage.setItem('tc-new-room', JSON.stringify({ roomId, lock: true }));
    } catch {}
    location.href = roomPath(roomId);
  });
}

function initJoin() {
  const note = $('joinNote');
  const defaultNote = note.textContent;
  $('joinInput').addEventListener('input', () => setNote(note, defaultNote, false));
  $('joinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const target = parseRoomInput($('joinInput').value);
    if (!target) return setNote(note, 'Не похоже на ID или ссылку комнаты. ID — это буквы и цифры, например k7m2xq9p4a.', true);
    setNote(note, 'Проверяем комнату…', false);
    const status = await roomStatus(target.id, target.key);
    if (status && !status.exists) return setNote(note, 'Комната не найдена. Проверь ID — или комната опустела больше 10 минут назад и удалилась.', true);
    if (status?.locked && !status.allowed) return setNote(note, 'Эта комната закрыта 🔒 Попроси у участников ссылку-приглашение и вставь её сюда целиком.', true);
    location.href = roomPath(target.id, target.key);
  });
}

async function renderRecent() {
  const rooms = getRecent();
  $('recentBlock').hidden = !rooms.length;
  const list = $('recentList');
  list.replaceChildren();
  for (const room of rooms) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'recent-room';
    link.href = roomPath(room.id, room.key);
    const title = document.createElement('span'); title.className = 'recent-title'; title.textContent = room.title || 'Комната без фильма';
    const id = document.createElement('code'); id.textContent = room.id;
    const status = document.createElement('span'); status.className = 'recent-status'; status.textContent = '…';
    link.append(title, id, status);
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'recent-remove'; remove.title = 'Убрать из списка'; remove.setAttribute('aria-label', 'Убрать из списка'); remove.textContent = '×';
    remove.onclick = () => { forgetRoom(room.id); renderRecent(); };
    li.append(link, remove);
    list.append(li);
    roomStatus(room.id, room.key).then(s => {
      if (!s) return void (status.textContent = '');
      if (!s.exists) { status.textContent = 'удалена'; li.classList.add('gone'); return; }
      if (s.title) title.textContent = s.title;
      status.textContent = `${s.locked ? '🔒 ' : ''}${s.users ? `● ${s.users} в сети` : 'пусто'}`;
      status.classList.toggle('live', s.users > 0);
    });
  }
}

if (window.tcDesktop) document.body.classList.add('is-desktop'); // inside the Windows app
initBackground({ activeShare: 0.6, brightness: 1.6, glitchEvery: [2500, 6000] });
initCreate();
initJoin();
renderRecent();
