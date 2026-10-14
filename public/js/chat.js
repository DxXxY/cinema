// Room chat. The server keeps the last 50 messages, shown again after a reload.
import { $ } from './dom.js';
import { socket } from './state.js';

const MAX_MESSAGES = 100;
const box = () => $('messages');

function appendMessage(m) {
  const row = document.createElement('div'); row.className = 'message';
  const meta = document.createElement('div'); meta.className = 'message-meta';
  const name = document.createElement('strong'); name.textContent = m.name || 'Гость';
  const time = document.createElement('time');
  time.textContent = new Date(m.at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.append(name, time);
  const body = document.createElement('div'); body.className = 'message-text'; body.textContent = m.message || '';
  row.append(meta, body);
  box().append(row);
}

// Replaces the chat with the room history received on (re)join.
export function renderChatHistory(messages = []) {
  box().replaceChildren();
  if (!messages.length) {
    const e = document.createElement('div'); e.className = 'system-message'; e.textContent = 'Комната создана. Отправь первое сообщение 👋';
    box().append(e);
    return;
  }
  messages.forEach(appendMessage);
  box().scrollTop = box().scrollHeight;
}

export function initChat() {
  $('chatForm').addEventListener('submit', e => {
    e.preventDefault();
    const message = $('chatInput').value.trim();
    if (!message) return;
    socket.emit('chat:send', { message });
    $('chatInput').value = '';
  });

  socket.on('chat:message', m => {
    box().querySelector('.system-message')?.remove();
    appendMessage(m);
    while (box().children.length > MAX_MESSAGES) box().firstElementChild.remove();
    box().scrollTop = box().scrollHeight;
  });
}
