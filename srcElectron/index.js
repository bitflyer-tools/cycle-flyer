const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const { createCredentialStore } = require('./credentials');

const windows = new Set();

const registerCredentialHandlers = () => {
  const store = createCredentialStore(path.join(app.getPath('userData'), 'bitflyer-credentials.enc'), safeStorage);
  const handlers = {
    'credentials:has-credentials': store.hasCredentials,
    'credentials:migrate': (pair) => store.save(pair, true),
    'credentials:save': (pair) => store.save(pair),
    'credentials:sign-rest': store.signRest,
    'credentials:sign-realtime': store.signRealtime,
  };
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!windows.has(event.sender) || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
        throw new Error('Invalid credential request sender.');
      }
      return handler(...args);
    });
  });
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  const contents = win.webContents;
  windows.add(contents);
  contents.once('destroyed', () => windows.delete(contents));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, '../public/index.html'));
};

app.whenReady().then(() => {
  registerCredentialHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
