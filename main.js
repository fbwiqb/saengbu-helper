const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const net = require('net');

const isDev = !app.isPackaged;

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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(async () => {
  await createWindow();
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify();
    } catch (_e) {}
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
