const assert = require('node:assert/strict');
const { createHmac, webcrypto } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync, existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { buildSync } = require('esbuild');
const { createCredentialStore } = require('../srcElectron/credentials');

const pair = { key: 'test-api-key', secret: 'test-api-secret' };
const hmac = (message) => createHmac('sha256', pair.secret).update(message).digest('hex');

const rendererBundle = buildSync({
  stdin: {
    contents: `
      export { default as Stream } from 'xstream';
      export * from './src/credentials';
      export * from './src/drivers/httpDriver';
      export * from './src/drivers/privateChannel';
      export * from './src/http';
      export { request as boardRequest } from './src/components/trade/board/request';
      export { request as summaryRequest } from './src/components/trade/summary/request';
      export * from './src/components/trade/order/twapRequest';
      export * from './src/components/trade/order/twapView';
      export * from './src/components/setting/view';
      export { intent as settingsIntent } from './src/components/setting/intent';
    `,
    resolveDir: path.join(__dirname, '..'),
  },
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  write: false,
}).outputFiles[0].text;

const createRenderer = (entries, bridge) => {
  const module = { exports: {} };
  const localStorage = {
    getItem: (key) => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
  runInNewContext(rendererBundle, {
    console, crypto: webcrypto, Date, localStorage, module, setTimeout, clearTimeout, setInterval, clearInterval,
    window: { bitFlyerCredentials: bridge },
  });
  return module.exports;
};

const withCredentialFile = (t) => {
  const directory = mkdtempSync(path.join(__dirname, '.credentials-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'credentials.enc');
};

test('Electron stores the encrypted pair, reloads it and signs both protocols', (t) => {
  const file = withCredentialFile(t);
  const encrypted = Buffer.from('mock ciphertext');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (plaintext) => {
      assert.deepEqual(JSON.parse(plaintext), pair);
      return encrypted;
    },
    decryptString: (ciphertext) => {
      assert.deepEqual(ciphertext, encrypted);
      return JSON.stringify(pair);
    },
  };
  const store = createCredentialStore(file, safeStorage, 'linux');
  assert.equal(store.migrate(pair), true);
  assert.deepEqual(readFileSync(file), encrypted);

  const reopened = createCredentialStore(file, safeStorage, 'linux');
  assert.equal(reopened.migrate({ key: 'stale', secret: 'stale' }), true);
  const method = 'POST';
  const requestPath = '/v1/me/sendchildorder?product_code=FX_BTC_JPY';
  const body = '{"size":1}';
  const headers = reopened.signRest(method, requestPath, body);
  assert.equal(headers['ACCESS-KEY'], pair.key);
  assert.equal(headers['ACCESS-SIGN'], hmac(headers['ACCESS-TIMESTAMP'] + method + requestPath + body));
  assert.throws(() => reopened.signRest('GET', '/v1/me/getbalance', ''), /Invalid bitFlyer request/);
  const realtime = reopened.signRealtime();
  assert.equal(realtime.api_key, pair.key);
  assert.match(realtime.nonce, /^[a-f0-9]{32}$/);
  assert.equal(realtime.signature, hmac(realtime.timestamp + realtime.nonce));

  reopened.save(null);
  assert.equal(existsSync(file), false);
  assert.equal(reopened.signRealtime(), null);
});

test('Electron rejects Linux storage backed by a hardcoded password', (t) => {
  const file = withCredentialFile(t);
  const store = createCredentialStore(file, {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'basic_text',
    encryptString: () => assert.fail('Insecure encryption was attempted'),
  }, 'linux');
  assert.equal(store.migrate(pair), false);
  assert.throws(() => store.save(pair), /OS credential storage is unavailable/);
  assert.equal(existsSync(file), false);
});

test('browser migration and saves stay in memory and a reload drops the pair', async () => {
  const entries = new Map([['api-key', pair.key], ['api-secret', pair.secret], ['other-setting', 'yes']]);
  const renderer = createRenderer(entries);
  assert.equal(await renderer.initializeCredentials(), true);
  assert.deepEqual([...entries], [['other-setting', 'yes']]);
  assert.equal((await renderer.signRealtime()).api_key, pair.key);
  await renderer.saveCredentials(null);
  assert.equal(await renderer.signRealtime(), null);
  await renderer.saveCredentials(pair);
  assert.deepEqual([...entries], [['other-setting', 'yes']]);
  assert.equal((await renderer.signRealtime()).api_key, pair.key);
  assert.equal(await createRenderer(entries).signRealtime(), null);
});

test('browser signs the actual REST URL and body for each dispatch', async (t) => {
  const renderer = createRenderer(new Map());
  t.mock.method(Date, 'now', () => 1000);
  assert.equal(await renderer.authorizeRequest(renderer.getOrders()), null);
  const publicRequest = renderer.getBoard();
  assert.equal(await renderer.authorizeRequest(publicRequest), publicRequest);
  await renderer.saveCredentials(pair);
  const poll = renderer.getOrders();
  const first = await renderer.authorizeRequest(poll);
  Date.now.mock.mockImplementation(() => 2000);
  const second = await renderer.authorizeRequest(poll);
  const requestPath = '/v1/me/getchildorders?product_code=FX_BTC_JPY&child_order_state=ACTIVE';
  assert.equal(first.credentialVersion, renderer.currentCredentialVersion());
  assert.equal(second.credentialVersion, renderer.currentCredentialVersion());
  assert.equal(first.headers['ACCESS-KEY'], pair.key);
  assert.equal(first.headers['ACCESS-TIMESTAMP'], '1000');
  assert.equal(first.headers['ACCESS-SIGN'], hmac('1000GET' + requestPath));
  assert.equal(second.headers['ACCESS-SIGN'], hmac('2000GET' + requestPath));
  assert.equal(poll.headers['ACCESS-KEY'], undefined);

  const order = await renderer.authorizeRequest(renderer.marketOrder(1, 'BUY'));
  assert.equal(order.headers['ACCESS-SIGN'], hmac('2000POST' + new URL(order.url).pathname +
    new URL(order.url).search + order.send));
});

for (const saved of [false, true]) {
  test(`initial and periodic public REST polls stay unsigned ${saved ? 'with' : 'without'} saved credentials`, async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const signRest = t.mock.fn();
    const renderer = createRenderer(new Map(), {
      hasCredentials: async () => saved,
      save: async () => {},
      signRest,
    });
    await renderer.saveCredentials(saved ? pair : null);
    assert.equal(renderer.hasApiCredentials(), saved);

    const board = [];
    const status = [];
    const boardSubscription = renderer.boardRequest(renderer.Stream.of(false))
      .subscribe({ next: (request) => board.push(request) });
    const statusSubscription = renderer.summaryRequest()
      .filter((request) => request.category === 'status')
      .subscribe({ next: (request) => status.push(request) });
    t.after(() => {
      boardSubscription.unsubscribe();
      statusSubscription.unsubscribe();
    });

    await Promise.resolve();
    assert.equal(board.length, 1);
    assert.equal(status.length, 1);
    t.mock.timers.tick(60000);
    assert.equal(board.length, 5);
    assert.equal(status.length, 3);
    assert.equal(new Set(status).size, status.length);
    for (const request of [...board, ...status]) {
      assert.equal(await renderer.authorizeRequest(request), request);
      assert.deepEqual({ ...request.headers }, { 'Content-Type': 'application/json' });
      assert.equal('credentialVersion' in request, false);
    }
    assert.equal(signRest.mock.callCount(), 0);
  });
}

for (const [operation, replacement] of [
  ['replacing', { key: 'another-api-key', secret: 'another-api-secret' }],
  ['clearing', null],
]) {
  test(`${operation} credentials stops the remaining TWAP requests`, async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const renderer = createRenderer(new Map());
    await renderer.saveCredentials(pair);
    const buy$ = renderer.Stream.create();
    const state$ = renderer.Stream.of({ size: 0.03, twap: { interval: 1, slices: 3 } });
    const requests = [];
    const listener = { next: (request) => requests.push(request) };
    const requests$ = renderer.twapRequest({
      onTwapStarted$: buy$.map(() => ({ id: Symbol(), side: "BUY" })),
      onClickTwapCancelButton$: renderer.Stream.never(),
    }, state$).requests$;
    requests$.addListener(listener);
    t.after(() => requests$.removeListener(listener));

    buy$.shamefullySendNext(null);
    assert.equal(requests.length, 1);
    assert.equal((await renderer.authorizeRequest(requests[0])).headers['ACCESS-KEY'], pair.key);
    await renderer.saveCredentials(replacement);
    t.mock.timers.tick(3000);
    assert.equal(requests.length, 1);

    if (replacement) {
      buy$.shamefullySendNext(null);
      assert.equal(requests.length, 2);
      assert.equal((await renderer.authorizeRequest(requests[1])).headers['ACCESS-KEY'], replacement.key);
    }
  });
}

