// Cinema hall: the room's film in the middle, participants' webcams on both sides.
// The player is not moved in the DOM (an iframe would reload and lose sync):
// body.hall-mode only lays the page out differently, like the app's mini player.
import { $, toast } from './dom.js';
import { socket, store } from './state.js';
import { cameraSupported, startCamera, stopCamera, localStream, setCameraCount, receiveCamData, dropRemote, dropAllRemotes } from './camera.js';
import { voiceState, toggleMute } from './voice.js';

let inHall = false, camOn = false, camBusy = false;
const tiles = new Map(); // user id -> { el, canvas, video, avatar, name, mic }

export function initHall() {
  $('hallEnter').onclick = enterHall;
  $('hallExit').onclick = leaveHall;
  $('hallCam').onclick = toggleCamera;
  $('hallMic').onclick = () => (voiceState().enabled ? toggleMute() : $('voiceToggle').click());
  document.addEventListener('tc:voice', renderBar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && inHall && !document.fullscreenElement) leaveHall(); });
  socket.on('cam:data', (from, chunk) => { if (inHall) receiveCamData(from, chunk, tiles.get(from)?.canvas); });
  // A reconnect gives a new socket; initHall runs after initRoom, so the room is re-joined first.
  socket.on('connect', () => {
    if (!inHall) return;
    socket.emit('hall:set', { on: true });
    if (camOn) socket.emit('cam:set', { on: true });
  });
  if (!cameraSupported()) {
    $('hallCam').disabled = true;
    $('hallCam').title = 'Этот браузер не умеет передавать видео — нужен свежий Chrome, Edge, Firefox или приложение';
  }
}

function enterHall() {
  if (inHall) return;
  if (!store.joined) return toast('Сначала нужно попасть в комнату');
  inHall = true;
  document.body.classList.add('hall-mode');
  $('hall').hidden = false;
  socket.emit('hall:set', { on: true });
  scrollTo(0, 0);
  renderHall(store.roomState);
}

function leaveHall() {
  if (!inHall) return;
  if (camOn) { stopCamera(); camOn = false; }
  inHall = false;
  socket.emit('hall:set', { on: false });
  document.body.classList.remove('hall-mode');
  $('hall').hidden = true;
  dropAllRemotes();
  for (const t of tiles.values()) t.el.remove();
  tiles.clear();
}

async function toggleCamera() {
  if (camBusy) return;
  if (camOn) {
    stopCamera();
    camOn = false;
    socket.emit('cam:set', { on: false });
    return renderHall(store.roomState);
  }
  camBusy = true;
  $('hallCam').disabled = true;
  try {
    await startCamera();
    if (!inHall) return stopCamera(); // left the hall while the browser was asking
    camOn = true;
    socket.emit('cam:set', { on: true });
  } catch (err) {
    stopCamera();
    toast(err?.name === 'NotAllowedError' ? 'Нет доступа к камере — разреши её в настройках сайта' : 'Камера не найдена или занята другой программой');
  } finally {
    camBusy = false;
    $('hallCam').disabled = !cameraSupported();
    renderHall(store.roomState);
  }
}

function makeTile(id) {
  const el = document.createElement('div');
  el.className = 'hall-tile';
  el.dataset.id = id;
  const canvas = document.createElement('canvas');
  canvas.className = 'hall-cam remote';
  const video = document.createElement('video');
  video.className = 'hall-cam self';
  video.muted = true; video.playsInline = true; video.autoplay = true;
  const avatar = document.createElement('div');
  avatar.className = 'hall-avatar';
  const label = document.createElement('div');
  label.className = 'hall-name';
  const name = document.createElement('span');
  const mic = document.createElement('i');
  mic.className = 'hall-mic';
  mic.textContent = '🎙';
  mic.title = 'В голосовой связи';
  label.append(name, mic);
  el.append(canvas, video, avatar, label);
  return { el, canvas, video, avatar, name, mic };
}

// Called on every room state.
export function renderHall(state) {
  renderBar();
  if (!inHall || !state) return;
  const users = state.users || [];
  const ids = new Set(users.map(u => u.id));
  for (const [id, t] of tiles) if (!ids.has(id)) { dropRemote(id); t.el.remove(); tiles.delete(id); }
  setCameraCount(users.filter(u => u.hall && u.cam).length);

  // Alternate left/right so both sides fill evenly.
  const sides = [$('hallLeft'), $('hallRight')];
  const slots = [0, 0];
  users.forEach((u, i) => {
    let t = tiles.get(u.id);
    if (!t) { t = makeTile(u.id); tiles.set(u.id, t); }
    const me = u.id === socket.id;
    const self = me && camOn && !!localStream();
    const remote = !me && u.hall && u.cam;
    if (!remote) dropRemote(u.id);
    t.el.classList.toggle('cam-self', self);
    t.el.classList.toggle('cam-remote', remote);
    t.el.classList.toggle('away', !u.hall);
    t.el.classList.toggle('me', me);
    t.el.title = u.hall ? '' : 'Смотрит в обычном режиме комнаты';
    t.avatar.textContent = (u.name || '?').slice(0, 1).toUpperCase();
    t.name.textContent = me ? `${u.name || 'Гость'} (ты)` : (u.name || 'Гость');
    t.mic.hidden = !u.voice;
    if (self && t.video.srcObject !== localStream()) t.video.srcObject = localStream();
    if (!self && t.video.srcObject) t.video.srcObject = null;

    const side = sides[i % 2], index = slots[i % 2]++;
    if (side.children[index] !== t.el) side.insertBefore(t.el, side.children[index] || null);
    if (self && t.video.paused) t.video.play().catch(() => {}); // moving a <video> pauses it
  });
}

function renderBar() {
  const state = store.roomState;
  $('hallCount').textContent = `${state?.users?.length || 1}/${state?.maxUsers || 8}`;
  const voice = voiceState();
  $('hallMic').textContent = !voice.enabled ? '🎙 Включить голос' : voice.muted ? '🔇 Микрофон выключен' : '🎙 Микрофон включён';
  $('hallMic').classList.toggle('muted', voice.enabled && voice.muted);
  $('hallCam').textContent = camOn ? '📷 Выключить камеру' : '📷 Включить камеру';
  $('hallCam').classList.toggle('on', camOn);
}
