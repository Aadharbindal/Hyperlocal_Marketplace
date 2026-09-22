// Bundles the API into dist/server.js. Workspace packages (@hyperlocal/*) are inlined; other
// node_modules stay external so the Docker image installs them normally.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  plugins: [
    {
      name: 'externalize-node-modules',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@hyperlocal/')) return null;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
console.log('built dist/server.js');
