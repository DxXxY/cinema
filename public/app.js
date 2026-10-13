const socket = io();
const $ = id => document.getElementById(id);
const video = $('video'), embed = $('embed'), empty = $('empty'), errorBox = $('error');
let roomId = new URLSearchParams(location.search).get('room') || Math.random().toString(36).slice(2, 10);
let displayName = localStorage.getItem('tc-name') || `Гость${Math.floor(10 + Math.random() * 90)}`;
let mode = 'direct', roomState = null, hls = null, applyingRemote = false, voiceEnabled = false, localStream = null;
let vkPlayer = null, vkReady = false, vkApplyingRemote = false, vkLastControlAt = 0, loadedMediaKey = ''; 
const peers = new Map();
$('roomId').textContent = roomId; $('displayName').value = displayName;
function toast(text) { $('hint').textContent = text; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('hint').textContent = '● Плеер готов к запуску', 2600); }
function joinRoom() {
  socket.emit('room:join', { roomId, name: displayName }, result => {
    if (!result?.ok) return; roomId = result.roomId; $('roomId').textContent = roomId;
    const url = new URL(location.href); url.searchParams.set('room', roomId); history.replaceState({}, '', url);
    if (result.state) applyState(result.state);
  });
}
joinRoom();
function applyState(state) {
  roomState = state; renderPeople(state.users || []); $('roomCount').textContent = (state.users || []).length;
  if (state.media) {
    const mediaKey = `${state.media.type}|${state.media.url}`;
    if (loadedMediaKey !== mediaKey) { loadedMediaKey = mediaKey; loadMedia(state.media); }
  } else { loadedMediaKey = ''; }
  if (!state.media) { $('currentTitle').textContent = 'Выберите видео'; $('syncStatus').textContent = 'ОЖИДАНИЕ'; }
  if (state.media?.type === 'direct' && video.src) syncPlayback(state);
  if (state.media?.type === 'embed' && isVkEmbedUrl(state.media.url) && vkPlayer && vkReady) syncVkPlayback(state);
  const ids = new Set((state.users || []).map(u => u.id));
  for (const id of peers.keys()) if (!ids.has(id)) { closePeer(id); document.getElementById(`audio-${id}`)?.remove(); }
}
socket.on('room:state', applyState);
function renderPeople(users) {
  const list = $('people'); list.replaceChildren();
  if (!users.length) { const e = document.createElement('div'); e.className = 'system-message'; e.textContent = 'Пока никого нет'; list.append(e); return; }
  users.forEach(user => {
    const row = document.createElement('div'); row.className = 'person'; const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = (user.name || '?').slice(0, 1).toUpperCase();
    const name = document.createElement('span'); name.className = 'person-name'; name.textContent = user.name || 'Гость'; row.append(avatar, name);
    if (user.id === socket.id) { const tag = document.createElement('span'); tag.className = 'you-tag'; tag.textContent = 'ЭТО ТЫ'; row.append(tag); } list.append(row);
  });
}
function clearPlayer() {
  vkPlayer = null; vkReady = false; vkApplyingRemote = false;
  if (hls) { hls.destroy(); hls = null; } video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
  embed.hidden = true; embed.style.display = 'none'; embed.removeAttribute('src'); empty.hidden = false; errorBox.hidden = true;
}
function loadMedia(media) {
  clearPlayer(); $('currentTitle').textContent = media.title || 'Видео'; $('syncStatus').textContent = media.type === 'direct' ? 'СИНХРОННО' : 'EMBED';
  if (media.type === 'embed') { embed.hidden = false; embed.style.display = 'block'; empty.hidden = true; embed.src = media.url; errorBox.hidden = true;
    if (isVkEmbedUrl(media.url)) { $('hint').textContent = 'VK Видео: подключаем управление плеером…'; initVkPlayer(); }
    else $('hint').textContent = 'Embed-плеер: управление зависит от сервиса';
    return; }
  video.hidden = false; empty.hidden = true;
  if (/\.m3u8($|\?)/i.test(media.url)) {
    if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = media.url;
    else if (window.Hls && Hls.isSupported()) { hls = new Hls(); hls.loadSource(media.url); hls.attachMedia(video); hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) showError('Не удалось загрузить HLS-поток. Проверьте ссылку и доступ к источнику.'); }); }
    else showError('Этот браузер не поддерживает HLS-потоки.');
  } else video.src = media.url;
  video.load(); $('hint').textContent = 'Прямая ссылка — синхронизация включена';
}
function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
$('directMode').onclick = () => setMode('direct'); $('embedMode').onclick = () => setMode('embed');
function setMode(next) {
  mode = next;
  $('directMode').classList.toggle('active', mode === 'direct');
  $('embedMode').classList.toggle('active', mode === 'embed');
  $('mediaUrl').placeholder = mode === 'direct' ? 'https://example.com/movie.mp4' : 'Ссылка на VK Видео, YouTube или Twitch';
  $('sourceNote').textContent = mode === 'direct'
    ? 'Прямые MP4, WebM и HLS (.m3u8). Для них работает синхронизация воспроизведения.'
    : 'Вставь обычную ссылку на VK Видео, YouTube или Twitch — сайт попробует открыть оригинальный плеер. Некоторые видео запрещают встраивание.';
}
function isVkEmbedUrl(raw) {
  try { const u = new URL(raw); return /(^|\.)vk\.com$|(^|\.)vkvideo\.ru$|(^|\.)vk\.ru$/i.test(u.hostname) && /video_ext\.php/i.test(u.pathname); } catch { return false; }
}
function makeEmbedUrl(raw) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname;
  const currentHost = location.hostname || 'localhost';

  // YouTube: watch, youtu.be, Shorts and already-embedded links.
  if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    let id = '';
    if (host === 'youtu.be') id = path.split('/').filter(Boolean)[0] || '';
    else if (path.startsWith('/embed/')) id = path.split('/')[2] || '';
    else if (path.startsWith('/shorts/')) id = path.split('/')[2] || '';
    else id = u.searchParams.get('v') || '';
    if (id && /^[\w-]{6,}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?enablejsapi=1`;
  }

  // Twitch channel, VOD, and clips. Twitch requires the current host in parent.
  if (['twitch.tv', 'm.twitch.tv', 'clips.twitch.tv'].includes(host)) {
    const parts = path.split('/').filter(Boolean);
    const params = new URLSearchParams(); params.set('parent', currentHost);
    if (host === 'clips.twitch.tv') { const slug = parts[0]; if (slug) return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(slug)}&parent=${encodeURIComponent(currentHost)}`; }
    if (parts[0] === 'videos' && parts[1]) { params.set('video', `v${parts[1]}`); params.set('autoplay', 'false'); return `https://player.twitch.tv/?${params.toString()}`; }
    if (parts[0] === 'clip' && parts[1]) return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(parts[1])}&parent=${encodeURIComponent(currentHost)}`;
    if (parts[0] && !['directory', 'downloads', 'settings', 'p', 'turbo'].includes(parts[0])) { params.set('channel', parts[0]); params.set('autoplay', 'false'); return `https://player.twitch.tv/?${params.toString()}`; }
  }

  // VK: support video pages, shared ?z=video... URLs, and official video_ext URLs.
  if (['vk.com', 'vkvideo.ru', 'm.vk.com', 'vk.ru', 'm.vk.ru'].includes(host)) {
    if (/video_ext\.php$/i.test(path)) {
      u.searchParams.set('js_api', '1');
      return u.toString();
    }
    let videoKey = '';
    const matchPath = path.match(/video(-?\d+)_(\d+)/i);
    const matchZ = (u.searchParams.get('z') || '').match(/video(-?\d+)_(\d+)/i);
    const matchQuery = `${u.searchParams.get('oid') || ''}_${u.searchParams.get('id') || ''}`.match(/^(-?\d+)_(\d+)$/);
    const match = matchPath || matchZ || matchQuery;
    if (match) {
      const oid = match[1], id = match[2];
      const params = new URLSearchParams({ oid, id });
      // hash must come from VK's Share -> Embed code when the video requires it.
      const hash = u.searchParams.get('hash') || u.searchParams.get('hd') && u.searchParams.get('hash');
      if (hash) params.set('hash', hash);
      if (u.searchParams.get('hd')) params.set('hd', u.searchParams.get('hd'));
      params.set('js_api', '1');
      return `https://vkvideo.ru/video_ext.php?${params.toString()}`;
    }
  }
  // Accept an embed URL from another service unchanged.
  return raw;
}
function initVkPlayer() {
  vkPlayer = null; vkReady = false;
  const attach = () => {
    try {
      if (!window.VK?.VideoPlayer || !isVkEmbedUrl(embed.src)) return;
      vkPlayer = window.VK.VideoPlayer(embed);
      if (!vkPlayer) return;
      vkReady = true;
      $('hint').textContent = 'VK Видео подключено — синхронизация доступна';
      if (roomState) syncVkPlayback(roomState);
      // VK player API events are emitted by the embedded player.
      if (typeof vkPlayer.on === 'function') {
        vkPlayer.on('started', () => sendVkControl('play'));
        vkPlayer.on('resumed', () => sendVkControl('play'));
        vkPlayer.on('paused', () => sendVkControl('pause'));
        vkPlayer.on('timeupdate', state => {
          if (!vkApplyingRemote && state && Number.isFinite(Number(state.time))) {
            const now = Date.now(); if (now - vkLastControlAt > 1800) { vkLastControlAt = now; socket.emit('media:control', { action: 'seek', time: Number(state.time) }); }
          }
        });
      }
    } catch (err) { console.warn('VK Video API init failed', err); $('hint').textContent = 'VK-плеер открыт; API управления недоступно'; }
  };
  embed.addEventListener('load', attach, { once: true });
  // Covers cases where the iframe load event already fired.
  setTimeout(attach, 500);
}
function vkTime() { try { const t = vkPlayer?.getCurrentTime?.(); return Number.isFinite(Number(t)) ? Number(t) : 0; } catch { return 0; } }
function sendVkControl(action) {
  if (vkApplyingRemote || !roomState?.media || roomState.media.type !== 'embed' || !isVkEmbedUrl(roomState.media.url)) return;
  socket.emit('media:control', { action, time: vkTime() });
}
function syncVkPlayback(state) {
  if (!vkPlayer || !vkReady) return;
  const target = Math.max(0, Number(state.time) || 0) + (state.playing ? Math.max(0, (Date.now() - (state.updatedAt || Date.now())) / 1000) : 0);
  vkApplyingRemote = true;
  try {
    const current = vkTime();
    if (Number.isFinite(target) && Math.abs(current - target) > 2) vkPlayer.seek?.(target);
    if (state.playing) vkPlayer.play?.(); else vkPlayer.pause?.();
  } catch (err) { console.warn('VK sync failed', err); }
  setTimeout(() => { vkApplyingRemote = false; }, 800);
}
$('mediaForm').addEventListener('submit', e => {
  e.preventDefault(); const raw = $('mediaUrl').value.trim(); let url;
  try { const parsed = new URL(raw); if (!['http:', 'https:'].includes(parsed.protocol)) throw Error(); url = mode === 'embed' ? makeEmbedUrl(raw) : raw; }
  catch { toast('Введи корректную ссылку с http:// или https://'); return; }
  socket.emit('media:set', { url, type: mode, title: $('mediaTitle').value.trim() || 'Видео' });
  if (mode === 'embed' && isVkEmbedUrl(url) && !new URL(url).searchParams.has('hash')) {
    toast('Если VK не откроется, возьми код через «Поделиться → Встроить»: некоторым роликам нужен hash');
  }
});
function sendControl(action) { if (applyingRemote || !roomState?.media || roomState.media.type !== 'direct') return; socket.emit('media:control', { action, time: video.currentTime }); }
video.addEventListener('play', () => sendControl('play')); video.addEventListener('pause', () => sendControl('pause')); video.addEventListener('seeked', () => sendControl('seek'));
function syncPlayback(state) {
  const target = Math.max(0, state.time || 0) + (state.playing ? Math.max(0, (Date.now() - (state.updatedAt || Date.now())) / 1000) : 0); applyingRemote = true;
  if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 1.25) { try { video.currentTime = target; } catch {} }
  if (state.playing && video.paused) { const p = video.play(); if (p?.catch) p.catch(() => toast('Нажми Play: браузер заблокировал автозапуск')); } else if (!state.playing && !video.paused) video.pause();
  $('syncStatus').textContent = state.playing ? 'СМОТРИТЕ ВМЕСТЕ' : 'СИНХРОННО'; setTimeout(() => applyingRemote = false, 250);
}
video.addEventListener('error', () => { if (video.error && roomState?.media?.type === 'direct') showError('Видео не загрузилось. Проверь ссылку, CORS и доступность файла.'); });
function copyText(text) {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('Скопировано!')).catch(() => fallbackCopy(text)); else fallbackCopy(text);
}
function fallbackCopy(text) { const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select(); try { document.execCommand('copy'); toast('Скопировано!'); } catch { toast('Не получилось скопировать'); } area.remove(); }
function roomUrl() { const url = new URL(location.href); url.searchParams.set('room', roomId); return url.toString(); }
$('copyRoom').onclick = () => copyText(roomUrl()); $('copyTop').onclick = () => copyText(roomUrl()); $('copyId').onclick = () => copyText(roomId);
$('saveName').onclick = () => { displayName = $('displayName').value.trim().slice(0, 24) || 'Гость'; $('displayName').value = displayName; localStorage.setItem('tc-name', displayName); socket.emit('room:rename', { name: displayName }, r => { if (r?.ok) toast('Имя сохранено'); }); };
$('chatForm').addEventListener('submit', e => { e.preventDefault(); const message = $('chatInput').value.trim(); if (!message) return; socket.emit('chat:send', { message }); $('chatInput').value = ''; });
socket.on('chat:message', m => {
  const box = $('messages'); box.querySelector('.system-message')?.remove(); const row = document.createElement('div'); row.className = 'message'; const meta = document.createElement('div'); meta.className = 'message-meta'; const name = document.createElement('strong'); name.textContent = m.name || 'Гость'; const time = document.createElement('time'); time.textContent = new Date(m.at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); meta.append(name, time); const body = document.createElement('div'); body.className = 'message-text'; body.textContent = m.message || ''; row.append(meta, body); box.append(row); while (box.children.length > 100) box.firstElementChild.remove(); box.scrollTop = box.scrollHeight;
});
// Optional WebRTC voice chat. Mic access requires localhost or HTTPS.
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
async function enableVoice() {
  if (!navigator.mediaDevices?.getUserMedia) { $('voiceStatus').textContent = 'Микрофон недоступен: нужен HTTPS или localhost'; $('voiceToggle').checked = false; return; }
  try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); voiceEnabled = true; $('voiceStatus').textContent = 'Включена — микрофон активен'; socket.emit('voice:ready'); }
  catch { $('voiceStatus').textContent = 'Нет доступа к микрофону'; $('voiceToggle').checked = false; }
}
function closePeer(id) { const pc = peers.get(id); if (pc) pc.close(); peers.delete(id); }
async function makePeer(id, initiator) {
  if (!voiceEnabled || !localStream || id === socket.id) return null; if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection(rtcConfig); peers.set(id, pc); localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit('voice:ice', { to: id, candidate: e.candidate }); };
  pc.ontrack = e => { let audio = document.getElementById(`audio-${id}`); if (!audio) { audio = document.createElement('audio'); audio.id = `audio-${id}`; audio.autoplay = true; document.body.append(audio); } audio.srcObject = e.streams[0]; };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) closePeer(id); };
  if (initiator) { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('voice:offer', { to: id, description: pc.localDescription }); }
  return pc;
}
socket.on('voice:ready', async ({ id }) => { if (voiceEnabled && socket.id < id) await makePeer(id, true); });
socket.on('voice:offer', async ({ from, description }) => { if (!voiceEnabled || !localStream) return; const pc = await makePeer(from, false); if (!pc) return; await pc.setRemoteDescription(description); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('voice:answer', { to: from, description: pc.localDescription }); });
socket.on('voice:answer', async ({ from, description }) => { const pc = peers.get(from); if (pc) await pc.setRemoteDescription(description); });
socket.on('voice:ice', async ({ from, candidate }) => { const pc = peers.get(from); if (pc && candidate) try { await pc.addIceCandidate(candidate); } catch {} });
$('voiceToggle').addEventListener('change', async e => {
  if (e.target.checked) await enableVoice(); else { voiceEnabled = false; if (localStream) localStream.getTracks().forEach(t => t.stop()); localStream = null; for (const id of [...peers.keys()]) closePeer(id); document.querySelectorAll("audio[id^='audio-']").forEach(a => a.remove()); $('voiceStatus').textContent = 'Выключена'; }
});
socket.on('connect', () => { $('hint').textContent = '● Подключено к комнате'; }); socket.on('disconnect', () => { $('hint').textContent = 'Связь потеряна — переподключаемся...'; });
