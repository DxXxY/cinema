// Emoji reactions that float up over the video for everyone in the room.
import { $ } from './dom.js';
import { socket } from './state.js';

const MAX_ON_SCREEN = 30;

function spawn({ emoji, name }) {
  const layer = $('reactionLayer');
  if (layer.childElementCount >= MAX_ON_SCREEN) layer.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.style.left = `${8 + Math.random() * 80}%`;
  el.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 80)}px`);
  const icon = document.createElement('span'); icon.className = 'reaction-emoji'; icon.textContent = emoji;
  const who = document.createElement('span'); who.className = 'reaction-name'; who.textContent = name;
  el.append(icon, who);
  el.addEventListener('animationend', () => el.remove());
  layer.append(el);
}

export function initReactions() {
  $('reactions').addEventListener('click', e => {
    const button = e.target.closest('button[data-emoji]');
    if (button) socket.emit('reaction', { emoji: button.dataset.emoji });
  });
  socket.on('reaction', spawn);
}
