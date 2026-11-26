const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: 'public/appIcon',
    name: 'Cycle Flyer',
    executableName: 'cycle-flyer',
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'cycle_flyer',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
