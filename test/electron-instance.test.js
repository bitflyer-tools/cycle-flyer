const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');

const entry = path.resolve(__dirname, '../srcElectron/index.js');
const requireFromEntry = createRequire(entry);

const launch = (hasLock) => {
  const calls = [];
  const windows = [];
  const handlers = {};
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => { calls.push('lock'); return hasLock; },
    quit: () => calls.push('quit'),
    whenReady: () => { calls.push('ready'); return ready; },
    getPath: () => '/profile',
  });
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  const BrowserWindow = class {
    static getAllWindows() { return windows; }

    constructor() {
      calls.push('window');
      windows.push(this);
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler() {}, mainFrame: { name: 'main' },
      });
    }

    loadFile() {}
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; calls.push('restore'); }
    focus() { calls.push('focus'); }
  };
  const store = {
    hasCredentials: async () => true, migrate: async () => true,
    save: async () => {}, signRest: async () => ({}), signRealtime: async () => ({}),
  };
  const electron = {
    app, BrowserWindow, ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
  };
  const load = (name) => {
    if (name === 'electron') return electron;
    if (name === './credentials') {
      return { createCredentialStore: () => { calls.push('credentials'); return store; } };
    }
    return requireFromEntry(name);
  };

  compileFunction(readFileSync(entry, 'utf8'), ['require', '__dirname'])(load, path.dirname(entry));
  return { app, calls, markReady, windows, handlers, store };
};

test('a second process quits before initializing credentials or windows', async () => {
  const { app, calls, markReady } = launch(false);
  markReady();
  await Promise.all(app.listeners('activate').map((listener) => listener()));
  assert.deepEqual(calls, ['lock', 'quit']);
});

test('a second launch reuses the primary process and restores its window', async () => {
  const { app, calls, markReady, windows } = launch(true);
  const onSecondInstance = app.listeners('second-instance')[0];
  const relaunch = onSecondInstance();
  assert.deepEqual(calls, ['lock', 'ready']);
  markReady();
  await relaunch;
  assert.deepEqual(calls, ['lock', 'ready', 'credentials', 'window', 'focus']);

  windows[0].minimized = true;
  await onSecondInstance();
  assert.deepEqual(calls.slice(-2), ['restore', 'focus']);

  windows.pop();
  await app.listeners('activate')[0]();
  assert.equal(windows.length, 1);
  assert.equal(calls.filter((call) => call === 'credentials').length, 1);
});

test('a credential handler accepts only the main frame of a window it created', async () => {
  const { app, markReady, windows, handlers } = launch(true);
  markReady();
  await app.listeners('second-instance')[0]();
  const [window] = windows;
  const handle = handlers['credentials:has-credentials'];

  await assert.doesNotReject(
    () => handle({ sender: window.webContents, senderFrame: window.webContents.mainFrame }),
  );

  await assert.rejects(
    () => handle({ sender: window.webContents, senderFrame: { name: 'iframe' } }),
    /Invalid credential request sender\./,
  );
  await assert.rejects(
    () => handle({ sender: {}, senderFrame: window.webContents.mainFrame }),
    /Invalid credential request sender\./,
  );
  await assert.rejects(
    () => handle({ sender: window.webContents, senderFrame: null }),
    /Invalid credential request sender\./,
  );
});
