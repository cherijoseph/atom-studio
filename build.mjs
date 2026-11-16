import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('./', import.meta.url));
const output = join(root, 'dist');

await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['app-source.js'],
  outfile: join(output, 'app.js'),
  bundle: true,
  format: 'esm',
  minify: true,
});
await Promise.all([
  copyFile(join(root, 'index.html'), join(output, 'index.html')),
  copyFile(join(root, 'style.css'), join(output, 'style.css')),
]);
