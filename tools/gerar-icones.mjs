// Gera os PNGs do app a partir de icons/icon.svg.  Uso: npm run icons
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const raiz = new URL('../icons/', import.meta.url);
const svg = await readFile(new URL('icon.svg', raiz));

for (const tamanho of [192, 512]) {
  await sharp(svg).resize(tamanho, tamanho).png().toFile(fileURLToPath(new URL(`icon-${tamanho}.png`, raiz)));
}

// Maskable: o Android recorta o ícone (círculo, gota...). O desenho fica nos
// 70% centrais, sobre fundo cheio, para nada ser cortado.
const miolo = await sharp(svg).resize(358, 358).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0f1115' } })
  .composite([{ input: miolo, gravity: 'center' }])
  .png()
  .toFile(fileURLToPath(new URL('icon-maskable-512.png', raiz)));

console.log('Ícones gerados em icons/');
