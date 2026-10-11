const { app, BrowserWindow, WebContentsView, ipcMain, Menu, session, clipboard, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

app.setName('aylight');

const TOP = 56;
const SIDEBAR = 236;
const GAP = 10;
const RADIUS = 12;
const PARTITION = 'persist:main';
const NEWTAB = pathToFileURL(path.join(__dirname, 'ui', 'newtab.html')).href;
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

let win = null;
let tabs = [];
let activeId = null;
let nextId = 1;
const closedStack = [];
let history = [];
let bookmarks = [];
let settings = { sidebar: true };
let downloads = [];
const downloadItems = new Map();
let nextDownloadId = 1;

const file = (name) => path.join(app.getPath('userData'), name);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v)); } catch {} };

function cleanUA(ua) {
  return ua.replace(/ Electron\/\S+/, '').replace(/ aylight\/\S+/, '').replace(/ Aylight\/\S+/, '');
}

function toURL(input) {
  const s = (input || '').trim();
  if (!s) return NEWTAB;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|file|data|mailto):/i.test(s)) return s;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}

const active = () => tabs.find((t) => t.id === activeId);
const sidebarWidth = () => (settings.sidebar ? SIDEBAR : 0);

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const x = sidebarWidth() + (settings.sidebar ? 0 : GAP);
  for (const t of tabs) {
    const on = t.id === activeId;
    t.view.setVisible(on);
    if (on) t.view.setBounds({ x, y: TOP, width: Math.max(0, w - x - GAP), height: Math.max(0, h - TOP - GAP) });
  }
}

function pushState() {
  if (!win || win.isDestroyed()) return;
  const a = active();
  const nav = a ? a.view.webContents.navigationHistory : null;
  win.webContents.send('state', {
    activeId,
    sidebar: settings.sidebar,
    canBack: nav ? nav.canGoBack() : false,
    canForward: nav ? nav.canGoForward() : false,
    bookmarked: !!(a && bookmarks.some((b) => b.url === a.url)),
    bookmarks,
    downloads,
    tabs: tabs.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url === NEWTAB ? '' : t.url,
      favicon: t.favicon,
      loading: t.loading,
    })),
  });
}

const HISTORY_DAYS = 90;
let historyTimer = null;

function pruneHistory() {
  const cutoff = Date.now() - HISTORY_DAYS * 86400000;
  history = history.filter((h) => h.t > cutoff);
  if (history.length > 5000) history.length = 5000;
}

function recordVisit(url, title) {
  if (!/^https?:/.test(url)) return;
  history = history.filter((h) => h.url !== url);
  history.unshift({ url, title, t: Date.now() });
  pruneHistory();
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => writeJSON(file('history.json'), history), 2000);
}

const bare = (u) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function jump(q) {
  const s = (q || '').trim().toLowerCase();
  const hit = (title, url) => !s || (title || '').toLowerCase().includes(s) || bare(url).toLowerCase().includes(s);
  const seen = new Set();
  const take = (list, n) => {
    const out = [];
    for (const x of list) {
      if (out.length >= n) break;
      if (!x.url || seen.has(x.url) || !hit(x.title, x.url)) continue;
      seen.add(x.url);
      out.push(x);
    }
    return out;
  };
  const openTabs = tabs.filter((t) => t.url !== NEWTAB).map((t) => ({ id: t.id, title: t.title, url: t.url, favicon: t.favicon }));
  return {
    tabs: take(openTabs, s ? 4 : 6),
    bookmarks: take(bookmarks, 3),
    history: take(history, s ? 5 : 4),
    search: s && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? q.trim() : '',
  };
}

let jumping = false;
function openJump() {
  jumping = true;
  const a = active();
  if (a) a.view.setVisible(false);
  win.webContents.focus();
  win.webContents.send('jump-open');
}

function closeJump() {
  if (!jumping) return;
  jumping = false;
  layout();
  if (win && !win.isDestroyed()) win.webContents.send('jump-close');
}

