// Optional WebRTC voice chat. Mic access requires localhost or HTTPS.
// Handshake: whoever enables voice sends `voice:ready`; of each pair, the peer
// with the smaller socket id creates the offer, the other answers `voice:ready`
// back to it so the order of switching on doesn't matter.
import { $ } from './dom.js';
import { socket } from './state.js';

const peers = new Map(); // id -> { pc, pendingIce: [] }
let voiceEnabled = false, localStream = null, rtcConfig = null;

const setStatus = text => { $('voiceStatus').textContent = text; };

// STUN/TURN servers come from the server (TURN credentials live in env vars).
async function getRtcConfig() {
  if (rtcConfig) return rtcConfig;
  try { rtcConfig = await (await fetch('/ice-config')).json(); }
  catch { rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }; }
  return rtcConfig;
}

function updateStatus() {
  if (!voiceEnabled) return setStatus('Выключена');
  const states = [...peers.values()].map(p => p.pc.connectionState);
  const connected = states.filter(s => s === 'connected').length;
  if (connected) setStatus(`Включена — на связи: ${connected}`);
  else if (states.includes('failed')) setStatus('Не удалось соединиться — сеть блокирует прямое соединение, нужен TURN-сервер');
  else if (states.length) setStatus('Соединяемся…');
  else setStatus('Включена — ждём собеседника (он тоже должен включить голос)');
}

async function enableVoice() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Микрофон недоступен: нужен HTTPS или localhost');
    $('voiceToggle').checked = false;
    return;
  }
  try {
    [localStream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      getRtcConfig(),
    ]);
  } catch {
    setStatus('Нет доступа к микрофону — разреши его в настройках сайта');
    $('voiceToggle').checked = false;
    return;
  }
  voiceEnabled = true;
  updateStatus();
  socket.emit('voice:ready');
}

function disableVoice() {
  voiceEnabled = false;
  socket.emit('voice:bye');
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
  for (const id of [...peers.keys()]) closePeer(id);
  updateStatus();
}

function closePeer(id) {
  peers.get(id)?.pc.close();
  peers.delete(id);
  document.getElementById(`audio-${id}`)?.remove();
}

// Drops connections to users who have left the room.
export function pruneVoicePeers(users) {
  const ids = new Set(users.map(u => u.id));
  for (const id of [...peers.keys()]) if (!ids.has(id)) closePeer(id);
  if (voiceEnabled) updateStatus();
}

function playRemote(id, stream) {
  let audio = document.getElementById(`audio-${id}`);
  if (!audio) { audio = document.createElement('audio'); audio.id = `audio-${id}`; audio.autoplay = true; document.body.append(audio); }
  audio.srcObject = stream;
  audio.play().catch(() => setStatus('Нажми на страницу, чтобы включить звук собеседника'));
}

function makePeer(id) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection(rtcConfig);
  const peer = { pc, pendingIce: [] };
  peers.set(id, peer);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit('voice:ice', { to: id, candidate: e.candidate }); };
  pc.ontrack = e => playRemote(id, e.streams[0] || new MediaStream([e.track]));
  pc.onconnectionstatechange = () => {
    updateStatus();
    if (pc.connectionState === 'closed') closePeer(id);
  };
  return peer;
}

// ICE candidates can arrive before the remote description is set; queue them.
async function flushIce(peer) {
  for (const candidate of peer.pendingIce.splice(0)) {
    try { await peer.pc.addIceCandidate(candidate); } catch (err) { console.warn('ICE candidate rejected', err); }
  }
}

async function callPeer(id) {
  const peer = makePeer(id);
  await peer.pc.setLocalDescription(await peer.pc.createOffer());
  socket.emit('voice:offer', { to: id, description: peer.pc.localDescription });
}

export function initVoice() {
  socket.on('voice:ready', ({ id, reply }) => {
    if (!voiceEnabled || id === socket.id) return;
    if (peers.has(id)) {
      if (reply) return; // already calling them
      closePeer(id); // the other side restarted voice
    }
    if (socket.id < id) callPeer(id).catch(err => console.warn('Voice offer failed', err));
    else socket.emit('voice:ready', { to: id });
  });
  socket.on('voice:offer', async ({ from, description }) => {
    if (!voiceEnabled) return;
    if (peers.has(from)) closePeer(from);
    const peer = makePeer(from);
    try {
      await peer.pc.setRemoteDescription(description);
      await flushIce(peer);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      socket.emit('voice:answer', { to: from, description: peer.pc.localDescription });
    } catch (err) { console.warn('Voice answer failed', err); }
  });
  socket.on('voice:answer', async ({ from, description }) => {
    const peer = peers.get(from);
    if (!peer) return;
    try { await peer.pc.setRemoteDescription(description); await flushIce(peer); } catch (err) { console.warn('Voice answer rejected', err); }
  });
  socket.on('voice:ice', async ({ from, candidate }) => {
    const peer = peers.get(from);
    if (!peer || !candidate) return;
    if (peer.pc.remoteDescription) {
      try { await peer.pc.addIceCandidate(candidate); } catch (err) { console.warn('ICE candidate rejected', err); }
    } else peer.pendingIce.push(candidate);
  });
  socket.on('voice:bye', ({ id }) => { closePeer(id); updateStatus(); });
  // After a reconnect the socket id changes: drop old calls and announce again.
  // initVoice runs after initRoom, so this fires after the room re-join.
  socket.on('connect', () => {
    if (!voiceEnabled) return;
    for (const id of [...peers.keys()]) closePeer(id);
    socket.emit('voice:ready');
    updateStatus();
  });
  $('voiceToggle').addEventListener('change', e => { if (e.target.checked) enableVoice(); else disableVoice(); });
}
