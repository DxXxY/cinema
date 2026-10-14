// Entry point: wires the modules together.
import { store } from './state.js';
import { initRoom, renderPeople, renderRoomLock } from './room.js';
import { initPlayer, applyPlayerState } from './player.js';
import { initSourceForm } from './source-form.js';
import { initChat, renderChatHistory } from './chat.js';
import { initVoice, pruneVoicePeers } from './voice.js';
import { initPositions, renderTimecodes, setPositions } from './positions.js';
import { initReactions } from './reactions.js';
import { initSubtitles, applySubtitles } from './subtitles.js';
import { initBackground } from './background.js';

function applyState(state) {
  store.roomState = state;
  const users = state.users || [];
  renderPeople(users);
  renderTimecodes();
  renderRoomLock(state);
  applyPlayerState(state);
  applySubtitles(state);
  pruneVoicePeers(users);
}

// Extra data that comes only with the (re)join answer.
function onJoined(result) {
  renderChatHistory(result.messages);
  setPositions(result.positions);
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
