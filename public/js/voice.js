// Optional WebRTC voice chat. Mic access requires localhost or HTTPS.
import { $ } from './dom.js';
import { socket } from './state.js';

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const peers = new Map();
let voiceEnabled = false, localStream = null;

async function enableVoice() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $('voiceStatus').textContent = 'Микрофон недоступен: нужен HTTPS или localhost';
    $('voiceToggle').checked = false;
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceEnabled = true;
    $('voiceStatus').textContent = 'Включена — микрофон активен';
    socket.emit('voice:ready');
  } catch {
    $('voiceStatus').textContent = 'Нет доступа к микрофону';
    $('voiceToggle').checked = false;
  }
}

function disableVoice() {
  voiceEnabled = false;
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
  for (const id of [...peers.keys()]) closePeer(id);
  $('voiceStatus').textContent = 'Выключена';
}

function closePeer(id) {
  peers.get(id)?.close();
  peers.delete(id);
  document.getElementById(`audio-${id}`)?.remove();
}

// Drops connections to users who have left the room.
export function pruneVoicePeers(users) {
  const ids = new Set(users.map(u => u.id));
  for (const id of [...peers.keys()]) if (!ids.has(id)) closePeer(id);
}

async function makePeer(id, initiator) {
  if (!voiceEnabled || !localStream || id === socket.id) return null;
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection(rtcConfig);
  peers.set(id, pc);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit('voice:ice', { to: id, candidate: e.candidate }); };
  pc.ontrack = e => {
    let audio = document.getElementById(`audio-${id}`);
    if (!audio) { audio = document.createElement('audio'); audio.id = `audio-${id}`; audio.autoplay = true; document.body.append(audio); }
    audio.srcObject = e.streams[0];
  };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) closePeer(id); };
  if (initiator) {
    await pc.setLocalDescription(await pc.createOffer());
    socket.emit('voice:offer', { to: id, description: pc.localDescription });
  }
  return pc;
}

export function initVoice() {
  socket.on('voice:ready', async ({ id }) => { if (voiceEnabled && socket.id < id) await makePeer(id, true); });
  socket.on('voice:offer', async ({ from, description }) => {
    const pc = await makePeer(from, false);
    if (!pc) return;
    await pc.setRemoteDescription(description);
    await pc.setLocalDescription(await pc.createAnswer());
    socket.emit('voice:answer', { to: from, description: pc.localDescription });
  });
  socket.on('voice:answer', async ({ from, description }) => { await peers.get(from)?.setRemoteDescription(description); });
  socket.on('voice:ice', async ({ from, candidate }) => {
    const pc = peers.get(from);
    if (pc && candidate) try { await pc.addIceCandidate(candidate); } catch {}
  });
  $('voiceToggle').addEventListener('change', e => { if (e.target.checked) enableVoice(); else disableVoice(); });
}