test('Electron TWAP readiness controls the buttons and the status explains why TWAP stopped', async () => {
  let available = false;
  const renderer = createRenderer(new Map(), {
    hasCredentials: async () => available,
    save: async (value) => { available = !!value; },
  });
  const state = { size: 0.03, twap: { interval: 1, slices: 3, remaining: 0 } };
  const section = () => renderer.twapSection(state, renderer.hasApiCredentials());
  const chooseButtons = () => section().children[5].children;
  await renderer.initializeCredentials();
  assert.ok(chooseButtons().every((button) => button.data.attrs.disabled));
  await renderer.saveCredentials(pair);
  assert.ok(chooseButtons().every((button) => !button.data.attrs.disabled));

  await renderer.saveCredentials(null);
  state.twap.error = 'TWAP stopped because credentials changed.';
  assert.ok(chooseButtons().every((button) => button.data.attrs.disabled));
  assert.equal(section().children[4].text, state.twap.error);
});

test('a missing Electron signature stops the current TWAP before its next slice', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const renderer = createRenderer(new Map(), {
    hasCredentials: async () => true,
    signRest: async () => null,
  });
  await renderer.initializeCredentials();
  const buy$ = renderer.Stream.create();
  const requests = [];
  const subscription = renderer.twapRequest({
    onTwapStarted$: buy$.map(() => ({ id: Symbol(), side: "BUY" })),
    onClickTwapCancelButton$: renderer.Stream.never(),
  }, renderer.Stream.of({ size: 0.03, twap: { interval: 1, slices: 3 } }))
    .requests$.subscribe({ next: (request) => requests.push(request) });
  t.after(() => subscription.unsubscribe());

  buy$.shamefullySendNext(null);
  assert.equal(await renderer.authorizeRequest(requests[0]), null);
  t.mock.timers.tick(3000);
  assert.equal(requests.length, 1);
});

