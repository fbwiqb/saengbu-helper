const { app, BrowserWindow, shell, ipcMain, session } = require('electron');
const path = require('path');
const net = require('net');

app.commandLine.appendSwitch('disable-features', 'WinrtGeolocationImplementation,WinrtSensorsImplementation');

const isDev = !app.isPackaged;
let mainWin = null;
let autoUpdaterRef = null;
let updateReady = false;
let relaunchAfterInstall = false;

function findFreePort(preferred) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => {
      const fb = net.createServer();
      fb.listen(0, '127.0.0.1', () => {
        const port = fb.address().port;
        fb.close(() => resolve(port));
      });
    });
    srv.listen(preferred, '127.0.0.1', () => {
      srv.close(() => resolve(preferred));
    });
  });
}

function startServer(port) {
  process.env.DB_FILE = path.join(app.getPath('userData'), 'saengbu.db');
  const { open } = require('./src/db');
  const { createApp } = require('./src/server');
  const db = open(process.env.DB_FILE);
  return new Promise((resolve) => {
    const server = createApp(db).listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function createWindow() {
  const port = await findFreePort(Number(process.env.PORT) || 5870);
  await startServer(port);
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#f4f6fb',
    title: '생기부 입력 도우미',
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') },
  });
  mainWin = win;
  let forceClose = false;
  win.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    (async () => {
      let dirty = false;
      try { dirty = await win.webContents.executeJavaScript('window.__appDirty === true'); } catch (_e) {}
      if (dirty) {
        let saved = false;
        try { saved = await win.webContents.executeJavaScript('window.__flushSave ? window.__flushSave() : Promise.resolve(false)'); } catch (_e) {}
        if (!saved) {
          const { dialog } = require('electron');
          const res = dialog.showMessageBoxSync(win, { type: 'warning', noLink: true, buttons: ['종료', '취소'], defaultId: 1, cancelId: 1, title: '종료', message: '저장하지 않은 변경이 있습니다. 종료할까요?' });
          if (res !== 0) { relaunchAfterInstall = false; return; }
        }
      }
      forceClose = true;
      if (updateReady && autoUpdaterRef) {
        try { autoUpdaterRef.quitAndInstall(true, relaunchAfterInstall); return; } catch (_e) {}
      }
      win.destroy();
    })();
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}`);
}

const DOWNLOAD_PAGE = 'https://local-toolbox.vercel.app/saengbu';
const INSTALL_FAIL_LIMIT = 3;
let attemptCountedThisRun = false;

function updateStateFile() {
  return path.join(app.getPath('userData'), 'update-state.json');
}

function versionAtLeast(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

function readUpdateState() {
  try { return JSON.parse(require('fs').readFileSync(updateStateFile(), 'utf8')); } catch (_e) { return null; }
}

function clearStaleUpdateState() {
  const st = readUpdateState();
  if (st && versionAtLeast(app.getVersion(), st.version)) {
    try { require('fs').unlinkSync(updateStateFile()); } catch (_e) {}
  }
}

function noteInstallAttempt(version) {
  const st = readUpdateState();
  let attempts = st && st.version === version ? st.attempts || 0 : 0;
  if (!attemptCountedThisRun) {
    attempts += 1;
    attemptCountedThisRun = true;
    try { require('fs').writeFileSync(updateStateFile(), JSON.stringify({ version, attempts })); } catch (_e) {}
  }
  return attempts;
}

function setupAutoUpdate() {
  try {
    clearStaleUpdateState();
    const { autoUpdater } = require('electron-updater');
    autoUpdaterRef = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    const send = (ch, data) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, data); };
    autoUpdater.on('update-available', (info) => send('upd:available', { version: info && info.version }));
    autoUpdater.on('download-progress', (p) => send('upd:progress', { percent: p.percent || 0, transferred: p.transferred, total: p.total }));
    autoUpdater.on('update-downloaded', (info) => {
      updateReady = true;
      const version = info && info.version;
      const attempts = noteInstallAttempt(version);
      if (attempts >= INSTALL_FAIL_LIMIT) send('upd:failed', { version, url: DOWNLOAD_PAGE });
      else send('upd:downloaded', { version });
    });
    autoUpdater.on('update-not-available', (info) => send('upd:none', { version: info && info.version }));
    autoUpdater.on('error', (e) => send('upd:error', { message: String((e && e.message) || e) }));
    ipcMain.on('upd:restart', () => { relaunchAfterInstall = true; if (mainWin && !mainWin.isDestroyed()) mainWin.close(); });
    ipcMain.on('upd:check', () => { try { autoUpdater.checkForUpdates(); } catch (_e) {} });
    autoUpdater.checkForUpdates();
  } catch (_e) {}
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm !== 'geolocation'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm !== 'geolocation');
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), store: process.windowsStore === true }));
  await createWindow();
  if (!isDev && !process.windowsStore) setupAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
