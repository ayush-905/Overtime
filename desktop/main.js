// Overtime as a Mac app: the dashboard in its own window, and a menu bar
// item with each provider's logo and what's left of its 5-hour and weekly
// windows, and a dot before them while an agent needs you (or the app's icon
// with just the closest limit, or today's cost, and a dot on the icon).
// Clicking it opens a panel under it with the summary, and a tab bar that opens
// any section there too, in the phone layout; a right click has the menu. The
// app runs the same server as `npm start` (see server-host.js). Closing the window keeps the app in the menu
// bar, and the dashboard stays loaded behind it so its alerts still arrive.
// Quit from the menu bar's menu or with ⌘Q. New versions come from GitHub
// Releases and install themselves (see updater.js).
//
// Run it with `npm run app`; build it with `npm run app:build`. For a trial
// run beside your own: OVERTIME_PORT picks the port it prefers (4777),
// OVERTIME_DIR where it keeps settings, and OVERTIME_DEBUG=1 logs to the terminal.

import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  session,
  shell,
} from 'electron';
import { createWriteStream, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginPath } from './shell-path.js';
import { createServerHost } from './server-host.js';
import { MENU_BAR, readPrefs, savePrefs } from './prefs.js';
import { createUpdater } from './updater.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ICONS = path.join(HERE, 'icons');
const PORT = /^\d{1,5}$/.test(process.env.OVERTIME_PORT || '') ? Number(process.env.OVERTIME_PORT) : 4777;
const DEBUG = !!process.env.OVERTIME_DEBUG;
// The dashboard's page (web/app, built from ui/).
const UI = '/';
const POPOVER_WIDTH = 400;
const POPOVER_MAX = 700; // points: the popover's height on every page, so it never moves as you switch
// The pages each window keeps to; a link anywhere else opens where it belongs.
// The popover is the dashboard too, its Overview the summary (see ui/src/app/glance.ts and ui/src/cards/Summary.tsx).
const HOME = { main: (p) => p === UI, office: (p) => p.startsWith('/office'), popover: (p) => p === UI };
const POPOVER_RESET_MS = 2 * 60_000; // closed this long, it opens on the summary again
const EXTERNAL = /^(https?|mailto|claude|codex|vscode|cursor):/i;

if (process.env.OVERTIME_USER_DATA) app.setPath('userData', process.env.OVERTIME_USER_DATA);
app.setName('Overtime');

let logFile = null;
function log(...parts) {
  const line = parts.join(' ');
  if (DEBUG) console.log(`[overtime] ${line}`);
  logFile?.write(`${new Date().toISOString()} ${line}\n`);
}

let host = null;
let updater = null;
let base = ''; // where the pages load from, like http://127.0.0.1:4777
let mainWin = null;
let popover = null;
let officeWin = null;
let tray = null;
let quitting = false;
let popoverShownAt = 0;
let popoverBlurredAt = 0;
let popoverReset = null;
let glance = null; // what the compact view last said: plan windows, today's cost, agents
let prefs = readPrefs();

const ours = (url) => {
  try {
    return !!base && new URL(url).origin === base;
  } catch {
    return false;
  }
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const background = () => (nativeTheme.shouldUseDarkColors ? '#141619' : '#f3efe7');
// `kind` tells the page which window it's in (see preload.cjs).
const webPreferences = (kind) => ({
  preload: path.join(HERE, 'preload.cjs'),
  additionalArguments: [`--overtime-window=${kind}`],
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  // Hidden windows rest like a background tab: no drawing, and timers slowed. Live
  // updates still arrive every couple of seconds, and with them the dashboard checks
  // its alerts and the popover updates the menu bar.
  spellcheck: false,
});

// ── Links ──────────────────────────────────────────────────────────────────

/** A link from any window: the dashboard, the office, or out to the browser or app it's for. */
function openLink(url) {
  if (ours(url)) {
    const u = new URL(url);
    popover?.hide();
    if (HOME.office(u.pathname)) showOffice();
    else showMain(u.hash);
    return;
  }
  if (EXTERNAL.test(url)) shell.openExternal(url);
  else log(`left a link alone: ${url.slice(0, 80)}`);
}

/** New windows become the app's own; a window leaving its page opens the link where it belongs. */
function guard(win, kind) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (ours(url) && HOME[kind](new URL(url).pathname)) return;
    e.preventDefault();
    openLink(url);
  });
}