test('starting, canceling, and failing a TWAP leave another scheduler signing independently', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let finishSigning;
  const headers = { 'ACCESS-KEY': pair.key };
  const renderer = createRenderer(new Map(), {
    hasCredentials: async () => true,
    signRest: () => finishSigning
      ? Promise.resolve(headers)
      : new Promise((resolve) => { finishSigning = resolve; }),
  });
  await renderer.initializeCredentials();

  const scheduler = () => {
    const start$ = renderer.Stream.create();
    const cancel$ = renderer.Stream.create();
    const requests = [];
    const { requests$ } = renderer.twapRequest({
      onTwapStarted$: start$,
      onClickTwapCancelButton$: cancel$,
    }, renderer.Stream.of({ size: 0.03, twap: { interval: 1, slices: 3 } }));
    const subscription = requests$.subscribe({ next: (request) => requests.push(request) });
    t.after(() => subscription.unsubscribe());
    return {
      start: () => start$.shamefullySendNext({ id: Symbol(), side: 'BUY' }),
      cancel: () => cancel$.shamefullySendNext(null),
      requests,
    };
  };

  const first = scheduler();
  const second = scheduler();
  first.start();
  const signing = renderer.authorizeRequest(first.requests[0]);
  await Promise.resolve();
  assert.equal(typeof finishSigning, 'function');

  second.start();
  second.cancel();
  assert.equal(await renderer.authorizeRequest(second.requests[0]), null);
  second.start();
  assert.equal(await renderer.authorizeRequest({ ...second.requests[1], send: {} }), null);

  finishSigning(headers);
  assert.equal((await signing).headers['ACCESS-KEY'], pair.key);
  t.mock.timers.tick(1000);
  assert.equal(first.requests.length, 2);
  assert.equal((await renderer.authorizeRequest(first.requests[1])).headers['ACCESS-KEY'], pair.key);
  assert.equal(second.requests.length, 2);
});

