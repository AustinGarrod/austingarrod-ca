// Local-only static server for regression checks against the assembled artifact.
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.gz': 'application/gzip', '.wasm': 'application/wasm' };
createServer((request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    let file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(resolve(root) + sep) && file !== resolve(root)) throw new Error('Invalid path');
    if (statSync(file).isDirectory()) file = resolve(file, 'index.html');
    const bytes = readFileSync(file);
    const headers = { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' };
    // Optional faithful Apache header simulation for camera/WASM checks; never enabled by ordinary CI serving.
    if (process.env.POKEDEX_SCANNER_HEADERS === '1') {
      const headerPath = url.pathname.startsWith('/utilities/pokemon-binder/') ? 'utilities/pokemon-binder/.htaccess'
        : url.pathname.startsWith('/utilities/pokedex-binder/') ? 'utilities/pokedex-binder/.htaccess' : '.htaccess';
      const config = readFileSync(resolve(root, headerPath), 'utf8');
      for (const name of ['Content-Security-Policy', 'Permissions-Policy']) {
        const value = config.match(new RegExp(`Header set ${name} "([^"]+)"`))?.[1];
        if (value) headers[name] = value;
      }
    }
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
}).listen(Number(process.env.PORT || 4321), '127.0.0.1', () => console.log('Assembled site: http://127.0.0.1:' + (process.env.PORT || 4321)));
