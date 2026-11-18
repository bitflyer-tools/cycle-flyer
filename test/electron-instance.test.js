const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const entry = path.resolve(__dirname, '../srcElectron/index.js');

const launch = (hasLock) => {
  const calls = [];
  const windows = [];
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
      this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });
    }

    loadFile() {}
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; calls.push('restore'); }
    focus() { calls.push('focus'); }
  };
  const electron = { app, BrowserWindow, ipcMain: { handle() {} } };
  const load = (name) => {
    if (name === 'electron') return electron;
    if (name === './credentials') {
      return { createCredentialStore: () => { calls.push('credentials'); return {}; } };
    }
    return require(name);
  };

  runInNewContext(readFileSync(entry, 'utf8'), { require: load, __dirname: path.dirname(entry) });
  return { app, calls, markReady, windows };
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
