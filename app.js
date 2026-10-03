import { detectPitch } from './pitch.js';
import { Progresso, STRINGS, Tuner } from './tuner.js';

const ANALYSIS_MS = 40; // ~25 leituras por segundo

const $ = (id) => document.getElementById(id);
const app = $('app');
const notaEl = $('nota');
const cordaEl = $('corda');
const instrucaoEl = $('instrucao');
const ponteiroEl = $('ponteiro');
const inicioEl = $('inicio');
const erroEl = $('erro');
const progressoEl = $('progresso');
const sucessoEl = $('sucesso');
const cordaEls = [...document.querySelectorAll('#cordas li')];

const INSTRUCAO = {
  aperte: 'Aperte ▶',
  afrouxe: '◀ Afrouxe',
  quase: 'Quase…',
  afinado: 'Afinado ✓',
};

const tuner = new Tuner();
const progresso = new Progresso();
let audio = null;       // { ctx, stream, analyser, buf }
let rafId = 0;
let lastAnalysis = 0;
let wakeLock = null;
let retomarAoVoltar = false;

class PrecisaToque extends Error {}

async function start() {
  if (audio) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('sem-suporte');
  }
  // Sem os filtros de voz do Android: eles tratam o som do violão como ruído.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state !== 'running') {
    // Sem um toque do usuário o navegador pode manter o áudio suspenso;
    // resume() nesse caso fica pendente, por isso o limite de tempo.
    await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
    if (ctx.state !== 'running') {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      throw new PrecisaToque();
    }
  }

  const source = ctx.createMediaStreamSource(stream);
  // Passa-baixas: corta o ruído agudo, que atrapalha a leitura das cordas graves.
  const filtro = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1000 });
  const analyser = new AnalyserNode(ctx, { fftSize: 4096 });
  source.connect(filtro).connect(analyser);

  audio = { ctx, stream, analyser, buf: new Float32Array(analyser.fftSize) };
  inicioEl.hidden = true;
  pedirTelaLigada();
  rafId = requestAnimationFrame(loop);
}

function stop() {
  if (!audio) return;
  cancelAnimationFrame(rafId);
  audio.stream.getTracks().forEach((t) => t.stop());
  audio.ctx.close();
  audio = null;
  tuner.reset();
  render(tuner.snapshot(performance.now()));
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function loop(now) {
  rafId = requestAnimationFrame(loop);
  if (now - lastAnalysis < ANALYSIS_MS) return;
  lastAnalysis = now;
  audio.analyser.getFloatTimeDomainData(audio.buf);
  const r = detectPitch(audio.buf, audio.ctx.sampleRate);
  const leitura = tuner.push(r ? r.freq : null, now);
  render(leitura);

  const { cordaAfinada, violaoAfinado } = progresso.update(leitura, now);
  if (cordaAfinada) navigator.vibrate?.(80);
  if (violaoAfinado) comemorar();
  renderProgresso();
}

function renderProgresso() {
  const n = progresso.afinadas.size;
  cordaEls.forEach((li) => li.classList.toggle('feita', progresso.afinadas.has(Number(li.dataset.num))));
  progressoEl.textContent = n ? `${n} de ${STRINGS.length} cordas afinadas` : ' ';
}

function comemorar() {
  sucessoEl.hidden = false;
  navigator.vibrate?.([120, 80, 120, 80, 250]);
  tocarAcorde();
}

/** Arpejo curto de Mi maior: um "pronto!" para quem está olhando o violão, não a tela. */
function tocarAcorde() {
  const ctx = audio?.ctx;
  if (!ctx) return;
  [329.63, 415.3, 493.88, 659.25].forEach((freq, i) => {
    const inicio = ctx.currentTime + i * 0.12;
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: freq });
    const volume = new GainNode(ctx, { gain: 0 });
    volume.gain.setValueAtTime(0, inicio);
    volume.gain.linearRampToValueAtTime(0.18, inicio + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.001, inicio + 0.9);
    osc.connect(volume).connect(ctx.destination);
    osc.start(inicio);
    osc.stop(inicio + 1);
  });
}

function render({ state, string, cents, stale }) {
  app.className = state + (stale ? ' esmaecido' : '');
  if (!string) {
    notaEl.textContent = '–';
    cordaEl.textContent = 'Toque uma corda';
    instrucaoEl.innerHTML = '&nbsp;';
    ponteiroEl.style.setProperty('--desvio', 0);
    cordaEls.forEach((li) => li.classList.remove('ativa'));
    return;
  }
  notaEl.textContent = string.note;
  cordaEl.textContent = `${string.num}ª corda · ${string.name}`;
  instrucaoEl.textContent = INSTRUCAO[state];
  ponteiroEl.style.setProperty('--desvio', Math.max(-50, Math.min(50, cents)).toFixed(1));
  cordaEls.forEach((li) => li.classList.toggle('ativa', Number(li.dataset.num) === string.num));
}

async function pedirTelaLigada() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch { /* economia de bateria ou sem suporte: segue sem */ }
}

function mostrarInicio(erro) {
  inicioEl.hidden = false;
  erroEl.hidden = !erro;
  if (erro) erroEl.textContent = erro;
}

function mensagemDeErro(e) {
  if (e instanceof PrecisaToque) return '';
  if (e.message === 'sem-suporte') {
    return 'Este navegador não liberou o microfone. Abra o Afinador no Chrome, pelo endereço que começa com https://';
  }
  if (e.name === 'NotAllowedError') {
    return 'O Afinador precisa do microfone. Toque no cadeado ao lado do endereço (ou segure o ícone do app → Informações do app → Permissões) e permita o Microfone.';
  }
  if (e.name === 'NotFoundError') return 'Nenhum microfone encontrado neste aparelho.';
  return 'Não foi possível usar o microfone. Feche outros apps que estejam usando o microfone e tente de novo.';
}

async function tentarIniciar() {
  try {
    await start();
  } catch (e) {
    mostrarInicio(mensagemDeErro(e));
  }
}

$('comecar').addEventListener('click', tentarIniciar);
$('de-novo').addEventListener('click', () => {
  progresso.reset();
  tuner.reset();
  sucessoEl.hidden = true;
  renderProgresso();
});

// Ao sair do app, desliga o microfone; ao voltar, religa.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    retomarAoVoltar = !!audio;
    stop();
  } else if (retomarAoVoltar) {
    tentarIniciar();
  }
});

// Se o microfone já foi permitido antes, começa direto, sem o botão.
(async () => {
  try {
    const p = await navigator.permissions?.query({ name: 'microphone' });
    if (p?.state === 'granted') await tentarIniciar();
  } catch { /* navegador sem Permissions API: fica no botão */ }
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