function createTab(url = NEWTAB, focus = true) {
  const view = new WebContentsView({
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
  });
  view.setBorderRadius(RADIUS);
  const tab = { id: nextId++, view, title: 'New Tab', url, favicon: null, loading: false };
  const wc = view.webContents;

  wc.setWindowOpenHandler(({ url: target, disposition }) => {
    if (disposition === 'new-window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 680, webPreferences: { partition: PARTITION } },
      };
    }
    createTab(target, disposition !== 'background-tab');
    return { action: 'deny' };
  });

  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    recordVisit(tab.url, title);
    pushState();
  });
  wc.on('page-favicon-updated', (_e, icons) => { tab.favicon = icons[0] || null; pushState(); });
  wc.on('did-start-loading', () => { tab.loading = true; pushState(); });
  wc.on('did-stop-loading', () => { tab.loading = false; pushState(); });
  const onNav = (_e, u) => {
    tab.url = u;
    if (u === NEWTAB) tab.title = 'New Tab';
    tab.favicon = u === NEWTAB ? null : tab.favicon;
    recordVisit(u, tab.title);
    pushState();
  };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', (e, u, isMain) => { if (isMain) onNav(e, u); });
  wc.on('context-menu', (_e, p) => contextMenu(wc, p));
  wc.on('found-in-page', (_e, r) => {
    if (tab.id === activeId) win.webContents.send('find-result', { active: r.activeMatchOrdinal, total: r.matches });
  });

  tabs.push(tab);
  win.contentView.addChildView(view);
  wc.loadURL(url);
  if (focus) activate(tab.id);
  else { layout(); pushState(); }
  if (focus && url === NEWTAB) focusAddress();
  return tab;
}

function activate(id) {
  if (!tabs.some((t) => t.id === id)) return;
  closeFind();
  closeJump();
  activeId = id;
  layout();
  pushState();
  const a = active();
  if (a && a.url !== NEWTAB) a.view.webContents.focus();
}

function closeTab(id = activeId) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [tab] = tabs.splice(i, 1);
  if (tab.url !== NEWTAB) closedStack.push(tab.url);
  win.contentView.removeChildView(tab.view);
  tab.view.webContents.close();
  if (!tabs.length) { createTab(); return; }
  if (activeId === id) activate(tabs[Math.min(i, tabs.length - 1)].id);
  else pushState();
}

function cycle(step) {
  const i = tabs.findIndex((t) => t.id === activeId);
  activate(tabs[(i + step + tabs.length) % tabs.length].id);
}

function toggleSidebar() {
  settings.sidebar = !settings.sidebar;
  writeJSON(file('settings.json'), settings);
  layout();
  pushState();
}

function toggleBookmark() {
  const a = active();
  if (!a || !/^https?:/.test(a.url)) return;
  const i = bookmarks.findIndex((b) => b.url === a.url);
  if (i >= 0) bookmarks.splice(i, 1);
  else bookmarks.push({ url: a.url, title: a.title, favicon: a.favicon, t: Date.now() });
  writeJSON(file('bookmarks.json'), bookmarks);
  pushState();
}

function removeBookmark(url) {
  bookmarks = bookmarks.filter((b) => b.url !== url);
  writeJSON(file('bookmarks.json'), bookmarks);
  pushState();
}

function openFind() {
  win.webContents.focus();
  win.webContents.send('find-open');
}

function closeFind() {
  const a = active();
  if (a) a.view.webContents.stopFindInPage('clearSelection');
  if (win && !win.isDestroyed()) win.webContents.send('find-close');
}

function focusAddress() {
  win.webContents.focus();
  win.webContents.send('focus-address');
}

