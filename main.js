const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const net = require('net');

const isDev = !app.isPackaged;
let mainWin = null;

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
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}`);
}

function setupAutoUpdate() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    const send = (ch, data) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, data); };
    autoUpdater.on('update-available', (info) => send('upd:available', { version: info && info.version }));
    autoUpdater.on('download-progress', (p) => send('upd:progress', { percent: p.percent || 0, transferred: p.transferred, total: p.total }));
    autoUpdater.on('update-downloaded', (info) => send('upd:downloaded', { version: info && info.version }));
    autoUpdater.on('error', (e) => send('upd:error', { message: String((e && e.message) || e) }));
    ipcMain.on('upd:restart', () => { try { autoUpdater.quitAndInstall(); } catch (_e) {} });
    ipcMain.on('upd:check', () => { try { autoUpdater.checkForUpdates(); } catch (_e) {} });
    autoUpdater.checkForUpdates();
  } catch (_e) {}
}

app.whenReady().then(async () => {
  await createWindow();
  if (!isDev) setupAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
