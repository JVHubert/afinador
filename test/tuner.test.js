import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progresso, STRINGS, Tuner, cents, corrigirOitava, nearestString } from '../tuner.js';

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

test('corrige erro de oitava do Mi grave (aparecia como Ré, afrouxe)', () => {
  for (const offset of [-75, -40, 0, 40, 75]) {
    const f = corrigirOitava(2 * at(E2, offset));
    assert.ok(Math.abs(cents(f, at(E2, offset))) < 0.01, `${offset}¢`);
  }
  const t = new Tuner();
  for (let ms = 0; ms <= 600; ms += 40) t.push(2 * at(E2, -15), ms);
  const r = t.snapshot(600);
  assert.equal(r.string, E2);
  assert.equal(r.state, 'aperte');
  assert.ok(Math.abs(r.cents + 15) < 1);
});

test('correção de oitava não mexe em cordas afinadas ou pouco desafinadas', () => {
  for (const s of STRINGS) {
    for (const offset of [-90, -40, 0, 40, 90]) {
      const f = at(s, offset);
      assert.equal(corrigirOitava(f), f, `${s.name} ${offset}¢`);
    }
  }
});

test('progresso: marca cordas afinadas e avisa quando o violão inteiro fica afinado', () => {
  const p = new Progresso();
  const afinado = (s) => ({ state: 'afinado', string: s, cents: 0, stale: false });
  let ms = 0;
  for (const s of STRINGS.slice(0, 5)) {
    const ev = p.update(afinado(s), ms += 100);
    assert.equal(ev.cordaAfinada, s.num);
    assert.equal(ev.violaoAfinado, false);
  }
  assert.equal(p.update(afinado(E2), ms += 100).cordaAfinada, null); // já marcada
  const fim = p.update(afinado(E4), ms += 100);
  assert.deepEqual(fim, { cordaAfinada: 1, violaoAfinado: true });
  assert.equal(p.update(afinado(E4), ms += 100).violaoAfinado, false); // avisa uma vez só
});

test('progresso: corda que desafina de novo perde a marca', () => {
  const p = new Progresso();
  p.update({ state: 'afinado', string: G3, cents: 1, stale: false }, 0);
  const fora = { state: 'aperte', string: G3, cents: -20, stale: false };
  p.update(fora, 100);
  p.update(fora, 500);
  assert.ok(p.afinadas.has(3), 'desafinada por pouco tempo (ataque da palhetada) mantém a marca');
  p.update(fora, 1000);
  assert.ok(!p.afinadas.has(3));
  // Leitura esmaecida não conta.
  p.update({ state: 'afinado', string: A2, cents: 0, stale: true }, 1100);
  assert.ok(!p.afinadas.has(5));
});