function contextMenu(wc, p) {
  const items = [];
  if (p.linkURL) {
    items.push(
      { label: 'Open Link in New Tab', click: () => createTab(p.linkURL, false) },
      { label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' },
    );
  }
  if (p.hasImageContents && p.srcURL) {
    items.push(
      { label: 'Open Image in New Tab', click: () => createTab(p.srcURL, false) },
      { label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) },
      { type: 'separator' },
    );
  }
  if (p.selectionText) {
    const q = p.selectionText.trim().slice(0, 60);
    items.push({ label: `Search Google for “${q}”`, click: () => createTab(toURL(p.selectionText), true) });
  }
  if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
  else if (p.selectionText) items.push({ role: 'copy' });
  if (!items.length || items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
  items.push(
    { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Reload', click: () => wc.reload() },
    { type: 'separator' },
    { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) },
  );
  Menu.buildFromTemplate(items).popup({ window: win });
}

const onActive = (fn) => () => { const a = active(); if (a) fn(a.view.webContents); };

function buildMenu() {
  const tabKeys = Array.from({ length: 9 }, (_, n) => ({
    label: `Tab ${n + 1}`,
    accelerator: `CmdOrCtrl+${n + 1}`,
    visible: false,
    click: () => {
      const t = n === 8 ? tabs[tabs.length - 1] : tabs[n];
      if (t) activate(t.id);
    },
  }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => createTab() },
        {
          label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T',
          click: () => { const u = closedStack.pop(); if (u) createTab(u); },
        },
        { label: 'Open Location', accelerator: 'CmdOrCtrl+L', click: focusAddress },
        { label: 'Jump To…', accelerator: 'CmdOrCtrl+K', click: () => (jumping ? closeJump() : openJump()) },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: openFind },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => win.webContents.send('find-step', true) },
        { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: () => win.webContents.send('find-step', false) },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => closeTab() },
        ...(isMac ? [] : [{ role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Shift+S', click: toggleSidebar },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: onActive((wc) => wc.reload()) },
        { label: 'Hard Reload', accelerator: 'CmdOrCtrl+Shift+R', click: onActive((wc) => wc.reloadIgnoringCache()) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: onActive((wc) => wc.setZoomLevel(wc.getZoomLevel() + 0.5)) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: onActive((wc) => wc.setZoomLevel(wc.getZoomLevel() - 0.5)) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: onActive((wc) => wc.setZoomLevel(0)) },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: onActive((wc) => wc.toggleDevTools()) },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: toggleBookmark },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: onActive((wc) => wc.navigationHistory.goBack()) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: onActive((wc) => wc.navigationHistory.goForward()) },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => cycle(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycle(-1) },
        { label: 'Next Tab ', accelerator: 'CmdOrCtrl+Alt+Right', visible: false, click: () => cycle(1) },
        { label: 'Previous Tab ', accelerator: 'CmdOrCtrl+Alt+Left', visible: false, click: () => cycle(-1) },
        ...tabKeys,
      ],
    },
  ]));
}

function saveSession() {
  writeJSON(file('session.json'), {
    urls: tabs.map((t) => t.url).filter((u) => u !== NEWTAB),
    active: tabs.findIndex((t) => t.id === activeId),
  });
  writeJSON(file('history.json'), history);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 560,
    minHeight: 380,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? false : { height: 40, color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#d9dde3' : '#3a3f47' },
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: process.platform === 'linux' ? '#0f1316' : '#00000000',
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundMaterial: isWin ? 'acrylic' : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('resize', layout);
  win.on('close', saveSession);
  win.on('closed', () => { win = null; tabs = []; activeId = null; });

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('platform', process.platform);
    const saved = readJSON(file('session.json'), { urls: [] });
    if (saved.urls.length) {
      saved.urls.forEach((u) => createTab(u, false));
      activate(tabs[Math.max(0, Math.min(saved.active, tabs.length - 1))].id);
    } else {
      createTab();
    }
  });
}

