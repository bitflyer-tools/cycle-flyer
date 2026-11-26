const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

// Chromium's remote debugging port is a Chromium (not Node) CLI switch, so it keeps working
// once the EnableNodeCliInspectArguments fuse removes --inspect from the packaged binary.
const createCdpClient = (socket) => {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.method + ': ' + message.error.message));
      else resolve(message.result);
    } else if (message.method) {
      listeners.forEach((listener) => listener(message));
    }
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject: (error) => reject(Object.assign(error, { method })) });
    const envelope = sessionId ? { id, method, params, sessionId } : { id, method, params };
    socket.send(JSON.stringify(envelope));
  });

  const on = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { send, on };
};

const waitFor = async (check, description) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check();
    if (result) return result;
    await delay(50);
  }
  throw new Error('Timed out waiting for ' + description);
};

const main = async (executable) => {
  assert.ok(executable, 'Pass the packaged Electron executable as an argument');
  assert.ok(existsSync(join(dirname(executable), 'resources', 'app.asar')),
    'The packaged build loads its code from an app.asar archive');

  const profile = mkdtempSync(join(process.cwd(), 'out', 'renderer-test-'));
  const app = spawn(executable, ['--remote-debugging-port=0', '--user-data-dir=' + profile], {
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
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) resolve(match[1]);
      });
      exited.then((code) => reject(new Error('Electron exited: ' + code)), reject);
      timeout.addEventListener('abort', () => reject(timeout.reason), { once: true });
    });

    socket = new WebSocket(endpoint);
    await once(socket, 'open', { signal: timeout });
    const cdp = createCdpClient(socket);

    const target = await waitFor(async () => {
      const { targetInfos } = await cdp.send('Target.getTargets');
      return targetInfos.find((info) => info.type === 'page');
    }, 'the app window');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);

    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || 'Evaluation failed');
      }
      return result.result.value;
    };

    const rest = 'https://api.bitflyer.jp/v1/executions';
    const realtime = 'wss://io.lightstream.bitflyer.com/socket.io/';
    const requests = new Set();
    const stopWatchingNetwork = cdp.on((message) => {
      if (message.sessionId !== sessionId) return;
      const url = message.method === 'Network.requestWillBeSent' ? message.params.request.url
        : message.method === 'Network.webSocketCreated' ? message.params.url
        : undefined;
      if (url === undefined) return;
      if (url.startsWith(rest)) requests.add(rest);
      if (url.startsWith(realtime)) requests.add(realtime);
    });
    try {
      await cdp.send('Page.reload', {}, sessionId);
      await waitFor(() => requests.has(rest), 'the bitFlyer REST request to pass CSP');
      await waitFor(() => requests.has(realtime), 'the bitFlyer WebSocket handshake to pass CSP');
    } finally {
      stopWatchingNetwork();
    }

    await evaluate(`(() => {
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
    const scriptBlocked = (source) => evaluate(
      `window.cspViolations.some(([directive, uri]) =>
        directive === 'script-src-elem' && uri.startsWith(${JSON.stringify(source)}))`
    );
    await waitFor(() => scriptBlocked('inline'), 'CSP to block an inline script');
    await waitFor(() => scriptBlocked('https://example.invalid'), 'CSP to block an external script');
    await waitFor(() => evaluate(
      "window.cspViolations.some(([directive, uri]) => directive === 'script-src' && uri === 'eval')"
    ), 'CSP to block dynamic evaluation');
    assert.deepEqual(await evaluate('[window.inlineScriptRan, window.evalRan]'), [undefined, undefined]);

    const visible = (selector) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await waitFor(() => visible('.content .trade'), 'Trade on startup');
    assert.equal(await evaluate(
      "getComputedStyle(document.querySelector('.content .trade')).display"
    ), 'grid', 'Trade uses the bundled stylesheet');
    await evaluate(`(() => {
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
    assert.deepEqual(await evaluate(
      '[typeof require, typeof process, typeof module, typeof Buffer]'
    ), ['undefined', 'undefined', 'undefined', 'undefined']);

    await click('.menu-setting');
    await waitFor(() => visible('.content #api-key-input'), 'Settings');
    await evaluate(`(() => {
      for (const key of ['api-key', 'api-secret']) {
        const field = document.querySelector('#' + key + '-input');
        field.value = 'pasted-test-' + key;
        field.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertFromPaste',
        }));
      }
    })()`);
    const credentialFile = join(profile, 'bitflyer-credentials.enc');
    assert.equal(existsSync(credentialFile), false, 'Pasting leaves the credentials unsaved');
    await evaluate("document.querySelector('#credentials-form').requestSubmit()");

    const statusText = await waitFor(async () => {
      const text = await evaluate("document.querySelector('#credentials-form [role=status]').textContent");
      return (text.startsWith('Credentials saved.') || text.startsWith('Could not update credentials.')) && text;
    }, 'the credentials form to report an outcome');
    const secureStorage = statusText.startsWith('Credentials saved.');

    assert.equal(existsSync(credentialFile), secureStorage);
    if (secureStorage) {
      // Exercises the real IPC bridge and encrypted store end to end, rather than reaching into
      // the main process to decrypt the file directly.
      const headers = await evaluate("window.bitFlyerCredentials.signRest('GET', '/v1/me/getpositions', '')");
      assert.equal(headers['ACCESS-KEY'], 'pasted-test-api-key');
      assert.equal(headers['ACCESS-SIGN'], createHmac('sha256', 'pasted-test-api-secret')
        .update(headers['ACCESS-TIMESTAMP'] + 'GET/v1/me/getpositions')
        .digest('hex'));
    }
    assert.deepEqual(await evaluate(
      "['api-key', 'api-secret'].map((key) => document.querySelector('#' + key + '-input').value)"
    ), ['', '']);
    assert.deepEqual(await evaluate(
      "['api-key', 'api-secret'].map((key) => localStorage.getItem(key))"
    ), [null, null]);
    await click('.menu-trade');
    await waitFor(() => visible('.content .trade'), 'Trade after returning from Settings');
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
