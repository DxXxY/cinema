// Entry point: wires the modules together.
import { store } from './state.js';
import { initRoom, renderPeople } from './room.js';
import { initPlayer, applyPlayerState } from './player.js';
import { initSourceForm } from './source-form.js';
import { initChat } from './chat.js';
import { initVoice, pruneVoicePeers } from './voice.js';

function applyState(state) {
  store.roomState = state;
  const users = state.users || [];
  renderPeople(users);
  applyPlayerState(state);
  pruneVoicePeers(users);
}

initPlayer();
initSourceForm();
initChat();
initVoice();
initRoom(applyState);
