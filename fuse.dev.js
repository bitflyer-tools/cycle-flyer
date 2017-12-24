const { CSSPlugin, FuseBox, StylusPlugin } = require("fuse-box");
const fuse = FuseBox.init({
  homeDir: "src",
  output: "dist/$name.js",
  target: "browser",
  sourceMaps: { project: true, vendor: true },
  plugins: [
    [
      StylusPlugin({ compress: true }),
      CSSPlugin({
        group: "main.css",
        outFile: "dist/main.css",
        inject: false
      })
    ]
  ]
});

fuse.bundle("index").instructions("> index.ts").watch().hmr();
fuse.dev({
  root: "./",
  proxy: {
    '**': {
      target: 'http://localhost:4444',
      pathRewrite: { "^/.*": "" }
    }
  }
});
fuse.run();
