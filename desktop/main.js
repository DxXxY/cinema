// Together Cinema for Windows: the website in its own window, plus tray,
// notifications, an always-on-top mini player, global hotkeys, invite links
// (togethercinema://room/<id>) and auto-update from GitHub Releases.
const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeImage, shell, session, screen } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const SITE = process.env.TC_SITE || 'https://cinema-geht.onrender.com';
const SITE_ORIGIN = new URL(SITE).origin;
const PROTOCOL = 'togethercinema';
const MINI_SIZE = { width: 480, height: 300 };
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
// Each action tries its shortcuts in order; another program may already own one.
const HOTKEYS = [
  { command: 'toggle-play', label: 'Пауза / продолжить', options: ['CommandOrControl+Alt+P', 'CommandOrControl+Alt+Space'] },
  { command: 'toggle-play', options: ['MediaPlayPause'] },
  { command: 'toggle-mic', label: 'Микрофон вкл/выкл', options: ['CommandOrControl+Alt+M', 'CommandOrControl+Alt+K', 'CommandOrControl+Alt+V'] },
  { command: 'toggle-mini', label: 'Мини-плеер', options: ['CommandOrControl+Alt+O', 'CommandOrControl+Alt+I'] },
];
const shortcutText = accelerator => accelerator.replace('CommandOrControl', 'Ctrl').replace('Space', 'Пробел');

const appIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
let win = null, tray = null, mini = false, normalBounds = null, quitting = false, trayHintShown = false, updateReady = null;

// togethercinema://room/<id>?key=… → https://<site>/room/<id>?key=…
function siteUrlFromDeepLink(link) {
  if (!link) return null;
  try {
    const u = new URL(link);
    if (u.protocol !== `${PROTOCOL}:`) return null;
    const [kind, id] = [u.hostname, ...u.pathname.split('/')].filter(Boolean);
    if (kind !== 'room' || !id) return SITE;
    const target = new URL(`/room/${encodeURIComponent(decodeURIComponent(id))}`, SITE);
    const key = u.searchParams.get('key');
    if (key) target.searchParams.set('key', key);
    return target.toString();
  } catch { return null; }
}
const deepLinkIn = argv => argv.find(arg => arg.startsWith(`${PROTOCOL}://`));

const isSiteUrl = url => { try { return new URL(url).origin === SITE_ORIGIN; } catch { return false; } };
const openExternal = url => { try { if (['http:', 'https:'].includes(new URL(url).protocol)) shell.openExternal(url); } catch {} };

function notify(title, body) {
  const n = new Notification({ title, body, icon: appIcon, silent: false });
  n.on('click', showWindow);
  n.show();
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(startUrl, hidden) {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 360, minHeight: 240,
    show: !hidden, backgroundColor: '#090a12', title: 'Together Cinema', icon: appIcon,
    frame: false, // own title bar, drawn by preload.js
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadURL(startUrl);

  // Links to other sites open in the normal browser; the app stays on our site.
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isSiteUrl(url) && !url.startsWith('file:')) { e.preventDefault(); openExternal(url); }
  });
  // No connection or the server is waking up: show a local page that retries.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: navigation aborted by us
    win.loadFile(path.join(__dirname, 'assets', 'offline.html'), { query: { url: isSiteUrl(url) ? url : SITE } });
  });
  win.webContents.on('did-navigate-in-page', () => { updateTitle(); sendWindowState(); });
  win.webContents.on('did-navigate', sendWindowState);
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(event, sendWindowState);
  win.on('page-title-updated', e => { e.preventDefault(); updateTitle(); });

  // Closing the window keeps the app in the tray; "Выход" in the tray quits.
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown) { trayHintShown = true; notify('Together Cinema работает в трее', 'Голос и уведомления продолжают работать. Выйти — через иконку в трее.'); }
  });
}

function windowState() {
  return { maximized: !!win?.isMaximized(), mini, canGoBack: !!win?.webContents.navigationHistory.canGoBack() };
}
function sendWindowState() {
  if (win && !win.isDestroyed()) win.webContents.send('tc:window-state', windowState());
}

function updateTitle() {
  if (win) win.setTitle(mini ? 'Together Cinema — мини-плеер' : 'Together Cinema');
}

function setMini(on) {
  if (!win || on === mini) return;
  mini = on;
  if (on) {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    normalBounds = win.getBounds();
    const area = screen.getDisplayMatching(normalBounds).workArea;
    win.setMinimumSize(320, 180);
    win.setBounds({ ...MINI_SIZE, x: area.x + area.width - MINI_SIZE.width - 24, y: area.y + area.height - MINI_SIZE.height - 24 });
    win.setAlwaysOnTop(true, 'floating');
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(360, 240);
    if (normalBounds) win.setBounds(normalBounds);
  }
  win.webContents.send('tc:mini', on);
  sendWindowState();
  updateTitle();
  updateTrayMenu();
  showWindow();
}

