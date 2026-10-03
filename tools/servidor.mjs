// Servidor local para testar no computador: npm run serve → http://localhost:8080
// (localhost conta como "seguro", então o microfone funciona sem https)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const porta = Number(process.env.PORT) || 8080;
const tipos = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  let caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (caminho.endsWith('/')) caminho += 'index.html';
  const arquivo = normalize(join(raiz, caminho));
  if (!arquivo.startsWith(raiz)) return res.writeHead(403).end();
  try {
    const corpo = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': tipos[extname(arquivo)] ?? 'application/octet-stream' }).end(corpo);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
}).listen(porta, () => console.log(`Afinador em http://localhost:${porta}`));
