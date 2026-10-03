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
    this.history.push(freq);
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