function openNewRoom() {
  win?.loadURL(new URL('/room/', SITE).toString());
  showWindow();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Together Cinema', click: showWindow },
    { label: 'Новая комната', click: openNewRoom },
    { type: 'separator' },
    { label: 'Мини-плеер поверх окон', type: 'checkbox', checked: mini, click: () => setMini(!mini) },
    { label: 'Запускать вместе с Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }) },
    { label: 'Горячие клавиши', submenu: HOTKEYS.filter(h => h.label).map(h => ({ label: `${h.label} — ${h.active ? shortcutText(h.active) : 'занято другой программой'}`, enabled: false })) },
    { type: 'separator' },
    updateReady
      ? { label: `Перезапустить и обновить до ${updateReady}`, click: () => { quitting = true; autoUpdater.quitAndInstall(); } }
      : { label: 'Проверить обновления', click: () => checkUpdates(true) },
    { label: `Версия ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } },
  ]));
}

function registerHotkeys() {
  for (const hotkey of HOTKEYS) {
    const run = () => {
      if (hotkey.command === 'toggle-mini') setMini(!mini);
      else win?.webContents.send('tc:command', hotkey.command);
    };
    hotkey.active = hotkey.options.find(accelerator => { try { return globalShortcut.register(accelerator, run); } catch { return false; } }) || null;
  }
}

// Only our site may ask for the microphone; fullscreen and notifications are fine for embeds too.
function setupPermissions() {
  const allowed = (permission, origin) =>
    ['fullscreen', 'notifications', 'clipboard-sanitized-write'].includes(permission) ||
    (origin === SITE_ORIGIN && ['media', 'clipboard-read'].includes(permission));
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    let origin = '';
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch {}
    callback(allowed(permission, origin));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowed(permission, requestingOrigin));
}

function setupIpc() {
  const fromSite = e => isSiteUrl(e.senderFrame?.url || '');
  ipcMain.on('tc:notify', (e, msg) => {
    if (!fromSite(e) || !win || (win.isVisible() && win.isFocused())) return;
    notify(String(msg?.title || 'Together Cinema').slice(0, 100), String(msg?.body || '').slice(0, 300));
    win.flashFrame(true);
  });
  ipcMain.on('tc:set-mini', (e, on) => { if (fromSite(e)) setMini(!!on); });
  // Title bar buttons (preload.js). Also allowed from the local offline page.
  ipcMain.handle('tc:window-state', () => windowState());
  ipcMain.on('tc:window', (_e, action) => {
    if (!win) return;
    const history = win.webContents.navigationHistory;
    switch (action) {
      case 'minimize': win.minimize(); break;
      case 'maximize': if (win.isMaximized()) win.unmaximize(); else win.maximize(); break;
      case 'close': win.close(); break; // hides to the tray, see the 'close' handler
      case 'back': if (history.canGoBack()) history.goBack(); break;
      case 'home': win.loadURL(SITE); break;
      case 'mini': setMini(true); break;
      case 'unmini': setMini(false); break;
    }
  });
  win.on('focus', () => win.flashFrame(false));
}

function checkUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) notify('Обновления', 'Проверка работает только в установленном приложении.');
    return;
  }
  autoUpdater.checkForUpdates().catch(() => { if (manual) notify('Обновления', 'Не удалось проверить обновления. Попробуй позже.'); });
  if (manual) autoUpdater.once('update-not-available', () => notify('Обновления', `У тебя последняя версия — ${app.getVersion()}.`));
}

function setupUpdates() {
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', info => {
    updateReady = info.version;
    updateTrayMenu();
    notify('Доступно обновление', `Версия ${info.version} установится при выходе — или перезапусти из меню в трее.`);
  });
  checkUpdates(false);
  setInterval(() => checkUpdates(false), UPDATE_CHECK_MS);
}

function start() {
  app.setAppUserModelId('com.dxxxy.togethercinema'); // required for Windows notifications
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  Menu.setApplicationMenu(null);
  setupPermissions();

  const startUrl = siteUrlFromDeepLink(deepLinkIn(process.argv)) || SITE;
  createWindow(startUrl, process.argv.includes('--hidden'));
  setupIpc();

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Together Cinema');
  tray.on('click', showWindow);
  registerHotkeys();
  updateTrayMenu();
  setupUpdates();
}

// One running copy: a second launch (e.g. from an invite link) goes to the first window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = siteUrlFromDeepLink(deepLinkIn(argv));
    if (url) win?.loadURL(url);
    showWindow();
  });
  app.whenReady().then(start);
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {}); // stay in the tray
}
