// Lógica do afinador: frequência → corda → desvio em cents → instrução.
// Módulo puro (sem DOM, sem áudio); o tempo é injetado para facilitar testes.

const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

// Da 6ª corda (mais grave) para a 1ª (mais aguda), afinação padrão.
export const STRINGS = [
  { num: 6, note: 'E', name: 'Mi grave', freq: midiToFreq(40) },
  { num: 5, note: 'A', name: 'Lá', freq: midiToFreq(45) },
  { num: 4, note: 'D', name: 'Ré', freq: midiToFreq(50) },
  { num: 3, note: 'G', name: 'Sol', freq: midiToFreq(55) },
  { num: 2, note: 'B', name: 'Si', freq: midiToFreq(59) },
  { num: 1, note: 'E', name: 'Mi agudo', freq: midiToFreq(64) },
];

export const cents = (freq, ref) => 1200 * Math.log2(freq / ref);

/** Corda mais próxima; só troca da `current` se outra estiver claramente mais perto. */
export function nearestString(freq, current = null, hysteresis = 40) {
  let best = STRINGS[0];
  for (const s of STRINGS) {
    if (Math.abs(cents(freq, s.freq)) < Math.abs(cents(freq, best.freq))) best = s;
  }
  if (current && current !== best &&
      Math.abs(cents(freq, current.freq)) < Math.abs(cents(freq, best.freq)) + hysteresis) {
    return current;
  }
  return best;
}

/**
 * O dobro da frequência de uma corda nunca cai perto de outra corda (fica a
 * 200¢ ou mais). Então uma leitura longe de todas as cordas, cuja metade cai
 * numa corda, é erro de oitava do detector (comum no Mi grave pelo microfone
 * do celular). Custo: uma corda desafinada em mais de ~1 semitom pode ser
 * confundida com outra mais grave, o que na prática só acontece ao trocar cordas.
 */
export function corrigirOitava(freq, longe = 120, perto = 80) {
  if (Math.abs(cents(freq, nearestString(freq).freq)) <= longe) return freq;
  const metade = freq / 2;
  return Math.abs(cents(metade, nearestString(metade).freq)) <= perto ? metade : freq;
}

const median = (arr) => {
  const s = [...arr].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export class Tuner {
  constructor({
    historySize = 5,
    smoothing = 0.35,     // peso da leitura nova na média móvel
    inTuneCents = 5,      // tolerância para "afinado"
    outOfTuneCents = 7,   // depois de afinado, só sai disso acima deste valor
    holdMs = 400,         // tempo dentro da tolerância até mostrar "afinado"
    gapMs = 300,          // pausa que indica uma nova palhetada
    staleMs = 250,        // sem leitura há este tempo → esmaece
    silenceMs = 1500,     // sem leitura há este tempo → volta ao repouso
  } = {}) {
    Object.assign(this, { historySize, smoothing, inTuneCents, outOfTuneCents, holdMs, gapMs, staleMs, silenceMs });
    this.reset();
  }

  reset() {
    this.history = [];
    this.string = null;
    this.displayCents = 0;
    this.lastHeard = -Infinity;
    this.inTuneSince = null;
    this.inTune = false;
  }

  /**
   * @param {number|null} freq frequência detectada (null = nada nesta leitura)
   * @param {number} now tempo em ms
   */
  push(freq, now) {
    if (freq == null) return this.snapshot(now);

    if (now - this.lastHeard > this.gapMs) this.history = [];
    this.lastHeard = now;
    this.history.push(corrigirOitava(freq));
    if (this.history.length > this.historySize) this.history.shift();

    const f = median(this.history);
    const string = nearestString(f, this.string);
    const c = cents(f, string.freq);

    if (string !== this.string) {
      this.string = string;
      this.displayCents = c;
      this.inTuneSince = null;
      this.inTune = false;
    } else {
      this.displayCents += this.smoothing * (c - this.displayCents);
    }

    const abs = Math.abs(this.displayCents);
    const limit = this.inTune ? this.outOfTuneCents : this.inTuneCents;
    if (abs <= limit) {
      this.inTuneSince ??= now;
      if (now - this.inTuneSince >= this.holdMs) this.inTune = true;
    } else {
      this.inTuneSince = null;
      this.inTune = false;
    }
    return this.snapshot(now);
  }

  snapshot(now) {
    const since = now - this.lastHeard;
    if (!this.string || since > this.silenceMs) {
      return { state: 'silencio', string: null, cents: 0, stale: false };
    }
    let state;
    if (this.inTune) state = 'afinado';
    else if (Math.abs(this.displayCents) <= this.inTuneCents) state = 'quase';
    else state = this.displayCents < 0 ? 'aperte' : 'afrouxe';
    return { state, string: this.string, cents: this.displayCents, stale: since > this.staleMs };
  }
}

/**
 * Acompanha quais cordas já ficaram afinadas para dar a confirmação final.
 * Uma corda marcada perde a marca se voltar a soar desafinada por um tempo
 * (afinar uma corda mexe na tensão do braço e pode desafinar as outras).
 */
export class Progresso {
  constructor({ perdeCents = 10, perdeMs = 800 } = {}) {
    Object.assign(this, { perdeCents, perdeMs });
    this.reset();
  }

  reset() {
    this.afinadas = new Set();
    this.foraDesde = new Map();
    this.completo = false;
  }

  /**
   * @param {ReturnType<Tuner['snapshot']>} leitura
   * @returns {{ cordaAfinada: number|null, violaoAfinado: boolean }} eventos novos desta leitura
   */
  update({ state, string, cents: c, stale }, now) {
    const eventos = { cordaAfinada: null, violaoAfinado: false };
    if (!string || stale) return eventos;
    const num = string.num;

    if (state === 'afinado') {
      this.foraDesde.delete(num);
      if (!this.afinadas.has(num)) {
        this.afinadas.add(num);
        eventos.cordaAfinada = num;
        if (this.afinadas.size === STRINGS.length && !this.completo) {
          this.completo = true;
          eventos.violaoAfinado = true;
        }
      }
    } else if (Math.abs(c) > this.perdeCents) {
      if (!this.foraDesde.has(num)) this.foraDesde.set(num, now);
      if (now - this.foraDesde.get(num) >= this.perdeMs) this.afinadas.delete(num);
    } else {
      this.foraDesde.delete(num);
    }
    return eventos;
  }
}
