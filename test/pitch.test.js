import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch } from '../pitch.js';
import { STRINGS, cents } from '../tuner.js';

const SIZE = 4096;

// Gerador de ruído determinístico para os testes serem reproduzíveis.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32 * 2 - 1;
  };
}

/**
 * Passa-baixas biquad (RBJ), igual ao BiquadFilterNode 'lowpass' com Q = 1 que
 * o app.js coloca antes do detector.
 */
function lowpass(x, sampleRate, cutoff = 1000, q = 1) {
  const w = 2 * Math.PI * cutoff / sampleRate;
  const alpha = Math.sin(w) / (2 * q), cos = Math.cos(w);
  const b0 = (1 - cos) / 2, b1 = 1 - cos, b2 = b0, a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x.map((v) => {
    const y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    return y;
  });
}

/** Soma de harmônicos com fases variadas, imitando uma corda real. */
function tone(freq, sampleRate, harmonics = [1], { noise = 0, amp = 0.5, seed = 1, filter = true } = {}) {
  const rand = rng(seed);
  const preRoll = filter ? 2048 : 0; // deixa o filtro estabilizar
  let buf = new Float32Array(SIZE + preRoll);
  for (let i = 0; i < buf.length; i++) {
    let v = 0;
    harmonics.forEach((a, k) => {
      v += a * Math.sin(2 * Math.PI * freq * (k + 1) * i / sampleRate + k * 0.7);
    });
    buf[i] = amp * v / harmonics.length + noise * rand();
  }
  if (filter) buf = lowpass(buf, sampleRate);
  return buf.subarray(preRoll);
}

const TIMBRES = {
  senoide: [1],
  'dente de serra': [1, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 7, 1 / 8],
  // Cordas graves de violão: fundamental fraca, 2º harmônico dominante.
  'fundamental fraca': [0.3, 1, 0.7, 0.5, 0.3, 0.2],
};

for (const sampleRate of [44100, 48000]) {
  for (const [timbre, harmonics] of Object.entries(TIMBRES)) {
    test(`detecta as 6 cordas (${timbre}, ${sampleRate} Hz)`, () => {
      for (const s of STRINGS) {
        for (const offset of [0, -3, 3, -20, 20, -45, 45]) {
          for (const seed of [1, 2, 3]) {
            const freq = s.freq * 2 ** (offset / 1200);
            const r = detectPitch(tone(freq, sampleRate, harmonics, { noise: 0.02, seed }), sampleRate);
            assert.ok(r, `nada detectado em ${s.note}${s.num} ${offset}¢`);
            const err = cents(r.freq, freq);
            assert.ok(Math.abs(err) < 1.5, `${s.note}${s.num} ${offset}¢: erro de ${err.toFixed(2)}¢ (${r.freq.toFixed(2)} Hz)`);
          }
        }
      }
    });
  }
}

test('sem filtro e pouco ruído também é preciso', () => {
  for (const s of STRINGS) {
    const r = detectPitch(tone(s.freq, 48000, TIMBRES['fundamental fraca'], { noise: 0.005, filter: false }), 48000);
    assert.ok(Math.abs(cents(r.freq, s.freq)) < 1, s.name);
  }
});

test('silêncio retorna null', () => {
  assert.equal(detectPitch(new Float32Array(SIZE), 48000), null);
  const quiet = tone(110, 48000, [1], { amp: 0.005 });
  assert.equal(detectPitch(quiet, 48000), null);
});

test('ruído puro retorna null', () => {
  const rand = rng(42);
  const buf = new Float32Array(SIZE).map(() => 0.3 * rand());
  assert.equal(detectPitch(buf, 48000), null);
});
