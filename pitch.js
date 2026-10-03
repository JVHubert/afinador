// Detecção de frequência fundamental pelo algoritmo YIN
// (de Cheveigné & Kawahara, 2002). Módulo puro: roda no navegador e no Node.

/**
 * @param {Float32Array} buf  amostras no domínio do tempo (-1..1)
 * @param {number} sampleRate taxa de amostragem em Hz
 * @returns {{freq: number, clarity: number} | null} null = silêncio ou som sem altura definida
 */
export function detectPitch(buf, sampleRate, {
  minFreq = 70,     // um pouco abaixo do Mi grave (82,4 Hz)
  maxFreq = 400,    // um pouco acima do Mi agudo (329,6 Hz)
  threshold = 0.12, // limiar do YIN: menor = mais exigente
  minRms = 0.01,    // abaixo disso consideramos silêncio
  maxAperiodicity = 0.35,
} = {}) {
  const n = buf.length;

  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += buf[i] * buf[i];
  if (Math.sqrt(sumSq / n) < minRms) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(Math.ceil(sampleRate / minFreq), Math.floor(n / 2) - 1);
  if (tauMax <= tauMin) return null;
  const w = n - tauMax - 1; // janela de integração

  // Função diferença + média cumulativa normalizada (CMNDF).
  const diffs = new Float64Array(tauMax + 2);
  const cmnd = new Float64Array(tauMax + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let d = 0;
    for (let i = 0; i < w; i++) {
      const diff = buf[i] - buf[i + tau];
      d += diff * diff;
    }
    diffs[tau] = d;
    running += d;
    cmnd[tau] = running > 0 ? (d * tau) / running : 1;
  }

  // Primeiro vale abaixo do limiar; se não houver, o mínimo global.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) {
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    tau = best;
  }
  if (cmnd[tau] > maxAperiodicity) return null;

  // Interpolação parabólica para precisão abaixo de uma amostra. Feita sobre a
  // função diferença bruta: a normalização da CMNDF desloca levemente o mínimo.
  let betterTau = tau;
  const a = diffs[tau - 1], b = diffs[tau], c = diffs[tau + 1];
  const denom = a - 2 * b + c;
  if (denom > 0) betterTau = tau + (a - c) / (2 * denom);

  return { freq: sampleRate / betterTau, clarity: 1 - cmnd[tau] };
}
