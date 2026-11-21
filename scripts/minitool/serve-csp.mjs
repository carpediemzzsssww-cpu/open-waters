import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const prefix = '/nested/app/';
const mime = {'.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css', '.webp':'image/webp', '.json':'application/json'};
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export function serve(root = 'dist-minitool', port = 0) {
  const directory = path.resolve(root);
  const server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') { res.writeHead(302, {Location:prefix}); return res.end(); }
      const file = path.resolve(directory, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html');
      if (!url.pathname.startsWith(prefix) || !file.startsWith(directory + path.sep)) {res.writeHead(404); return res.end();}
      const bytes = await readFile(file);
      res.writeHead(200, {'Content-Security-Policy':csp, 'Content-Type':mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'});
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(port, '127.0.0.1', () => {
      const url = 'http://127.0.0.1:' + server.address().port + prefix;
      resolve({url, server});
    });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const {url} = await serve(process.argv[2], Number(process.argv[3] || 5196));
  console.log('Strict CSP preview', url);
}
