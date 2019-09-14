const { CSSPlugin, FuseBox, StylusPlugin } = require('fuse-box');

const fuse = FuseBox.init({
  homeDir: 'src',
  output: 'public/$name.js',
  target: "browser",
  sourceMaps: { project: true, vendor: true },
  plugins: [
    [
      StylusPlugin({ compress: true }),
      CSSPlugin({
        group: "main.css",
        outFile: "public/main.css",
        inject: false
      })
    ]
  ]
});

fuse.bundle('index').instructions('> index.ts');
fuse.run();
