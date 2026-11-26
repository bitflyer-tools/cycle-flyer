const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

// The runAsNode/NODE_OPTIONS/CLI-inspect fuses this test guards against are exactly the
// surfaces that would otherwise let Chrome DevTools or the Node inspector attach to the
// packaged app, so this harness can no longer drive the renderer over the inspector
// protocol without reopening the hole it is meant to verify is closed. It only observes
// the packaged executable from the outside: whether it keeps running as the normal app,
// and whether any of the disabled flags/env vars still take effect.

const withProfile = async (run) => {
  const profile = mkdtempSync(join(process.cwd(), 'out', 'renderer-test-'));
  try {
    await run(profile);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
};

const isRunning = (app) => {
  try {
    process.kill(app.pid, 0);
    return true;
  } catch {
    return false;
  }
};

const launch = (executable, args, env) => {
  const app = spawn(executable, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  app.stderr.on('data', (chunk) => { stderr += chunk; });
  return { app, stderr: () => stderr };
};

const stop = async (app) => {
  if (isRunning(app)) app.kill();
  await once(app, 'exit').catch(() => {});
};

const expectAppKeepsRunning = async (executable, args, env, description) => {
  const { app, stderr } = launch(executable, args, env);
  try {
    await delay(5000);
    assert.equal(isRunning(app), true, `${description}: the packaged app should still be running, not have exited`);
    return stderr();
  } finally {
    await stop(app);
  }
};

const main = async (executable) => {
  assert.ok(executable, 'Pass the packaged Electron executable as an argument');

  await withProfile(async (profile) => {
    await expectAppKeepsRunning(executable, ['--user-data-dir=' + profile], {}, 'a normal launch');
  });

  await withProfile(async (profile) => {
    const marker = join(profile, 'run-as-node.marker');
    const script = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'pwned')`;
    // The real attack passes the eval flag before any other argument; a flag Electron itself
    // would understand (such as --user-data-dir) is appended afterwards only so a correctly
    // fused build, which ignores ELECTRON_RUN_AS_NODE and -e, still launches in an isolated profile.
    await expectAppKeepsRunning(executable, ['-e', script, '--user-data-dir=' + profile],
      { ELECTRON_RUN_AS_NODE: '1' }, 'ELECTRON_RUN_AS_NODE=1');
    assert.equal(existsSync(marker), false,
      'ELECTRON_RUN_AS_NODE must not let the packaged executable run arbitrary Node code');
  });

  await withProfile(async (profile) => {
    const missingModule = join(profile, 'nonexistent-cycle-flyer-module.js');
    const stderr = await expectAppKeepsRunning(executable, ['--user-data-dir=' + profile],
      { NODE_OPTIONS: '--require ' + missingModule }, 'NODE_OPTIONS');
    assert.doesNotMatch(stderr, /Cannot find module/,
      'NODE_OPTIONS must not be honored by the packaged executable');
  });

  await withProfile(async (profile) => {
    const stderr = await expectAppKeepsRunning(executable,
      ['--inspect=127.0.0.1:0', '--user-data-dir=' + profile], {}, '--inspect');
    assert.doesNotMatch(stderr, /Debugger listening on/,
      'The Node/Chrome DevTools inspector must never attach to the packaged executable');
  });

  console.log('Packaged executable ignores ELECTRON_RUN_AS_NODE, NODE_OPTIONS, and the Node CLI inspect flags.');
};

main(process.argv[2]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
