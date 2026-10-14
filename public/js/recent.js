// Rooms visited from this device, shown on the home page. Stored in localStorage only.
const KEY = 'tc-recent';
const MAX = 8;

export function getRecent() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch {}
}

export function rememberRoom({ id, key = '', title = '' }) {
  const list = getRecent();
  const old = list.find(r => r.id === id);
  if (old && old.key === key && old.title === (title || old.title) && Date.now() - old.at < 60_000) return; // nothing new
  save([{ id, key, title: title || old?.title || '', at: Date.now() }, ...list.filter(r => r.id !== id)]);
}

export function forgetRoom(id) {
  save(getRecent().filter(r => r.id !== id));
}
