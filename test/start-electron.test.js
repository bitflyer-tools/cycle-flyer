const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

const startElectron = require('../package.json').scripts['start:electron'];

function startWithBuild(test, build) {
  const cwd = mkdtempSync(join(tmpdir(), 'cycle-flyer-'));
  test.after(() => rmSync(cwd, { recursive: true, force: true }));
  const bin = join(cwd, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'electron-forge'), '#!/bin/sh\nnode forge.js "$@"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'electron-forge.cmd'), '@node forge.js %*\r\n');
  writeFileSync(join(cwd, 'forge.js'), `
    const fs = require('node:fs');
    fs.writeFileSync('launch.json', JSON.stringify({
      bundle: fs.readFileSync('renderer.js', 'utf8'),
      args: process.argv.slice(2),
    }));
  `);
  writeFileSync(join(cwd, 'renderer.js'), 'stale');
  writeFileSync(join(cwd, 'build.js'), build);
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({
    scripts: { 'start:electron': startElectron, build: 'node build.js' },
  }));
  const result = spawnSync('npm', ['run', 'start:electron'], {
    cwd, encoding: 'utf8', shell: process.platform === 'win32',
  });
  assert.ifError(result.error);
  return { result, launch: join(cwd, 'launch.json') };
}

test('Electron Forge starts with the rebuilt renderer', (t) => {
  const build = "require('node:fs').writeFileSync('renderer.js', 'current')";
  const { result, launch } = startWithBuild(t, build);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(launch, 'utf8')), {
    bundle: 'current',
    args: ['start', '--inspect-electron'],
  });
});

test('Electron Forge does not start when the renderer build fails', (t) => {
  const { result, launch } = startWithBuild(t, 'process.exit(1)');
  assert.equal(result.status, 1, result.stderr);
  assert.throws(() => readFileSync(launch), { code: 'ENOENT' });
});
