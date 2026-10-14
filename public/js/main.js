// Entry point: wires the modules together.
import { store } from './state.js';
import { initRoom, renderPeople } from './room.js';
import { initPlayer, applyPlayerState } from './player.js';
import { initSourceForm } from './source-form.js';
import { initChat } from './chat.js';
import { initVoice, pruneVoicePeers } from './voice.js';
import { initPositions, renderTimecodes } from './positions.js';
import { initBackground } from './background.js';

function applyState(state) {
  store.roomState = state;
  const users = state.users || [];
  renderPeople(users);
  renderTimecodes();
  applyPlayerState(state);
  pruneVoicePeers(users);
}

initPlayer();
initSourceForm();
initPositions();
initChat();
initRoom(applyState);
initVoice(); // after initRoom: on reconnect the room is re-joined before voice re-announces
initBackground();
