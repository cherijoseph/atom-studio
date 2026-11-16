import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const files = [
  ['index.html', 'text/html'],
  ['style.css', 'text/css'],
  ['app.js', 'text/javascript'],
];
const assets = new Map();

try {
  for (const [name, type] of files) {
    const body = await readFile(new URL(`./dist/${name}`, import.meta.url));
    assets.set(`/${name}`, { type, body });
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.error('Build the app with pnpm build before starting the server.');
  process.exit(1);
}

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 5200);
const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const [path] = request.url.split('?');
  const asset = assets.get(path === '/' ? '/index.html' : path);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(200, {
    'Content-Type': `${asset.type}; charset=utf-8`,
    'Content-Length': asset.body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : asset.body);
});

server.listen(port, host, () => {
  console.log(`Atom Studio is running at http://${host}:${server.address().port}/`);
});
