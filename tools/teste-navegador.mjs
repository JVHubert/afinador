// Teste ponta a ponta: abre o app no Chrome com um "microfone falso" tocando
// cordas gravadas em WAV e confere o que aparece na tela.
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
const TAXA = 48000;
const pasta = await mkdtemp(join(tmpdir(), 'afinador-'));

const VIOLAO = [0.4, 1, 0.6, 0.4, 0.25, 0.15];
// Mi grave captado por microfone de celular: harmônicos ímpares fracos e graves
// cortados. Era isso que fazia o app mostrar "Ré, afrouxe" no Mi grave.
const MI_GRAVE_CELULAR = { harm: [1, 1, 0.05, 1, 0.05, 0.7, 0.05, 0.5], passaAltas: 200 };

function passaAltas(x, fc) {
  const w = 2 * Math.PI * fc / TAXA, alpha = Math.sin(w) / Math.SQRT2, cos = Math.cos(w);
  const b0 = (1 + cos) / 2, b1 = -(1 + cos), b2 = b0, a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x.map((v) => {
    const y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    return y;
  });
}

/**
 * WAV mono 16 bits a partir de trechos: { freq, segundos, harm?, passaAltas? }.
 * freq null = silêncio. Cada nota decai como uma corda palhetada.
 */
function wav(trechos) {
  const partes = trechos.map(({ freq, segundos, harm = VIOLAO, passaAltas: hp }) => {
    let x = new Float32Array(Math.round(segundos * TAXA));
    for (let i = 0; i < x.length && freq; i++) {
      const t = i / TAXA;
      let v = 0;
      harm.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * freq * (k + 1) * t + k); });
      x[i] = 0.3 * Math.exp(-t / 2.5) * v / harm.length;
    }
    if (hp) x = passaAltas(passaAltas(x, hp), hp);
    return x.map((v) => v + 0.003 * (Math.random() * 2 - 1));
  });
  const n = partes.reduce((s, p) => s + p.length, 0);
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(TAXA, 24); data.writeUInt32LE(TAXA * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  let i = 0;
  for (const p of partes) for (const v of p) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + 2 * i++);
  return data;
}

async function abrir(nome, trechos) {
  const arquivo = join(pasta, `${nome}.wav`);
  await writeFile(arquivo, wav(trechos));
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
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 860, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(`http://localhost:${PORTA}/`);
  if (await page.$eval('#inicio', (el) => !el.hidden)) await page.click('#comecar');
  return { browser, page };
}

const lerTela = (page) => page.evaluate(() => ({
  classe: document.getElementById('app').className,
  nota: document.getElementById('nota').textContent,
  corda: document.getElementById('corda').textContent,
  instrucao: document.getElementById('instrucao').textContent,
  desvio: Number(document.getElementById('ponteiro').style.getPropertyValue('--desvio')),
  ativa: document.querySelector('#cordas li.ativa')?.dataset.num,
  progresso: document.getElementById('progresso').textContent,
  sucesso: !document.getElementById('sucesso').hidden,
}));

/** Uma corda tocando sem parar; confere a leitura depois de 2,5 s. */
async function caso(nome, freq, esperado, timbre = {}) {
  const { browser, page } = await abrir(nome, [{ freq, segundos: 4, ...timbre }]);
  try {
    await new Promise((r) => setTimeout(r, 2500));
    const tela = await lerTela(page);
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

/** As 6 cordas afinadas uma depois da outra → tela "Violão afinado!". */
async function sessaoCompleta() {
  const trechos = STRINGS.flatMap((s) => [{ freq: s.freq, segundos: 1.6 }, { freq: null, segundos: 0.5 }]);
  const { browser, page } = await abrir('sessao-completa', trechos);
  try {
    const progressos = new Set();
    let tela;
    for (let ms = 0; ms < 20000; ms += 250) {
      await new Promise((r) => setTimeout(r, 250));
      tela = await lerTela(page);
      if (tela.progresso.trim()) progressos.add(tela.progresso);
      if (tela.sucesso) break;
    }
    await new Promise((r) => setTimeout(r, 1000)); // fim da animação
    await page.screenshot({ path: join(pasta, 'sessao-completa.png') });
    const ok = tela.sucesso && progressos.has('1 de 6 cordas afinadas') && progressos.has('5 de 6 cordas afinadas');
    console.log(`${ok ? '✔' : '✘'} sessão completa:`, [...progressos].join(' → '), '| sucesso:', tela.sucesso);

    await page.click('#de-novo');
    const depois = await lerTela(page);
    const okReset = !depois.sucesso && !depois.progresso.trim();
    console.log(`${okReset ? '✔' : '✘'} "Afinar de novo" zera o progresso`);
    return ok && okReset;
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
  resultados.push(await caso('mi-grave-celular-15', at(E2, -15), { estado: 'aperte', nota: 'E', num: 6, cents: -15 }, MI_GRAVE_CELULAR));
  resultados.push(await sessaoCompleta());
} finally {
  servidor.kill();
}
console.log(`Capturas de tela em ${pasta}`);
process.exit(resultados.every(Boolean) ? 0 : 1);