// ── Windows ────────────────────────────────────────────────────────────────

/** Saved bounds, if their title bar is still on a screen. */
function onScreen(b) {
  if (!b) return null;
  const x = b.x + b.width / 2;
  const y = b.y + 12;
  return screen
    .getAllDisplays()
    .some(({ workArea: a }) => x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height)
    ? b
    : null;
}

function keepBounds(win, key) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isFullScreen()) prefs = savePrefs({ [key]: win.getNormalBounds() });
    }, 400);
  };
  win.on('resize', save);
  win.on('move', save);
}

function createMain({ show = true } = {}) {
  mainWin = new BrowserWindow({
    ...(onScreen(prefs.bounds) || { width: 1320, height: 860 }),
    minWidth: 480,
    minHeight: 420,
    show: false,
    title: 'Overtime',
    backgroundColor: background(),
    // Opened hidden, at login, it rests until it's shown.
    paintWhenInitiallyHidden: show,
    webPreferences: webPreferences('main'),
  });
  guard(mainWin, 'main');
  keepBounds(mainWin, 'bounds');
  mainWin.loadURL(`${base}${UI}`);
  if (show) mainWin.once('ready-to-show', () => showMain());
  // Closing it keeps it loaded, hidden, so its alerts still arrive.
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    if (mainWin.isFullScreen()) {
      mainWin.once('leave-full-screen', () => mainWin.hide());
      mainWin.setFullScreen(false);
    } else mainWin.hide();
  });
  mainWin.on('hide', leaveDockIfClosed);
  // A three-finger swipe, with the trackpad set to swipe between pages that way.
  mainWin.on('swipe', (_e, dir) => {
    if (dir === 'left' || dir === 'right') mainWin.webContents.send('ao:go', dir === 'left' ? 'back' : 'forward');
  });
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

/** Bring the dashboard up, at a section or session if given one (#usage, #session=…). */
async function showMain(hash = '') {
  if (!base) return;
  if (!mainWin) createMain({ show: false });
  if (app.dock && !app.dock.isVisible()) await app.dock.show();
  const wc = mainWin.webContents;
  if (hash && hash !== '#') {
    const here = wc.getURL();
    if (!wc.isLoading() && ours(here) && new URL(here).pathname === UI)
      wc.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
    else mainWin.loadURL(`${base}${UI}${hash}`);
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
  app.focus({ steal: true });
}

function showOffice() {
  if (!base) return;
  if (!officeWin) {
    officeWin = new BrowserWindow({
      ...(onScreen(prefs.officeBounds) || { width: 1180, height: 780 }),
      minWidth: 480,
      minHeight: 360,
      show: false,
      title: 'Pixel Office',
      backgroundColor: '#1d1b22',
      webPreferences: webPreferences('office'),
    });
    guard(officeWin, 'office');
    keepBounds(officeWin, 'officeBounds');
    officeWin.loadURL(`${base}/office/`);
    officeWin.once('ready-to-show', () => officeWin?.show());
    officeWin.on('closed', () => {
      officeWin = null;
      leaveDockIfClosed();
    });
  } else {
    officeWin.show();
  }
  officeWin.focus();
  app.focus({ steal: true });
}

/** With the setting on, the app leaves the Dock once no window of it is open. */
function leaveDockIfClosed() {
  if (!prefs.hideDockWhenClosed || !app.dock || quitting) return;
  if (mainWin?.isVisible() || officeWin) return;
  app.dock.hide();
}

// ── The menu bar ───────────────────────────────────────────────────────────

function createPopover() {
  popover = new BrowserWindow({
    // A panel, like Spotlight's: it opens on the desktop you're on, over a full-screen
    // app too, without bringing the app forward or taking you to its window's desktop.
    type: 'panel',
    width: POPOVER_WIDTH,
    height: popoverHeight(screen.getPrimaryDisplay().workArea),
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: background(),
    // Hidden until you click the icon, so it doesn't draw until then.
    paintWhenInitiallyHidden: false,
    webPreferences: webPreferences('popover'),
  });
  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  guard(popover, 'popover');
  popover.loadURL(`${base}${UI}#overview`);
  popover.on('blur', () => {
    if (popover.webContents.isDevToolsOpened() || !popover.isVisible()) return;
    // Just opened, the click that opened it can take the keyboard back for a moment.
    if (Date.now() - popoverShownAt < 400) {
      popover.focus();
      return;
    }
    popoverBlurredAt = Date.now();
    popover.hide();
  });
  // Closed a while, it's back on the summary for next time, with nothing to go back to.
  popover.on('hide', () => {
    clearTimeout(popoverReset);
    popoverReset = setTimeout(() => {
      if (!popover || popover.isVisible()) return;
      const wc = popover.webContents;
      if (new URL(wc.getURL()).hash === '#overview') {
        wc.navigationHistory.clear();
        return;
      }
      wc.once('did-finish-load', () => wc.navigationHistory.clear());
      wc.loadURL(`${base}${UI}#overview`);
    }, POPOVER_RESET_MS);
  });
  popover.on('show', () => clearTimeout(popoverReset));
  popover.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    popover.hide();
  });
  popover.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') popover.hide();
  });
}

