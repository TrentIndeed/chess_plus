import { Chess, Move } from 'chess.js';
import { Persona } from './personas';
import { Plan, moveFitsPlan } from './plans';
import { Rng } from './rng';

/**
 * A candidate move from the engine's MultiPV output.
 * `scoreCp` is from the mover's perspective; forced mates are mapped onto a
 * large centipawn scale so they sort naturally with regular evals.
 */
export interface Candidate {
  /** UCI move, e.g. "e2e4". */
  move: string;
  scoreCp: number;
}

export interface Choice {
  move: string;
  /** Eval lost vs. the engine's best candidate, in cp. */
  lossCp: number;
  /** True if the blunder-awareness check kicked in and we re-sampled. */
  sawBlunder: boolean;
  /** How "sharp" the position was (0 quiet – 1 very sharp). */
  complexity: number;
  /** Suggested think time for realistic pacing. */
  thinkMs: number;
}

export const MATE_SCORE = 10_000;

export function mateToCp(mate: number): number {
  return mate > 0 ? MATE_SCORE - mate * 10 : -MATE_SCORE - mate * 10;
}

/**
 * Position sharpness in [0, 1]: how spread out the top candidate evals are.
 * Humans err more in sharp positions (where move choice matters a lot) and
 * less in quiet ones — chess.com bots err uniformly, which feels robotic.
 */
export function complexityOf(cands: Candidate[]): number {
  if (cands.length < 2) return 0;
  const top = cands.slice(0, Math.min(5, cands.length)).map((c) => c.scoreCp);
  const mean = top.reduce((a, b) => a + b, 0) / top.length;
  const sd = Math.sqrt(top.reduce((a, b) => a + (b - mean) ** 2, 0) / top.length);
  return Math.min(1, sd / 300);
}

function isBackwardQuietMove(move: Move): boolean {
  if (move.captured || move.san.includes('+')) return false;
  const dRank = Number(move.to[1]) - Number(move.from[1]);
  return move.color === 'w' ? dRank < 0 : dRank > 0;
}

/**
 * Choose a human-like move from engine candidates.
 *
 * Pipeline: (1) bias candidate scores with plan-consistency and rating-band
 * human biases, (2) softmax-sample with an Elo- and complexity-scaled
 * temperature, (3) run a blunder-awareness check that lets the bot "notice"
 * simple hanging-piece blunders and re-sample, at a probability scaled to
 * its rating.
 */
export function chooseMove(
  cands: Candidate[],
  persona: Persona,
  game: Chess,
  plan: Plan | null,
  rng: Rng,
): Choice {
  if (cands.length === 0) throw new Error('no candidates');
  const legal = game.moves({ verbose: true });
  const byUci = new Map<string, Move>();
  for (const m of legal) byUci.set(m.from + m.to + (m.promotion ?? ''), m);

  const best = cands[0].scoreCp;
  const complexity = complexityOf(cands);
  // Sharp positions raise the temperature — more human error where it hurts.
  const temp = persona.baseTemp * (1 + complexity * 1.2);

  const biased = cands.map((c) => {
    const verbose = byUci.get(c.move);
    let bonus = 0;
    if (verbose) {
      if (plan && moveFitsPlan(game, verbose, plan.id)) bonus += persona.planWeight;
      if (verbose.captured || verbose.san.includes('+')) bonus += persona.checkCaptureBias;
      if (isBackwardQuietMove(verbose)) bonus -= persona.backwardPenalty;
    }
    return { ...c, adj: c.scoreCp + bonus };
  });

  const sample = (pool: typeof biased): Candidate => {
    const weights = pool.map((c) => Math.exp(Math.max(c.adj - best, -1200) / temp));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  };

  let chosen = sample(biased);
  let sawBlunder = false;

  // Blunder-awareness: a candidate that loses >=150cp vs. best is the kind of
  // move a player double-checks. Rating-scaled chance to catch it and choose
  // again from the non-losing subset. In sharp positions awareness drops —
  // that's exactly where real humans blunder.
  const lossOf = (c: Candidate) => best - c.scoreCp;
  if (lossOf(chosen) >= 150) {
    const awareness = persona.blunderAwareness * (1 - 0.5 * complexity);
    if (rng() < awareness) {
      const safer = biased.filter((c) => lossOf(c) < 150);
      if (safer.length > 0) {
        chosen = sample(safer);
        sawBlunder = true;
      }
    }
  }

  const lossCp = lossOf(chosen);
  // Pacing: think longer in sharp positions and when tempted by a bad move;
  // snap-move in trivial ones. Purely cosmetic realism.
  const thinkMs = Math.round(
    400 + complexity * 2600 + Math.min(lossCp, 300) * 2 + rng() * 800,
  );

  return { move: chosen.move, lossCp, sawBlunder, complexity, thinkMs };
}
