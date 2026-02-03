const { app, BrowserWindow, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true
    }
  });

  win.loadURL('app://./index.html');
};

app.whenReady().then(() => {
  const publicDir = path.join(__dirname, '..', 'public');

  protocol.handle('app', (request) => {
    let pathname = new URL(request.url).pathname;
    if (pathname === '/') {
      pathname = '/index.html';
    }
    const filePath = path.join(publicDir, pathname);
    return net.fetch(pathToFileURL(filePath).toString());
  });

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
