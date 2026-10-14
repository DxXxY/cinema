// Extra features when the site runs inside the Windows app (desktop/preload.js
// exposes window.tcDesktop): hotkeys, mini player and notifications.
// In a normal browser on Windows it shows the "Открыть в приложении" button instead.
import { $ } from './dom.js';
import { socket, store } from './state.js';
import { roomPath } from './ids.js';
import { togglePlayback } from './player.js';
import { toggleMute } from './voice.js';

const desktop = window.tcDesktop;

function initAppFeatures() {
  document.body.classList.add('is-desktop');
  desktop.onCommand(command => {
    if (command === 'toggle-play') togglePlayback();
    else if (command === 'toggle-mic') toggleMute();
  });
  desktop.onMiniMode(on => document.body.classList.toggle('mini-mode', on));
  $('miniEnter').onclick = () => desktop.setMini(true);
  $('miniExit').onclick = () => desktop.setMini(false);

  // The app shows these only while its window is in the background.
  socket.on('chat:message', m => { if (m.id !== socket.id) desktop.notify(`💬 ${m.name}`, m.message); });
  let known = null;
  socket.on('room:state', state => {
    const users = state.users || [];
    if (known) for (const u of users) if (!known.has(u.id) && u.id !== socket.id) desktop.notify('Together Cinema', `${u.name} зашёл в комнату`);
    known = new Set(users.map(u => u.id));
  });
  socket.on('disconnect', () => { known = null; }); // ids change after a reconnect
}

// Invite links of the form togethercinema://room/<id>?key=… open the installed app.
function initOpenInApp() {
  if (!/Windows/i.test(navigator.userAgent)) return;
  const link = $('openInApp');
  link.hidden = false;
  link.onclick = () => { link.href = `togethercinema:/${roomPath(store.roomId, store.roomKey)}`; };
}

export function initDesktop() {
  if (desktop) initAppFeatures();
  else initOpenInApp();
}
