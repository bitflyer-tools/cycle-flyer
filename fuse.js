const { FuseBox } = require('fuse-box');

const fuse = FuseBox.init({
  homeDir: 'src',
  output: 'dist/$name.js',
  target: "browser",
  sourceMaps: { project: true, vendor: true },
  plugins: []
});

fuse.bundle('index').instructions('> index.ts');
fuse.run();
