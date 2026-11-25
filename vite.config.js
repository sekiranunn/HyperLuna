import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import {existsSync, readFileSync} from 'node:fs';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.json': 'application/json; charset=utf-8'
};

function serveOfficialAssets() {
  return {
    name: 'serve-official-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0];
        if (!/^\/(?:favicon\.ico|(?:img|fonts|css|js|pdf)\/[^/]+)$/.test(pathname)) return next();
        const candidate = resolve(root, 'official', pathname.slice(1));
        if (!existsSync(candidate)) return next();
        let data = readFileSync(candidate);
        if (pathname.endsWith('.css')) {
          data = Buffer.from(data.toString('utf8').replaceAll('/fonts/', '../fonts/'));
        }
        res.setHeader('Content-Type', MIME[extname(candidate)] || 'application/octet-stream');
        res.end(data);
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [vue(), serveOfficialAssets()],
  build: {
    outDir: '.vite-dist',
    emptyOutDir: true,
    assetsDir: 'assets'
  }
});
