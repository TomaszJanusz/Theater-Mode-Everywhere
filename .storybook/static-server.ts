import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const STATIC_DIR = resolve(import.meta.dirname, '../output/storybook-static');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff'
};

export async function serveStorybook(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'https://localhost').pathname));
    const file = join(STATIC_DIR, path);
    if (!file.startsWith(STATIC_DIR)) {
      response.writeHead(403).end();
      return;
    }
    readFile(file).then(body => {
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    }, () => response.writeHead(404).end());
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Static server did not bind a port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise(done => { server.closeAllConnections(); server.close(() => done()); }) };
}

