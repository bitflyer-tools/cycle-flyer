const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const path = require('node:path');
const { main } = require('../package.json');

const entry = readFileSync(path.resolve(__dirname, '..', main), 'utf8');
const helper = readFileSync(require.resolve('electron-squirrel-startup'), 'utf8');

async function launch(argument) {
  const events = [];
  const update = new EventEmitter();
  const app = {
    quit: () => events.push('quit'),
    whenReady: () => {
      events.push('whenReady');
      return Promise.resolve();
    },
    on: (event) => events.push(event),
  };
  const electron = {
    app,
    BrowserWindow: class {
      loadFile(filename) {
        events.push(filename);
      }
    },
  };
  const startupRequire = (name) => {
    if (name === 'electron') return electron;
    if (name === 'path') return path.win32;
    if (name === 'debug') return () => () => {};
    if (name === 'child_process') {
      return {
        spawn: (executable, args) => {
          assert.equal(executable, String.raw`C:\app\Update.exe`);
          events.push(...args);
          return update;
        },
      };
    }
    return require(name);
  };
  const execPath = String.raw`C:\app\app-1.1.0\cycle-flyer.exe`;
  const process = {
    platform: 'win32',
    execPath,
    argv: argument ? [execPath, argument] : [execPath],
  };
  const entryRequire = (name) => {
    if (name === 'electron') return electron;
    assert.equal(name, 'electron-squirrel-startup');
    const module = { exports: {} };
    compileFunction(helper, ['require', 'module', 'process'])(startupRequire, module, process);
    return module.exports;
  };
  compileFunction(entry, ['require', 'process'])(entryRequire, process);
  await Promise.resolve();
  return { events, update };
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

test('opens the trading window on a normal launch', async () => {
  const { events } = await launch();
  assert.deepEqual(events, ['whenReady', 'window-all-closed', 'activate', './public/index.html']);
});