/** As tall as it can be on a screen, up to POPOVER_MAX. */
const popoverHeight = (a) => Math.min(POPOVER_MAX, a.height - 24);

/** Under the menu bar icon, inside the screen it's on, and as tall as that screen allows. */
function placePopover() {
  const icon = tray.getBounds();
  const { workArea: a } = screen.getDisplayNearestPoint({ x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 });
  if (popover.getSize()[1] !== popoverHeight(a)) popover.setSize(POPOVER_WIDTH, popoverHeight(a));
  const [w, h] = popover.getSize();
  const x = clamp(Math.round(icon.x + icon.width / 2 - w / 2), a.x + 8, a.x + a.width - w - 8);
  // A menu bar along the top on a Mac; a taskbar along the bottom elsewhere.
  const below = icon.y < a.y + a.height / 2;
  const y = below ? Math.max(a.y + 6, icon.y + icon.height + 6) : icon.y - h - 6;
  popover.setPosition(x, Math.round(y));
}

/**
 * A click on the icon: open, or close what's open. Open means shown and in use:
 * one that says it's showing but isn't the window in use (on another screen, or
 * left behind when the focus moved without a word) opens properly instead, so a
 * click never goes on closing what you can't see.
 */
function togglePopover() {
  if (!popover) return;
  if (popover.isVisible() && popover.isFocused()) {
    popover.hide();
    return;
  }
  // This same click took the focus away and closed it a moment ago: it stays closed.
  if (Date.now() - popoverBlurredAt < 300) return;
  placePopover();
  popoverShownAt = Date.now();
  // Shown first, on this desktop, then given the keyboard: shown and focused in one
  // go, macOS would first switch to the desktop the dashboard window is on.
  popover.showInactive();
  popover.focus();
}

const trayImages = {};
function trayImage(needs) {
  const name = needs ? 'tray-needsTemplate.png' : 'trayTemplate.png';
  if (!trayImages[name]) {
    const image = nativeImage.createFromPath(path.join(ICONS, name));
    image.setTemplateImage(true);
    trayImages[name] = image;
  }
  return trayImages[name];
}

/** The compact view's summary, a line each: for the tooltip and the menu. */
function summary() {
  if (!glance) return [base ? 'Waiting for the first numbers' : 'Starting'];
  const agents = glance.needs
    ? `${glance.needs} ${glance.needs === 1 ? 'agent needs' : 'agents need'} you`
    : glance.working
      ? `${glance.working} ${glance.working === 1 ? 'agent' : 'agents'} working`
      : 'No agent needs you';
  return [...glance.windows, glance.cost ? `Cost today ≈ ${glance.cost}` : '', agents].filter(Boolean);
}