test('TWAP authorization drops requests that overlap an Electron credential update', async () => {
  let finishSigning;
  let finishSaving;
  const headers = { 'ACCESS-KEY': pair.key };
  const renderer = createRenderer(new Map(), {
    signRest: () => finishSigning
      ? Promise.resolve(headers)
      : new Promise((resolve) => { finishSigning = resolve; }),
    save: () => new Promise((resolve) => { finishSaving = resolve; }),
  });
  await renderer.initializeCredentials();
  const request = renderer.twapSliceOrder(0.01, 'BUY', Symbol());
  const signing = renderer.authorizeRequest(request);
  await Promise.resolve();
  const saving = renderer.saveCredentials(pair);
  const duringSave = await renderer.authorizeRequest(request);
  finishSaving();
  await saving;
  finishSigning(headers);
  assert.equal(duringSave, null);
  assert.equal(await signing, null);
});

test('browser private channels authenticate before subscribing', async () => {
  const renderer = createRenderer(new Map());
  let acknowledged = false;
  let acknowledge;
  const socket = {
    id: 'connected',
    connected: true,
    emit(event, params, callback) {
      assert.equal(event, 'auth');
      assert.equal(params.api_key, pair.key);
      assert.match(params.nonce, /^[a-f0-9]{32}$/);
      assert.equal(params.signature, hmac(params.timestamp + params.nonce));
      acknowledge = callback;
    },
  };
  const subscribe = () => { acknowledged = true; };
  await renderer.authenticate(socket, subscribe);
  assert.equal(acknowledge, undefined);
  await renderer.saveCredentials(pair);
  await renderer.authenticate(socket, subscribe);
  assert.equal(acknowledged, false);
  acknowledge(new Error('Rejected'));
  assert.equal(acknowledged, false);
  acknowledge(null);
  assert.equal(acknowledged, true);
});

test('Electron renderer migrates once and delegates both protocol signatures', async (t) => {
  const file = withCredentialFile(t);
  const store = createCredentialStore(file, {
    isEncryptionAvailable: () => true,
    encryptString: () => Buffer.from('mock ciphertext'),
  }, 'darwin');
  const entries = new Map([['api-key', pair.key], ['api-secret', pair.secret]]);
  let migrations = 0;
  const renderer = createRenderer(entries, {
    migrate: async (value) => {
      migrations++;
      assert.deepEqual([...entries.values()], [pair.key, pair.secret]);
      return store.migrate(value);
    },
    signRest: async (...args) => store.signRest(...args),
    signRealtime: async () => store.signRealtime(),
  });
  const [request, auth] = await Promise.all([
    renderer.authorizeRequest(renderer.getPositions()), renderer.signRealtime(),
  ]);
  assert.equal(migrations, 1);
  assert.equal(entries.size, 0);
  assert.equal(request.headers['ACCESS-SIGN'],
    hmac(request.headers['ACCESS-TIMESTAMP'] + 'GET/v1/me/getpositions?product_code=FX_BTC_JPY'));
  assert.equal(auth.signature, hmac(auth.timestamp + auth.nonce));
});

