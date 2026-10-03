import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, Tuner, cents, nearestString } from '../tuner.js';

const at = (s, offset) => s.freq * 2 ** (offset / 1200);
const [E2, A2, D3, G3, B3, E4] = STRINGS;

test('frequências da afinação padrão', () => {
  const esperado = [82.41, 110, 146.83, 196, 246.94, 329.63];
  STRINGS.forEach((s, i) => assert.ok(Math.abs(s.freq - esperado[i]) < 0.01, s.name));
});

test('corda mais próxima', () => {
  assert.equal(nearestString(at(E2, 30)), E2);
  assert.equal(nearestString(at(A2, -60)), A2);
  assert.equal(nearestString(at(B3, 180)), B3);
  assert.equal(nearestString(at(E4, -150)), E4);
});

test('histerese evita troca de corda na fronteira', () => {
  // ~240¢ acima do Lá fica levemente mais perto do Ré, mas não o suficiente para trocar.
  const f = at(A2, 260);
  assert.equal(nearestString(f), D3);
  assert.equal(nearestString(f, A2), A2);
  // Bem mais perto do Ré: troca.
  assert.equal(nearestString(at(D3, -100), A2), D3);
});

test('aperte quando grave, afrouxe quando agudo', () => {
  let t = new Tuner();
  assert.equal(t.push(at(G3, -25), 0).state, 'aperte');
  t = new Tuner();
  const r = t.push(at(G3, 25), 0);
  assert.equal(r.state, 'afrouxe');
  assert.equal(r.string, G3);
  assert.ok(Math.abs(r.cents - 25) < 0.01);
});

test('afinado só depois de segurar dentro da tolerância', () => {
  const t = new Tuner();
  assert.equal(t.push(at(D3, 2), 0).state, 'quase');
  assert.equal(t.push(at(D3, 2), 200).state, 'quase');
  assert.equal(t.push(at(D3, 2), 450).state, 'afinado');
  // Pequena oscilação até 7¢ não tira do "afinado".
  for (let ms = 500; ms < 1500; ms += 50) t.push(at(D3, 6.5), ms);
  assert.equal(t.snapshot(1500).state, 'afinado');
  for (let ms = 1500; ms < 2500; ms += 50) t.push(at(D3, 15), ms);
  assert.equal(t.snapshot(2500).state, 'afrouxe');
});

test('mediana descarta leitura isolada errada (oitava)', () => {
  const t = new Tuner();
  for (let ms = 0; ms < 200; ms += 40) t.push(at(E2, -10), ms);
  const r = t.push(at(E2, -10) * 2, 200); // um erro de oitava
  assert.equal(r.string, E2);
  assert.ok(Math.abs(r.cents + 10) < 1);
});

test('esmaece sem som e volta ao repouso', () => {
  const t = new Tuner();
  t.push(at(A2, 0), 0);
  assert.equal(t.push(null, 100).stale, false);
  assert.equal(t.push(null, 400).stale, true);
  assert.equal(t.push(null, 400).string, A2);
  assert.equal(t.push(null, 1600).state, 'silencio');
});

test('cents', () => {
  assert.ok(Math.abs(cents(440 * 2 ** (1 / 12), 440) - 100) < 1e-9);
});
