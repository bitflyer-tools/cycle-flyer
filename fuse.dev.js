const esbuild = require('esbuild');
const fs = require('fs');
const http = require('http');
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
          .set('compress', false)
          .render((err, css) => err ? reject(err) : resolve(css));
      });
      return { contents: css, loader: 'css' };
    });
  },
};

const startDevServer = async () => {
  const ctx = await esbuild.context({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'public/index.js',
    sourcemap: true,
    target: ['es2015'],
    platform: 'browser',
    plugins: [stylusPlugin],
  });

  await ctx.watch();
  console.log('Watching for changes...');

  const { host, port } = await ctx.serve({
    servedir: 'public',
    port: 4444,
    fallback: 'public/index.html',
  });

  console.log(`Dev server running at http://localhost:${port}`);
};

startDevServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
