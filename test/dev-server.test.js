const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { networkInterfaces } = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { test } = require('node:test');

test('the development server serves the app only on loopback', { timeout: 15000 }, async (t) => {
  const server = spawn(process.execPath, ['fuse.dev'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const closed = once(server, 'close');
  t.after(async () => {
    server.kill();
    await closed;
  });

  const url = 'http://127.0.0.1:4444';
  assert.equal(await readStartupMessage(server.stdout), `Dev server running at ${url}`);
  const response = await fetch(url, { signal: t.signal });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<script[^>]+src=["'][^"']*index\.js["']/);

  const addresses = Object.values(networkInterfaces()).flat()
    .filter(({ family, internal }) => family === 'IPv4' && !internal);
  await Promise.all(addresses.map(({ address }) => assert.rejects(
    fetch(`http://${address}:4444`, { signal: t.signal }),
    (error) => error.cause?.code === 'ECONNREFUSED',
  )));
});

async function readStartupMessage(stdout) {
  const output = createInterface({ input: stdout });
  for await (const line of output) {
    if (line.startsWith('Dev server running at ')) return line;
  }
  assert.fail('Development server exited before printing its URL');
}
