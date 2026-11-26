const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');

const configPath = path.join(__dirname, '../forge.config.js');
const source = readFileSync(configPath, 'utf8');

function loadConfig() {
  const FuseV1Options = {
    RunAsNode: 'RunAsNode',
    EnableCookieEncryption: 'EnableCookieEncryption',
    EnableNodeOptionsEnvironmentVariable: 'EnableNodeOptionsEnvironmentVariable',
    EnableNodeCliInspectArguments: 'EnableNodeCliInspectArguments',
    EnableEmbeddedAsarIntegrityValidation: 'EnableEmbeddedAsarIntegrityValidation',
    OnlyLoadAppFromAsar: 'OnlyLoadAppFromAsar',
  };
  const FuseVersion = { V1: 'V1' };
  class FusesPlugin {
    constructor(config) {
      this.config = config;
    }
  }
  const stubRequire = (name) => {
    if (name === '@electron/fuses') return { FuseV1Options, FuseVersion };
    if (name === '@electron-forge/plugin-fuses') return { FusesPlugin };
    return require(name);
  };
  const module = { exports: {} };
  compileFunction(source, ['require', 'module'])(stubRequire, module);
  return { config: module.exports, FuseV1Options, FuseVersion, FusesPlugin };
}

test('keeps the existing packager and maker configuration', () => {
  const { config } = loadConfig();
  assert.deepEqual(config.packagerConfig, {
    asar: true,
    icon: 'public/appIcon',
    name: 'Cycle Flyer',
    executableName: 'cycle-flyer',
  });
  assert.deepEqual(config.makers.map(({ name }) => name), [
    '@electron-forge/maker-squirrel',
    '@electron-forge/maker-zip',
    '@electron-forge/maker-deb',
    '@electron-forge/maker-rpm',
  ]);
});

test('disables the runAsNode, Node CLI inspect, and NODE_OPTIONS fuses and loads only from the asar', () => {
  const { config, FuseV1Options, FusesPlugin } = loadConfig();
  const [fuses] = config.plugins;
  assert.ok(fuses instanceof FusesPlugin);
  assert.equal(fuses.config[FuseV1Options.RunAsNode], false);
  assert.equal(fuses.config[FuseV1Options.EnableNodeOptionsEnvironmentVariable], false);
  assert.equal(fuses.config[FuseV1Options.EnableNodeCliInspectArguments], false);
  assert.equal(fuses.config[FuseV1Options.OnlyLoadAppFromAsar], true);
});
