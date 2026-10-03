// Teste ponta a ponta: abre o app no Chrome com um "microfone falso" tocando
// uma corda gravada em WAV e confere o que aparece na tela.
// Uso: npm run test:browser   (CHROME=<caminho do executável> para outro navegador)
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { STRINGS } from '../tuner.js';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORTA = 8765;
const pasta = await mkdtemp(join(tmpdir(), 'afinador-'));

/** WAV mono 16 bits de uma "corda" (harmônicos + ruído leve). */
function wav(freq, segundos = 4, sampleRate = 48000) {
  const n = segundos * sampleRate;
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  const harm = [0.4, 1, 0.6, 0.4, 0.25, 0.15];
  for (let i = 0; i < n; i++) {
    let v = 0;
    harm.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * freq * (k + 1) * i / sampleRate + k); });
    v = 0.25 * v / harm.length + 0.003 * (Math.random() * 2 - 1);
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return data;
}

async function caso(nome, freq, esperado) {
  const arquivo = join(pasta, `${nome}.wav`);
  await writeFile(arquivo, wav(freq));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${arquivo}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 860, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(`http://localhost:${PORTA}/`);
    const inicioVisivel = await page.$eval('#inicio', (el) => !el.hidden);
    if (inicioVisivel) await page.click('#comecar');
    await new Promise((r) => setTimeout(r, 2500));
    const tela = await page.evaluate(() => ({
      classe: document.getElementById('app').className,
      nota: document.getElementById('nota').textContent,
      corda: document.getElementById('corda').textContent,
      instrucao: document.getElementById('instrucao').textContent,
      desvio: Number(document.getElementById('ponteiro').style.getPropertyValue('--desvio')),
      ativa: document.querySelector('#cordas li.ativa')?.dataset.num,
    }));
    await page.screenshot({ path: join(pasta, `${nome}.png`) });
    const ok = tela.classe.split(' ')[0] === esperado.estado &&
      tela.nota === esperado.nota && tela.ativa === String(esperado.num) &&
      Math.abs(tela.desvio - esperado.cents) <= 3;
    console.log(`${ok ? '✔' : '✘'} ${nome}:`, JSON.stringify(tela));
    return ok;
  } finally {
    await browser.close();
  }
}

const servidor = spawn(process.execPath, [fileURLToPath(new URL('servidor.mjs', import.meta.url))], {
  env: { ...process.env, PORT: String(PORTA) },
});
await new Promise((r) => servidor.stdout.once('data', r));

const [E2, A2, D3, , B3, E4] = STRINGS;
const at = (s, c) => s.freq * 2 ** (c / 1200);
const resultados = [];
try {
  resultados.push(await caso('la-grave-20', at(A2, -20), { estado: 'aperte', nota: 'A', num: 5, cents: -20 }));
  resultados.push(await caso('si-agudo+30', at(B3, 30), { estado: 'afrouxe', nota: 'B', num: 2, cents: 30 }));
  resultados.push(await caso('re-afinado', at(D3, 1), { estado: 'afinado', nota: 'D', num: 4, cents: 1 }));
  resultados.push(await caso('mi-grave-8', at(E2, -8), { estado: 'aperte', nota: 'E', num: 6, cents: -8 }));
  resultados.push(await caso('mi-agudo+12', at(E4, 12), { estado: 'afrouxe', nota: 'E', num: 1, cents: 12 }));
} finally {
  servidor.kill();
}
console.log(`Capturas de tela em ${pasta}`);
process.exit(resultados.every(Boolean) ? 0 : 1);