function paintTray() {
  if (!tray) return;
  const shows = prefs.menuBarShows;
  // Every limit is one picture, in place of the icon; the others are text beside the icon.
  const picture = shows === 'limits' ? limitsPicture() : null;
  const closest = glance?.left == null ? '' : glance.limited ? 'Limit' : `${glance.left}%`;
  const title = picture ? '' : { limits: closest, closest, cost: glance?.cost || '', icon: '' }[shows] || '';
  tray.setImage(picture || trayImage(!!glance?.needs));
  tray.setTitle(title, { fontType: 'monospacedDigit' });
  tray.setToolTip(['Overtime', ...summary()].join('\n'));
  app.dock?.setBadge(glance?.needs ? String(glance.needs) : '');
  log(
    `menu bar: ${picture ? `every limit (${picture.getSize().width}×${picture.getSize().height}pt)` : `"${title}"`}${glance?.needs ? ` with a dot (${glance.needs} need you)` : ''}`,
  );
}

function trayMenu() {
  const shows = { limits: 'Every Plan Limit', closest: 'Closest Limit Only', cost: 'Cost Today', icon: 'Icon Only' };
  const login = app.getLoginItemSettings();
  return Menu.buildFromTemplate([
    ...summary().map((label) => ({ label, enabled: false })),
    { type: 'separator' },
    { label: 'Open Overtime', click: () => showMain() },
    { label: 'Open the Pixel Office', click: showOffice },
    {
      label: 'Open in Browser',
      enabled: !!host?.port,
      click: () => shell.openExternal(`http://localhost:${host.port}/`),
    },
    { type: 'separator' },
    {
      label: 'Show in Menu Bar',
      submenu: MENU_BAR.map((id) => ({
        label: shows[id],
        type: 'radio',
        checked: prefs.menuBarShows === id,
        click: () => {
          prefs = savePrefs({ menuBarShows: id });
          paintTray();
        },
      })),
    },
    {
      label: 'Hide from Dock When Closed',
      type: 'checkbox',
      checked: prefs.hideDockWhenClosed,
      click: (item) => {
        prefs = savePrefs({ hideDockWhenClosed: item.checked });
        leaveDockIfClosed();
      },
    },
    // Only the built app: from `npm run app` it would be Electron itself that opens at login.
    {
      label: app.isPackaged ? 'Open at Login' : 'Open at Login (in the built app)',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: app.isPackaged && login.openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    updateItem(),
    { label: 'Quit Overtime', accelerator: 'Command+Q', click: () => app.quit() },
  ]);
}

function createTray() {
  tray = new Tray(trayImage(false));
  tray.setIgnoreDoubleClickEvents(true);
  tray.on('click', togglePopover);
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  paintTray();
}

/** What the compact view sends, kept to what the menu bar can show. */
function cleanGlance(g) {
  if (!g || typeof g !== 'object') return null;
  const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const count = (v) => (Number.isInteger(v) && v >= 0 && v < 10_000 ? v : 0);
  return {
    left: Number.isFinite(g.left) ? clamp(Math.round(g.left), 0, 100) : null,
    limited: !!g.limited,
    cost: text(g.cost, 24),
    windows: Array.isArray(g.windows)
      ? g.windows
          .slice(0, 8)
          .map((w) => text(w, 80))
          .filter(Boolean)
      : [],
    needs: count(g.needs),
    working: count(g.working),
    // The menu bar's picture of every limit, as the page drew it: a small PNG.
    image:
      typeof g.image === 'string' && g.image.startsWith('data:image/png;base64,') && g.image.length < 400_000
        ? g.image
        : '',
  };
}

let limitsImage = { from: '', image: null };
/** The page's drawing as a Retina template image, which macOS tints to suit the menu bar. */
function limitsPicture() {
  if (!glance?.image) return null;
  if (limitsImage.from !== glance.image) {
    const png = Buffer.from(glance.image.split(',')[1], 'base64');
    const image = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
    image.setTemplateImage(true);
    // To see what the menu bar shows: menu-bar.png beside the app's data.
    if (DEBUG) writeFileSync(path.join(app.getPath('userData'), 'menu-bar.png'), png);
    limitsImage = { from: glance.image, image: image.isEmpty() ? null : image };
  }
  return limitsImage.image;
}

ipcMain.on('ao:glance', (e, g) => {
  if (e.sender !== popover?.webContents || !ours(e.senderFrame?.url)) return;
  glance = cleanGlance(g);
  paintTray();
});
// From the popover: this section or session, in the window instead.
ipcMain.on('ao:open-window', (e, hash) => {
  if (e.sender !== popover?.webContents) return;
  popover.hide();
  showMain(typeof hash === 'string' && /^#[\w=?&%.:-]*$/.test(hash) ? hash : '#overview');
});

// ── The app's menu ─────────────────────────────────────────────────────────

function appMenu() {
  const go = [
    ['Overview', ''],
    ['Sessions', '#sessions'],
    ['Projects', '#projects'],
    ['Usage', '#usage'],
    ['Cost', '#cost'],
    ['Agents', '#agents'],
    ['You', '#you'],
  ];
  return Menu.buildFromTemplate([
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        updateItem(),
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: () => showMain('#settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Pixel Office', accelerator: 'Command+Shift+O', click: showOffice },
        { label: 'Open in Browser', click: () => host?.port && shell.openExternal(`http://localhost:${host.port}/`) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        // The page takes ⌘[ and ⌘] itself (see ui/src/app/back.ts); the menu shows them.
        { label: 'Back', accelerator: 'Command+[', registerAccelerator: false, click: () => goStep('back') },
        { label: 'Forward', accelerator: 'Command+]', registerAccelerator: false, click: () => goStep('forward') },
        { type: 'separator' },
        ...go.map(([label, hash], i) => ({
          label,
          accelerator: `Command+${i + 1}`,
          click: () => showMain(hash || '#overview'),
        })),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Show the Log', click: () => shell.showItemInFolder(path.join(app.getPath('logs'), 'overtime.log')) },
      ],
    },
  ]);
}

/** Back or forward in the dashboard window, from the Go menu. */
function goStep(dir) {
  if (mainWin?.isVisible()) mainWin.webContents.send('ao:go', dir);
}

// ── Updates ────────────────────────────────────────────────────────────────

/** The menus' update item, as things stand. */
function updateItem() {
  const s = updater?.status() || { state: 'idle' };
  if (!updater?.supported)
    return { label: app.isPackaged ? 'Check for Updates…' : 'Check for Updates… (in the built app)', enabled: false };
  if (s.state === 'ready') return { label: `Restart to Update to ${s.version}`, click: restartToUpdate };
  if (s.state === 'downloading')
    return { label: `Downloading ${s.version}…${s.progress ? ` ${s.progress}%` : ''}`, enabled: false };
  if (s.state === 'checking') return { label: 'Checking for Updates…', enabled: false };
  return { label: 'Check for Updates…', click: checkForUpdates };
}

function restartToUpdate() {
  if (updater?.install({ relaunch: true })) app.quit();
}

/** Asked for from a menu: says what it found. */
async function checkForUpdates() {
  const s = await updater.check();
  const say = (message, detail, buttons = ['OK']) =>
    dialog.showMessageBox({ type: 'info', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 });
  if (s.state === 'latest') say("You're up to date", `Overtime ${app.getVersion()} is the newest version.`);
  else if (s.state === 'downloading')
    say(
      `Downloading Overtime ${s.version}`,
      "You'll get a notification when it's ready. It installs when you quit, or restart to update then.",
    );
  else if (s.state === 'ready') {
    if (
      (
        await say(`Overtime ${s.version} is ready`, 'Restart now to update, or it installs when you quit.', [
          'Restart Now',
          'Later',
        ])
      ).response === 0
    )
      restartToUpdate();
  } else if (s.state === 'manual') {
    if ((await say(`Overtime ${s.version} is out`, s.message, ['Download', 'Later'])).response === 0)
      shell.openExternal(updater.source.page);
  } else if (s.state === 'error')
    dialog.showMessageBox({
      type: 'warning',
      message: "Couldn't check for updates",
      detail: s.message,
      buttons: ['OK'],
    });
}

let lastUpdateState = 'idle';
/** Each step redraws the menus; a version ready to install says so once. */
function updateChanged(s) {
  if (s.state !== lastUpdateState && s.state === 'ready' && Notification.isSupported()) {
    const n = new Notification({
      title: `Overtime ${s.version} is ready`,
      body: 'It installs when you quit. Click to restart and update now.',
    });
    n.on('click', restartToUpdate);
    n.show();
  }
  lastUpdateState = s.state;
  Menu.setApplicationMenu(appMenu());
}

// ── Start and quit ─────────────────────────────────────────────────────────

/** The pages load from a new port: every window reloads from there, where it was. */
function movePort(port) {
  const old = base;
  base = `http://127.0.0.1:${port}`;
  log(`the server moved to port ${port}`);
  for (const win of [mainWin, popover, officeWin]) {
    if (!win || win.isDestroyed()) continue;
    const here = win.webContents.getURL();
    win.loadURL(here.startsWith(old) ? base + here.slice(old.length) : `${base}${UI}`);
  }
}

async function start() {
  try {
    const logs = app.getPath('logs');
    mkdirSync(logs, { recursive: true });
    // The last run's log is kept beside this one's, so why it stopped can still be read after a relaunch.
    try {
      renameSync(path.join(logs, 'overtime.log'), path.join(logs, 'overtime.old.log'));
    } catch {}
    logFile = createWriteStream(path.join(logs, 'overtime.log'), { flags: 'w' });
  } catch {}
  Menu.setApplicationMenu(appMenu());
  app.setAboutPanelOptions({
    applicationName: 'Overtime',
    applicationVersion: app.getVersion(),
    credits: 'Your Claude Code, Codex and Pi limits, costs and agents, on this Mac.',
  });
  if (!app.isPackaged) app.dock?.setIcon(path.join(ICONS, 'icon.png'));

  // Only notifications and copying, and only for the app's own pages.
  const allowed = new Set(['notifications', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) =>
    done(allowed.has(permission) && ours(details.requestingUrl || wc.getURL())),
  );
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && ours(origin));

  // The menu bar icon comes first, so there's something to see while the server starts.
  createTray();
  const PATH = await loginPath();
  log(`PATH: ${PATH}`);
  host = createServerHost({
    entry: path.join(ROOT, 'server.js'),
    port: PORT,
    env: { ...process.env, PATH },
    log,
    onPort: movePort,
  });
  try {
    await host.start();
  } catch (error) {
    log(error.message);
    dialog.showErrorBox("Overtime couldn't start", `${error.message}\n\nThe log is in ${app.getPath('logs')}.`);
    app.exit(1);
    return;
  }
  base = `http://127.0.0.1:${host.port}`;
  createPopover();
  // Opened at login, it stays in the menu bar until you open it.
  const atLogin = app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin;
  createMain({ show: !atLogin && !process.argv.includes('--hidden') });
  if (atLogin) leaveDockIfClosed();
  paintTray();
  updater = createUpdater({ log, onChange: updateChanged });
  updater.start();
  Menu.setApplicationMenu(appMenu());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.on('activate', () => showMain());
  app.on('before-quit', () => {
    quitting = true;
    // A downloaded update goes in once the app has quit.
    updater?.install({ relaunch: false });
    host?.stop();
  });
  // Every window closed: still in the menu bar.
  app.on('window-all-closed', () => {});
  app.on('web-contents-created', (e, wc) => wc.on('will-attach-webview', (ev) => ev.preventDefault()));
  app.whenReady().then(start);
}
