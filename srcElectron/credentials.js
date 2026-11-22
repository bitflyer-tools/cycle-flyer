const { createHmac, randomBytes, randomUUID } = require('node:crypto');
const { existsSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs');

const restPaths = {
  GET: new Set(['getcollateral', 'getpositions', 'getexecutions', 'getchildorders', 'getparentorders', 'getparentorder']),
  POST: new Set(['sendchildorder', 'sendparentorder', 'cancelallchildorders', 'cancelparentorder']),
};

const createCredentialStore = (file, safeStorage, platform = process.platform) => {
  let credentials;

  const secureStorageAvailable = () => safeStorage.isEncryptionAvailable() &&
    (platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');

  const requireSecureStorage = () => {
    if (!secureStorageAvailable()) {
      throw new Error('OS credential storage is unavailable.');
    }
  };

  const load = () => {
    if (credentials === undefined) {
      if (!existsSync(file)) {
        credentials = null;
      } else {
        requireSecureStorage();
        credentials = JSON.parse(safeStorage.decryptString(readFileSync(file)));
      }
    }
    return credentials;
  };

  const save = (value) => {
    if (value === null) {
      rmSync(file, { force: true });
      credentials = null;
      return;
    }

    const { key, secret } = value || {};
    if (typeof key !== 'string' || !key || typeof secret !== 'string' || !secret) {
      throw new Error('An API key and secret are required.');
    }

    requireSecureStorage();
    const encrypted = safeStorage.encryptString(JSON.stringify({ key, secret }));
    const temporary = file + '.' + randomUUID();
    try {
      writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
      credentials = { key, secret };
    } finally {
      rmSync(temporary, { force: true });
    }
  };

  const migrate = (pair) => {
    if (!secureStorageAvailable()) return false;
    if (!load()) save(pair);
    return true;
  };

  const signature = (secret, message) => createHmac('sha256', secret).update(message).digest('hex');

  const signRest = (method, path, body) => {
    const endpoint = typeof path === 'string' && /^\/v1\/me\/([a-z]+)(?:\?[^#\r\n]*)?$/.exec(path);
    if ((method !== 'GET' && method !== 'POST') || !endpoint ||
        !restPaths[method].has(endpoint[1]) || typeof body !== 'string' || (method === 'GET' && body)) {
      throw new Error('Invalid bitFlyer request.');
    }
    const pair = load();
    if (!pair) return null;
    const timestamp = Date.now().toString();
    return {
      'ACCESS-KEY': pair.key,
      'ACCESS-SIGN': signature(pair.secret, timestamp + method + path + body),
      'ACCESS-TIMESTAMP': timestamp,
    };
  };

  const signRealtime = () => {
    const pair = load();
    if (!pair) return null;
    const timestamp = Date.now();
    const nonce = randomBytes(16).toString('hex');
    return { api_key: pair.key, nonce, signature: signature(pair.secret, `${timestamp}${nonce}`), timestamp };
  };

  return { hasCredentials: () => !!load(), migrate, save, signRest, signRealtime };
};

module.exports = { createCredentialStore };
