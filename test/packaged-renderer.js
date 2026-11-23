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
  const { app, BrowserWindow, safeStorage } = mainModule.require('electron');
  await app.whenReady();

  assert.equal(app.isPackaged, true);
  assert.equal(app.commandLine.hasSwitch('no-sandbox'), false);
  const window = await waitFor(() => BrowserWindow.getAllWindows()[0], 'the app window');
  const contents = window.webContents;
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);

  const rest = 'https://api.bitflyer.jp/v1/executions';
  const realtime = 'wss://io.lightstream.bitflyer.com/socket.io/';
  const requests = new Set();
  const { webRequest } = contents.session;
  webRequest.onBeforeRequest({ urls: [rest + '*', realtime + '*'] }, (details, callback) => {
    if (details.webContentsId === contents.id) {
      const url = new URL(details.url);
      requests.add(url.origin + url.pathname);
    }
    callback({});
  });
  try {
    contents.reload();
    await waitFor(() => requests.has(rest), 'the bitFlyer REST request to pass CSP');
    await waitFor(() => requests.has(realtime), 'the bitFlyer WebSocket handshake to pass CSP');
  } finally {
    webRequest.onBeforeRequest(null);
  }

  await contents.executeJavaScript(`(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.disposition === 'enforce') {
        window.cspViolations.push([event.effectiveDirective, event.blockedURI]);
      }
    });
    const inline = document.createElement('script');
    inline.textContent = 'window.inlineScriptRan = true';
    document.head.append(inline);
    const external = document.createElement('script');
    external.src = 'https://example.invalid/csp-probe.js';
    document.head.append(external);
    setTimeout(() => {
      try {
        window.eval('window.evalRan = true');
      } catch (error) {
        if (!(error instanceof EvalError)) throw error;
      }
    }, 0);
  })()`);
  const scriptBlocked = (source) => contents.executeJavaScript(
    `window.cspViolations.some(([directive, uri]) =>
      directive === 'script-src-elem' && uri.startsWith(${JSON.stringify(source)}))`
  );
  await waitFor(() => scriptBlocked('inline'), 'CSP to block an inline script');
  await waitFor(() => scriptBlocked('https://example.invalid'), 'CSP to block an external script');
  await waitFor(() => contents.executeJavaScript(
    "window.cspViolations.some(([directive, uri]) => directive === 'script-src' && uri === 'eval')"
  ), 'CSP to block dynamic evaluation');
  assert.deepEqual(await contents.executeJavaScript(
    '[window.inlineScriptRan, window.evalRan]'
  ), [undefined, undefined]);

  const visible = (selector) => contents.executeJavaScript(
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`
  );
  const click = (selector) => contents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)}).click()`
  );
  await waitFor(() => visible('.content .trade'), 'Trade on startup');
  assert.equal(await contents.executeJavaScript(
    "getComputedStyle(document.querySelector('.content .trade')).display"
  ), 'grid', 'Trade uses the bundled stylesheet');
  assert.deepEqual(window.getSize(), [800, 600]);
  await contents.executeJavaScript(`(() => {
    const element = (selector) => document.querySelector(selector);
    const bounds = (selector) => element(selector).getBoundingClientRect();
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const board = bounds('.board');
    const trades = bounds('.recent-trades');
    const account = bounds('.trade-sidebar');
    const order = bounds('.order');
    check(board.top === trades.top && board.right <= trades.left,
      'The board and recent trades are side by side');
    check(account.top >= board.bottom && order.top === account.top,
      'Account information and the order form share the lower row');
    check(document.scrollingElement.scrollHeight === innerHeight &&
      document.scrollingElement.scrollWidth === innerWidth,
      'The default Trade view fits in the window');
    check(bounds('.collateral').bottom <= account.bottom &&
      bounds('.market-order-buttons').bottom <= order.bottom,
      'Collateral and market order controls are visible on startup');
    element('.order').scrollTop = element('.order').scrollHeight;
    check(element('.order').scrollTop > 0 && window.scrollY === 0,
      'Additional order types are reachable within the order panel');
    element('.order').scrollTop = 0;
  })()`);
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
  })()`);
  const credentialFile = process.getBuiltinModule('node:path').join(app.getPath('userData'), 'bitflyer-credentials.enc');
  const { existsSync, readFileSync } = process.getBuiltinModule('node:fs');
  assert.equal(existsSync(credentialFile), false, 'Pasting leaves the credentials unsaved');
  await contents.executeJavaScript("document.querySelector('#credentials-form').requestSubmit()");

  const secureStorage = safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  const message = secureStorage ? 'Credentials saved.' : 'Could not update credentials.';
  await waitFor(() => contents.executeJavaScript(
    `document.querySelector('#credentials-form [role=status]').textContent.startsWith(${JSON.stringify(message)})`
  ), message);

  assert.equal(existsSync(credentialFile), secureStorage);
  if (secureStorage) {
    assert.deepEqual(JSON.parse(safeStorage.decryptString(readFileSync(credentialFile))), {
      key: 'pasted-test-api-key', secret: 'pasted-test-api-secret',
    });
  }
  assert.deepEqual(await contents.executeJavaScript(
    "['api-key', 'api-secret'].map((key) => document.querySelector('#' + key + '-input').value)"
  ), ['', '']);
  assert.deepEqual(await contents.executeJavaScript(
    "['api-key', 'api-secret'].map((key) => localStorage.getItem(key))"
  ), [null, null]);
  await click('.menu-trade');
  await waitFor(() => visible('.content .trade'), 'Trade after returning from Settings');
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
    console.log('Packaged renderer sandbox, CSP, routing, and credential persistence checks passed.');
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