test('Electron signs initial and older execution requests with the full query string', async (t) => {
  const store = createCredentialStore(withCredentialFile(t), {
    isEncryptionAvailable: () => true,
    encryptString: () => Buffer.from('mock ciphertext'),
  }, 'darwin');
  const renderer = createRenderer(new Map(), {
    hasCredentials: async () => store.hasCredentials(),
    save: async (value) => store.save(value),
    signRest: async (...args) => store.signRest(...args),
  });
  await renderer.saveCredentials(pair);

  const firstPagePath = '/v1/me/getexecutions?product_code=FX_BTC_JPY&count=50';
  for (const [cursor, requestPath] of [[undefined, firstPagePath], [12345, `${firstPagePath}&before=12345`]]) {
    const request = await renderer.authorizeRequest(renderer.getExecutions(cursor));
    assert.ok(request, `Expected a signed request for ${requestPath}`);
    assert.equal(request.url, 'https://api.bitflyer.jp' + requestPath);
    assert.equal(request.method, 'GET');
    assert.equal(request.send, '');
    assert.equal(request.headers['ACCESS-KEY'], pair.key);
    assert.equal(request.headers['ACCESS-SIGN'], hmac(request.headers['ACCESS-TIMESTAMP'] + 'GET' + requestPath));
  }
});

test('Electron authorizes a parent order cancellation with the exact request body', async (t) => {
  const store = createCredentialStore(withCredentialFile(t), {
    isEncryptionAvailable: () => true,
    encryptString: () => Buffer.from('mock ciphertext'),
  }, 'darwin');
  store.save(pair);
  const renderer = createRenderer(new Map(), {
    signRest: async (...args) => store.signRest(...args),
  });
  const request = await renderer.authorizeRequest(renderer.cancelParentOrder('JCO-stop'));
  const requestPath = '/v1/me/cancelparentorder?product_code=FX_BTC_JPY';

  assert.ok(request);
  assert.equal(request.url, 'https://api.bitflyer.jp' + requestPath);
  assert.equal(request.method, 'POST');
  assert.deepEqual(JSON.parse(request.send), { parent_order_id: 'JCO-stop', product_code: 'FX_BTC_JPY' });
  assert.equal(request.headers['ACCESS-KEY'], pair.key);
  assert.equal(request.headers['ACCESS-SIGN'],
    hmac(request.headers['ACCESS-TIMESTAMP'] + request.method + requestPath + request.send));
});

const migrationFailures = [
  ['a failed encrypted write', async () => { throw new Error('Could not write encrypted credentials'); }],
  ['unavailable secure storage', async () => false],
];

test('failed migration removes plaintext and persists the reentry prompt until save', async (t) => {
  for (const [name, migrate] of migrationFailures) {
    await t.test(name, () => assertMigrationRequiresReentry(migrate));
  }
});

const assertMigrationRequiresReentry = async (migrate) => {
  const entries = new Map([['api-key', pair.key], ['api-secret', pair.secret]]);
  const renderer = createRenderer(entries, { migrate });
  assert.equal(await renderer.initializeCredentials(), false);
  assert.deepEqual([...entries], [['bitflyer-credentials-reentry-required', 'true']]);

  const restarted = createRenderer(entries, {
    save: async (value) => assert.equal(value.secret, pair.secret),
  });
  assert.equal(await restarted.initializeCredentials(), false);
  const never = () => restarted.Stream.never();
  const settings = restarted.settingsIntent({
    DOM: { select: () => ({ events: never }) },
    storage: { local: { getItem: never } },
  });
  const message = await new Promise((resolve, reject) => {
    settings.credentialsMessage$.take(1).addListener({ next: resolve, error: reject });
  });
  assert.match(message, /Enter your API key and secret/);
  await restarted.saveCredentials(pair);
  assert.equal(await restarted.initializeCredentials(), true);
  assert.equal(entries.size, 0);
  assert.equal(await createRenderer(entries, {}).initializeCredentials(), true);
};

const submitSettingsCredentials = (renderer, credentials) => {
  const submit$ = renderer.Stream.create();
  const never = () => renderer.Stream.never();
  const settings = renderer.settingsIntent({
    DOM: { select: (selector) => ({
      events: (type) => selector === '#credentials-form' && type === 'submit' ? submit$ : never(),
    }) },
    storage: { local: { getItem: never } },
  });
  const message = new Promise((resolve, reject) => {
    settings.credentialsMessage$.take(1).addListener({ next: resolve, error: reject });
  });
  submit$.shamefullySendNext({
    preventDefault() {},
    target: {
      elements: { namedItem: (name) => ({ value: credentials[name] }) },
      reset() {},
    },
  });

  return message;
};

