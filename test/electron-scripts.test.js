const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

const { scripts } = require('../package.json');

function runWithBuild(test, script, build, initialBundle, scriptArgs = []) {
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
  if (initialBundle !== undefined) writeFileSync(join(cwd, 'renderer.js'), initialBundle);
  writeFileSync(join(cwd, 'build.js'), build);
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({
    scripts: { [script]: scripts[script], build: 'node build.js' },
  }));
  const result = spawnSync('npm', ['run', script, ...scriptArgs], {
    cwd, encoding: 'utf8', shell: process.platform === 'win32',
  });
  assert.ifError(result.error);
  return { result, launch: join(cwd, 'launch.json') };
}

const build = "require('node:fs').writeFileSync('renderer.js', 'current')";
const forgeCommands = {
  'start:electron': ['start'],
  package: ['package'],
  make: ['make'],
};

test('start:electron enables main-process debugging on request', (t) => {
  const { result, launch } = runWithBuild(t, 'start:electron', build, 'stale', ['--', '--inspect-electron']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(launch, 'utf8')), {
    bundle: 'current',
    args: ['start', '--inspect-electron'],
  });
});

Object.entries(forgeCommands).forEach(([script, args]) => {
  test(`${script} builds the renderer before invoking Forge`, (t) => {
    const { result, launch } = runWithBuild(t, script, build);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(launch, 'utf8')), { bundle: 'current', args });
  });

  test(`${script} replaces stale renderer assets before invoking Forge`, (t) => {
    const { result, launch } = runWithBuild(t, script, build, 'stale');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(launch, 'utf8')), { bundle: 'current', args });
  });

  test(`${script} skips Forge when the renderer build fails`, (t) => {
    const { result, launch } = runWithBuild(t, script, 'process.exit(1)', 'stale');
    assert.equal(result.status, 1, result.stderr);
    assert.throws(() => readFileSync(launch), { code: 'ENOENT' });
  });
});
