// Bridge between the website and the Windows app. The site checks `window.tcDesktop`
// to turn on app-only features (notifications, hotkeys, mini player).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tcDesktop', {
  notify: (title, body) => ipcRenderer.send('tc:notify', { title: String(title), body: String(body) }),
  setMini: on => ipcRenderer.send('tc:set-mini', !!on),
  onCommand: callback => ipcRenderer.on('tc:command', (_e, command) => callback(command)),
  onMiniMode: callback => ipcRenderer.on('tc:mini', (_e, on) => callback(on)),
});