test('Submitting the Settings credentials form makes credentials available', async () => {
  const renderer = createRenderer(new Map());
  assert.equal(renderer.hasApiCredentials(), false);
  assert.equal(await submitSettingsCredentials(renderer, pair), 'Credentials saved.');
  assert.equal(renderer.hasApiCredentials(), true);
  assert.equal((await renderer.signRest('GET', '/v1/me/getpositions', ''))['ACCESS-KEY'], pair.key);
});

test('Settings rejects a blank API key or secret without saving credentials', async (t) => {
  for (const field of ['key', 'secret']) {
    await t.test(`blank ${field}`, async () => {
      const save = t.mock.fn();
      const renderer = createRenderer(new Map(), { save });
      const message = await submitSettingsCredentials(renderer, { ...pair, [field]: '  ' });
      assert.equal(message, 'Enter both an API key and an API secret.');
      assert.equal(save.mock.callCount(), 0);
    });
  }
});

test('Settings reports an OS credential storage failure when saving', async (t) => {
  const save = t.mock.fn(async () => { throw new Error('OS credential storage is unavailable'); });
  const renderer = createRenderer(new Map(), { save });
  const message = await submitSettingsCredentials(renderer, pair);
  assert.equal(message, 'Could not update credentials. Check that OS credential storage is available and try again.');
  assert.equal(save.mock.callCount(), 1);
});

test('Settings shows empty inputs with password masking even after credentials are saved', async () => {
  const renderer = createRenderer(new Map());
  await renderer.saveCredentials(pair);
  const vnode = await new Promise((resolve, reject) => {
    renderer.view(renderer.Stream.of({ credentialsMessage: '', soundEnabled: true })).addListener({
      next: resolve, error: reject,
    });
  });
  const find = (node, selector) =>
    node.sel === selector ? node : node.children?.map((child) => find(child, selector)).find(Boolean);
  const key = find(vnode, 'input#api-key-input');
  const secret = find(vnode, 'input#api-secret-input');
  assert.equal(secret.data.props.type, 'password');
  for (const input of [key, secret]) {
    assert.equal(input.data.props.value, undefined);
    assert.equal(input.data.attrs?.value, undefined);
  }
});

test('Settings shows both account types with their maximum order size and the saved selection', async () => {
  const renderer = createRenderer(new Map());
  const vnode = await new Promise((resolve, reject) => {
    renderer.view(renderer.Stream.of({ credentialsMessage: '', soundEnabled: true, accountType: 'corporate' }))
      .addListener({ next: resolve, error: reject });
  });
  const find = (node, selector) =>
    node.sel === selector ? node : node.children?.map((child) => find(child, selector)).find(Boolean);
  const select = find(vnode, 'select#account-type-input');
  assert.equal(select.data.props.value, 'corporate');
  assert.deepEqual(Array.from(select.children, (option) => option.text), [
    'Individual (max 10 BTC-CFD per order)',
    'Corporate (max 40 BTC-CFD per order)',
  ]);
});

test('Settings loads the saved account type and reports changes, defaulting to individual', async () => {
  const renderer = createRenderer(new Map());
  const changed$ = renderer.Stream.create();
  const settings = renderer.settingsIntent({
    DOM: { select: (selector) => ({
      events: (type) => selector === '#account-type-input' && type === 'change' ? changed$ : renderer.Stream.never(),
    }) },
    storage: { local: { getItem: (key) => renderer.Stream.of(key === 'account-type' ? 'corporate' : null) } },
  });
  const loaded = await new Promise((resolve, reject) => {
    settings.onAccountTypeLoaded$.take(1).addListener({ next: resolve, error: reject });
  });
  assert.equal(loaded, 'corporate');

  const changed = new Promise((resolve, reject) => {
    settings.onAccountTypeChanged$.take(1).addListener({ next: resolve, error: reject });
  });
  changed$.shamefullySendNext({ target: { value: 'not-a-real-account-type' } });
  assert.equal(await changed, 'individual');
});
