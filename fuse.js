const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const stylus = require('stylus');

const stylusPlugin = {
  name: 'stylus',
  setup(build) {
    build.onLoad({ filter: /\.styl$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, 'utf8');
      const css = await new Promise((resolve, reject) => {
        stylus(source)
          .set('filename', args.path)
          .set('compress', true)
          .render((err, css) => err ? reject(err) : resolve(css));
      });
      return { contents: css, loader: 'css' };
    });
  },
};

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'public/index.js',
  sourcemap: true,
  target: ['es2015'],
  platform: 'browser',
  plugins: [stylusPlugin],
}).catch(() => process.exit(1));
