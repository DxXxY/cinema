// Bridge between the website and the Windows app, plus the app's own title bar.
// The site checks `window.tcDesktop` to turn on app-only features (notifications,
// hotkeys, mini player). The title bar is drawn here so the site itself stays
// unchanged in a normal browser.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tcDesktop', {
  notify: (title, body) => ipcRenderer.send('tc:notify', { title: String(title), body: String(body) }),
  setMini: on => ipcRenderer.send('tc:set-mini', !!on),
  onCommand: callback => ipcRenderer.on('tc:command', (_e, command) => callback(command)),
  onMiniMode: callback => ipcRenderer.on('tc:mini', (_e, on) => callback(on)),
});

const win = action => ipcRenderer.send('tc:window', action);

// Thin-line icons (14×14) for the window buttons.
const ICONS = {
  back: '<path d="M8.5 3 4.5 7l4 4" />',
  home: '<path d="M2.5 6.5 7 2.8l4.5 3.7V11a.5.5 0 0 1-.5.5H8.5V8.5h-3v3H3a.5.5 0 0 1-.5-.5Z" />',
  mini: '<rect x="1.5" y="2.5" width="11" height="9" rx="1.5" /><rect x="7" y="7" width="4" height="3" rx=".5" class="fill" />',
  minimize: '<path d="M3 7h8" />',
  maximize: '<rect x="3" y="3" width="8" height="8" rx="1" />',
  restore: '<rect x="3" y="4.8" width="6.2" height="6.2" rx="1" /><path d="M5 4.8V3.6a.6.6 0 0 1 .6-.6h4.8a.6.6 0 0 1 .6.6v4.8a.6.6 0 0 1-.6.6H9.2" />',
  close: '<path d="m3.5 3.5 7 7m0-7-7 7" />',
  expand: '<path d="M8.5 2.5h3v3m0-3L8 6M5.5 11.5h-3v-3m0 3L6 8" />',
};
const icon = name => `<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const CSS = `
:root { --tc-bar: 36px; }
html:not(.tc-mini) body { padding-top: var(--tc-bar) !important; }
#tc-titlebar { position: fixed; inset: 0 0 auto 0; height: var(--tc-bar); z-index: 2147483000; display: flex; align-items: center;
  background: #0b0c15f2; border-bottom: 1px solid #ffffff0d; backdrop-filter: blur(10px); color: #a4abc0;
  font: 600 12px/1 "DM Sans", "Segoe UI", sans-serif; -webkit-app-region: drag; user-select: none; }
#tc-titlebar button { -webkit-app-region: no-drag; display: grid; place-items: center; height: 100%; width: 42px; border: 0;
  background: transparent; color: inherit; cursor: default; transition: background .12s, color .12s; }
#tc-titlebar button:hover { background: #ffffff0f; color: #f3f4fb; }
#tc-titlebar button:active { background: #ffffff17; }
#tc-titlebar button:disabled { opacity: .35; background: transparent; }
#tc-titlebar .tc-left, #tc-titlebar .tc-right { display: flex; align-items: center; height: 100%; }
#tc-titlebar .tc-brand { -webkit-app-region: no-drag; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 12px; height: 100%;
  color: #f3f4fb; font: 800 13px Manrope, "Segoe UI", sans-serif; letter-spacing: -.4px; cursor: default; }
#tc-titlebar .tc-brand i { width: 18px; height: 18px; border-radius: 6px; display: grid; place-items: center; font-style: normal; font-size: 8px;
  color: #12101d; background: linear-gradient(135deg, #a78bfa, #ed77c5); }
#tc-titlebar .tc-brand b { color: #a78bfa; font-weight: 800; }
#tc-titlebar .tc-nav { display: flex; height: 100%; }
#tc-titlebar .tc-nav button { width: 34px; }
#tc-titlebar .tc-title { flex: 1; min-width: 0; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 12px; color: #858ba3; }
#tc-titlebar .tc-title strong { color: #d6d8e6; font-weight: 700; }
#tc-titlebar .tc-sep { width: 1px; height: 16px; background: #ffffff14; margin: 0 4px; }
#tc-titlebar .tc-close:hover { background: #e11d48; color: #fff; }
#tc-titlebar svg .fill { fill: currentColor; stroke: none; }
html.tc-mini #tc-titlebar { display: none; }
/* The logo already sits in the title bar; keep the page scrollbar below it. */
.topbar .brand { visibility: hidden; }
html:not(.tc-mini)::-webkit-scrollbar-track { margin-top: var(--tc-bar); }

