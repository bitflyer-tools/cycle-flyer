const { FuseBox } = require("fuse-box");
const fuse = FuseBox.init({
  homeDir: "src",
  output: "dist/$name.js",
  target: "browser"
});

fuse.bundle("index").instructions("> index.ts").watch().hmr();
fuse.dev({ root: "./" });
fuse.run();
