const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const checkRenderer = async () => {
  const assert = process.getBuiltinModule('node:assert/strict');
  const { setTimeout: delay } = process.getBuiltinModule('node:timers/promises');
  const waitFor = async (check, description) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await check();
      if (result) return result;
      await delay(50);
    }
    throw new Error('Timed out waiting for ' + description);
  };

  // The inspector can accept requests before Electron loads the app entry point.
  const mainModule = await waitFor(() => process.mainModule, 'the app entry point');
  const { app, BrowserWindow } = mainModule.require('electron');
  await app.whenReady();

  assert.equal(app.isPackaged, true);
  assert.equal(app.commandLine.hasSwitch('no-sandbox'), false);
  const window = await waitFor(() => BrowserWindow.getAllWindows()[0], 'the app window');
  const contents = window.webContents;
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);

  const visible = (selector) => contents.executeJavaScript(
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`
  );
  const click = (selector) => contents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)}).click()`
  );
  await waitFor(() => visible('.content .trade'), 'Trade on startup');
  assert.deepEqual(await contents.executeJavaScript(
    '[typeof require, typeof process, typeof module, typeof Buffer]'
  ), ['undefined', 'undefined', 'undefined', 'undefined']);

  await click('.menu-setting');
  await waitFor(() => visible('.content #api-key-input'), 'Settings');
  await contents.executeJavaScript(`(() => {
    for (const key of ['api-key', 'api-secret']) {
      const field = document.querySelector('#' + key + '-input');
      field.value = 'pasted-test-' + key;
      field.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertFromPaste',
      }));
    }
    document.querySelector('.menu-trade').click();
  })()`);
  await waitFor(() => visible('.content .trade'), 'Trade after returning from Settings');
  assert.deepEqual(await contents.executeJavaScript(
    "['api-key', 'api-secret'].map((key) => localStorage.getItem(key))"
  ), ['pasted-test-api-key', 'pasted-test-api-secret']);
};

const main = async (executable) => {
  assert.ok(executable, 'Pass the packaged Electron executable as an argument');
  const profile = mkdtempSync(join(process.cwd(), 'out', 'renderer-test-'));
  const app = spawn(executable, ['--inspect=127.0.0.1:0', '--user-data-dir=' + profile], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const exited = once(app, 'exit');
  const timeout = AbortSignal.timeout(20000);
  let socket;
  let stderr = '';

  try {
    const endpoint = await new Promise((resolve, reject) => {
      app.stderr.on('data', (chunk) => {
        stderr += chunk;
        const match = stderr.match(/Debugger listening on (ws:\/\/\S+)/);
        if (match) resolve(match[1]);
      });
      exited.then((code) => reject(new Error('Electron exited: ' + code)), reject);
      timeout.addEventListener('abort', () => reject(timeout.reason), { once: true });
    });
    socket = new WebSocket(endpoint);
    await once(socket, 'open', { signal: timeout });
    const response = once(socket, 'message', { signal: timeout });
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: `(${checkRenderer})()`, awaitPromise: true },
    }));
    const [message] = await response;
    const { error, result } = JSON.parse(message.data);
    assert.ifError(error);
    assert.equal(result.exceptionDetails, undefined, result.result.description);
    console.log('Packaged renderer sandbox, routing, and credential persistence checks passed.');
  } catch (error) {
    if (stderr) console.error(stderr.trimEnd());
    throw error;
  } finally {
    socket?.close();
    app.kill();
    await exited.catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
};

main(process.argv[2]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
