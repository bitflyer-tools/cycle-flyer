const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const path = require('node:path');
const { main } = require('../package.json');

const entryPath = path.resolve(__dirname, '..', main);
const entry = readFileSync(entryPath, 'utf8');
const helper = readFileSync(require.resolve('../srcElectron/squirrelStartup'), 'utf8');

async function launch(argument, platform = 'win32') {
  const events = [];
  const windowOptions = [];
  const update = new EventEmitter();
  const app = {
    requestSingleInstanceLock: () => {
      events.push('lock');
      return true;
    },
    getPath: () => '/profile',
    quit: () => events.push('quit'),
    whenReady: () => {
      events.push('whenReady');
      return Promise.resolve();
    },
    on: (event) => events.push(event),
  };
  const electron = {
    app,
    ipcMain: { handle() {} },
    BrowserWindow: class {
      webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });

      constructor(options) {
        windowOptions.push(options);
      }

      loadFile(filename) {
        events.push(filename);
      }
    },
  };
  const startupRequire = (name) => {
    if (name === 'node:child_process') {
      return {
        spawn: (executable, args, options) => {
          assert.equal(executable, String.raw`C:\app\Update.exe`);
          assert.deepEqual(options, { detached: true });
          events.push(...args);
          return update;
        },
      };
    }
    return require(name);
  };
  const execPath = String.raw`C:\app\app-1.1.0\cycle-flyer.exe`;
  const process = {
    platform,
    execPath,
    argv: argument ? [execPath, argument] : [execPath],
  };
  const entryRequire = (name) => {
    if (name === 'electron') return electron;
    if (name === './credentials') return { createCredentialStore: () => ({}) };
    if (name !== './squirrelStartup') return require(name);
    const module = { exports: {} };
    compileFunction(helper, ['require', 'module'])(startupRequire, module);
    return module.exports;
  };
  compileFunction(entry, ['require', 'process', '__dirname'])(entryRequire, process, path.dirname(entryPath));
  await Promise.resolve();
  return { events, update, windowOptions };
}

[
  ['--squirrel-install', '--createShortcut=cycle-flyer.exe'],
  ['--squirrel-updated', '--createShortcut=cycle-flyer.exe'],
  ['--squirrel-uninstall', '--removeShortcut=cycle-flyer.exe'],
].forEach(([argument, shortcutCommand]) => {
  test(`handles ${argument} and quits after Update.exe exits`, async () => {
    const { events, update } = await launch(argument);
    assert.deepEqual(events, [shortcutCommand]);
    update.emit('close', 0);
    assert.deepEqual(events, [shortcutCommand, 'quit']);
  });
});

test('quits immediately for an obsolete version', async () => {
  const { events } = await launch('--squirrel-obsolete');
  assert.deepEqual(events, ['quit']);
});

test('opens the trading window on a normal launch or when Squirrel flags are inapplicable', async () => {
  for (const args of [[], ['--squirrel-firstrun'], ['--squirrel-install', 'linux']]) {
    const { events } = await launch(...args);
    assert.deepEqual(events, ['lock', 'whenReady', 'second-instance', 'activate', 'window-all-closed',
      path.resolve(__dirname, '../public/index.html')]);
  }
});

test('ships a strict Content-Security-Policy with the renderer entry point', () => {
  const html = readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
  const [, policy] = html.match(/<meta http-equiv="Content-Security-Policy"\s+content="([^"]+)">/) || [];
  assert.ok(policy, 'Expected a Content-Security-Policy meta tag in public/index.html');
  assert.equal(policy, "default-src 'none'; script-src 'self'; style-src 'self'; " +
    'connect-src https://api.bitflyer.jp wss://io.lightstream.bitflyer.com; ' +
    "base-uri 'none'; form-action 'none'");
});

test('creates the trading window with a hardened, sandboxed, context-isolated renderer', async () => {
  const { windowOptions } = await launch();
  assert.equal(windowOptions.length, 1);
  const { webPreferences } = windowOptions[0];
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.sandbox, true);
  assert.equal(webPreferences.preload, path.resolve(__dirname, '../srcElectron/preload.js'));
});
