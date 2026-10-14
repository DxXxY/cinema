// Entry point: wires the modules together.
import { socket, store, stampState } from './state.js';
import { initRoom, renderPeople, renderRoomLock } from './room.js';
import { initPlayer, applyPlayerState } from './player.js';
import { initSourceForm, submitMedia } from './source-form.js';
import { initChat, renderChatHistory } from './chat.js';
import { initVoice, pruneVoicePeers } from './voice.js';
import { initPositions, renderTimecodes, setPositions } from './positions.js';
import { initReactions } from './reactions.js';
import { initSubtitles, applySubtitles } from './subtitles.js';
import { initBackground } from './background.js';
import { rememberRoom } from './recent.js';
import { initDesktop } from './desktop.js';

function applyState(state) {
  store.roomState = stampState(state);
  const users = state.users || [];
  renderPeople(users);
  renderTimecodes();
  renderRoomLock(state);
  applyPlayerState(state);
  applySubtitles(state);
  pruneVoicePeers(users);
  rememberRoom({ id: store.roomId, key: store.roomKey, title: state.media?.title });
}

// Extra data that comes only with the (re)join answer.
function onJoined(result) {
  renderChatHistory(result.messages);
  setPositions(result.positions);
  applyNewRoomSetup(result.state);
}

// A room created on the home page: set its video and lock it right after the first join.
function applyNewRoomSetup(state) {
  let setup = null;
  try { setup = JSON.parse(sessionStorage.getItem('tc-new-room') || 'null'); } catch {}
  if (setup?.roomId !== store.roomId) return;
  sessionStorage.removeItem('tc-new-room');
  if (setup.url && !state?.media) submitMedia(setup.url, setup.title);
  if (setup.lock && !state?.locked) socket.emit('room:lock', { locked: true });
}

initPlayer();
initSourceForm();
initPositions();
initChat();
initReactions();
initSubtitles();
initRoom(applyState, onJoined);
initVoice(); // after initRoom: on reconnect the room is re-joined before voice re-announces
initBackground();
initDesktop();