/* Mini player: a drag strip over the top of the video, buttons on hover */
#tc-minibar { display: none; }
html.tc-mini #tc-minibar { display: flex; position: fixed; inset: 0 0 auto 0; height: 32px; z-index: 2147483000; justify-content: flex-end;
  -webkit-app-region: drag; background: linear-gradient(#000a, transparent); opacity: 0; transition: opacity .15s; }
html.tc-mini:hover #tc-minibar { opacity: 1; }
#tc-minibar button { -webkit-app-region: no-drag; width: 34px; height: 28px; margin: 2px 2px 0 0; border: 0; border-radius: 7px; display: grid; place-items: center;
  color: #f3f4fb; background: #12121ecc; }
#tc-minibar button:hover { background: #2a2540; }
#tc-minibar .tc-close:hover { background: #e11d48; }
html.tc-mini .mini-exit { display: none !important; }
`;

function buildBar() {
  if (document.getElementById('tc-titlebar')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const bar = document.createElement('div');
  bar.id = 'tc-titlebar';
  bar.innerHTML = `
    <div class="tc-left">
      <div class="tc-brand" title="На главную"><i>▶</i><span>together<b>cinema</b></span></div>
      <div class="tc-nav"><button data-a="back" title="Назад">${icon('back')}</button><button data-a="home" title="На главную">${icon('home')}</button></div>
    </div>
    <div class="tc-title"></div>
    <div class="tc-right">
      <button data-a="mini" title="Мини-плеер поверх окон (Ctrl+Alt+O)">${icon('mini')}</button>
      <span class="tc-sep"></span>
      <button data-a="minimize" title="Свернуть">${icon('minimize')}</button>
      <button data-a="maximize" class="tc-max" title="Развернуть">${icon('maximize')}</button>
      <button data-a="close" class="tc-close" title="Закрыть (приложение останется в трее)">${icon('close')}</button>
    </div>`;
  const miniBar = document.createElement('div');
  miniBar.id = 'tc-minibar';
  miniBar.innerHTML = `<button data-a="unmini" title="Развернуть">${icon('expand')}</button><button data-a="close" class="tc-close" title="Закрыть">${icon('close')}</button>`;
  document.body.append(bar, miniBar);

  for (const el of [bar, miniBar]) el.addEventListener('click', e => {
    const button = e.target.closest('button[data-a]');
    if (button) win(button.dataset.a);
  });
  bar.querySelector('.tc-brand').addEventListener('click', () => win('home'));
  bar.querySelector('.tc-brand').addEventListener('dblclick', e => e.stopPropagation());

  watchTitle(bar.querySelector('.tc-title'));
  ipcRenderer.invoke('tc:window-state').then(applyState);
}

// Center text: film title and room id on a room page, "Главная" on the home page.
function watchTitle(el) {
  let last = null;
  const update = () => {
    const film = document.getElementById('currentTitle')?.textContent.trim();
    const room = document.getElementById('roomId')?.textContent.trim();
    const key = `${film}|${room}`;
    if (key === last) return; // also stops the observer reacting to our own changes
    last = key;
    if (room && room !== '...') {
      const filmPart = film && film !== 'Выберите видео' ? `<strong></strong> · ` : '';
      el.innerHTML = `${filmPart}комната <span></span>`;
      if (filmPart) el.querySelector('strong').textContent = film;
      el.querySelector('span').textContent = room;
    } else {
      el.textContent = location.protocol === 'file:' ? 'Нет подключения' : 'Главная';
    }
  };
  update();
  new MutationObserver(update).observe(document.body, { subtree: true, childList: true, characterData: true });
}

function applyState(state) {
  if (!state) return;
  const max = document.querySelector('#tc-titlebar .tc-max');
  if (max) { max.innerHTML = icon(state.maximized ? 'restore' : 'maximize'); max.title = state.maximized ? 'Восстановить' : 'Развернуть'; }
  const back = document.querySelector('#tc-titlebar [data-a="back"]');
  if (back) back.disabled = !state.canGoBack;
  document.documentElement.classList.toggle('tc-mini', !!state.mini);
}

ipcRenderer.on('tc:window-state', (_e, state) => applyState(state));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildBar);
else buildBar();