ipcMain.on('new-tab', () => createTab());
ipcMain.on('close-tab', (_e, id) => closeTab(id));
ipcMain.on('activate', (_e, id) => activate(id));
ipcMain.on('navigate', (_e, text) => {
  const a = active();
  if (!a) return;
  a.view.webContents.loadURL(toURL(text));
  a.view.webContents.focus();
});
ipcMain.on('open', (_e, { url, newTab }) => {
  if (newTab || !active()) createTab(url, true);
  else { const a = active(); a.view.webContents.loadURL(url); a.view.webContents.focus(); }
});
ipcMain.on('back', onActive((wc) => wc.navigationHistory.goBack()));
ipcMain.on('forward', onActive((wc) => wc.navigationHistory.goForward()));
ipcMain.on('reload', onActive((wc) => (wc.isLoading() ? wc.stop() : wc.reload())));
ipcMain.on('escape-address', onActive((wc) => wc.focus()));
ipcMain.on('toggle-sidebar', toggleSidebar);
ipcMain.on('bookmark-toggle', toggleBookmark);
ipcMain.on('bookmark-remove', (_e, url) => removeBookmark(url));
ipcMain.on('find', (_e, { text, forward, next }) => {
  const a = active();
  if (!a) return;
  if (!text) { a.view.webContents.stopFindInPage('clearSelection'); return; }
  a.view.webContents.findInPage(text, { forward, findNext: !next });
});
ipcMain.on('find-close', () => { closeFind(); onActive((wc) => wc.focus())(); });
ipcMain.handle('jump', (_e, q) => jump(q));
ipcMain.on('download-open', (_e, id) => {
  const d = downloads.find((x) => x.id === id);
  if (!d || d.state !== 'completed') return;
  if (fs.existsSync(d.path)) shell.openPath(d.path);
  else { d.state = 'missing'; pushState(); }
});
ipcMain.on('download-reveal', (_e, id) => {
  const d = downloads.find((x) => x.id === id);
  if (d && fs.existsSync(d.path)) shell.showItemInFolder(d.path);
});
ipcMain.on('download-remove', (_e, id) => {
  const item = downloadItems.get(id);
  if (item) { item.cancel(); downloadItems.delete(id); }
  downloads = downloads.filter((x) => x.id !== id);
  pushState();
});
ipcMain.on('downloads-clear', () => {
  downloads = downloads.filter((x) => downloadItems.has(x.id));
  pushState();
});
ipcMain.on('jump-close', () => { closeJump(); onActive((wc) => wc.focus())(); });
ipcMain.on('jump-go', (_e, { tab, url, newTab }) => {
  closeJump();
  if (tab) return activate(tab);
  if (newTab || !active()) createTab(url, true);
  else { const a = active(); a.view.webContents.loadURL(url); a.view.webContents.focus(); }
});
ipcMain.handle('complete', (_e, q) => {
  const s = q.toLowerCase();
  for (const h of history) {
    const bare = h.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    const host = bare.split('/')[0];
    if (host.toLowerCase().startsWith(s)) return host;
    if (bare.toLowerCase().startsWith(s)) return bare;
  }
  return null;
});

if (!app.requestSingleInstanceLock()) app.quit();

app.on('second-instance', () => {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  const ses = session.fromPartition(PARTITION);
  const ua = cleanUA(ses.getUserAgent());
  ses.setUserAgent(ua);
  app.userAgentFallback = ua;
  ses.on('will-download', (_e, item) => {
    const dir = app.getPath('downloads');
    let name = item.getFilename();
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${stem} ${n}${ext}`;
    item.setSavePath(path.join(dir, name));
    const d = { id: nextDownloadId++, name, path: item.getSavePath(), received: 0, total: item.getTotalBytes(), state: 'progressing', t: Date.now() };
    downloads.unshift(d);
    if (downloads.length > 20) downloads.length = 20;
    downloadItems.set(d.id, item);
    item.on('updated', (_ev, state) => {
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      d.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      pushState();
    });
    item.once('done', (_ev, state) => {
      d.received = item.getReceivedBytes();
      d.state = state;
      downloadItems.delete(d.id);
      pushState();
    });
    pushState();
  });
  history = readJSON(file('history.json'), []);
  pruneHistory();
  bookmarks = readJSON(file('bookmarks.json'), []);
  settings = { ...settings, ...readJSON(file('settings.json'), {}) };
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('before-quit', () => { if (win) saveSession(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
