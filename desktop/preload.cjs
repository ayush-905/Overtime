// What the app's pages can ask of the app, and nothing else. Each page learns
// which window it's in (main, popover or office). The menu bar's popover says
// what the menu bar should show, and can hand a section over to the window. The
// Go menu's Back and Forward, and a swipe, arrive through onGo.
// See ui/src/data/desktop.ts and ui/src/app/glance.ts.

const { contextBridge, ipcRenderer } = require('electron');

const kind = (process.argv.find((a) => a.startsWith('--overtime-window=')) || '').split('=')[1] || '';

contextBridge.exposeInMainWorld('overtimeDesktop', {
  platform: process.platform,
  window: kind,
  glance: (glance) => ipcRenderer.send('ao:glance', glance),
  openWindow: (hash) => ipcRenderer.send('ao:open-window', hash),
  onGo: (fn) => ipcRenderer.on('ao:go', (_e, dir) => fn(dir)),
});
