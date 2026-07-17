export type Verdict =
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'missed-mate';

/** Lichess-style win probability (0–100) for the side the cp is from. */
export function winPct(cp: number): number {
  const clamped = Math.max(-1500, Math.min(1500, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** Lichess-style per-move accuracy (0–100) from the win% drop. */
export function moveAccuracy(winDrop: number): number {
  const acc = 103.1668 * Math.exp(-0.04354 * winDrop) - 3.1668;
  return Math.max(0, Math.min(100, acc));
}

export interface Judgment {
  verdict: Verdict;
  /** Win% lost by the played move (>= 0). */
  winDrop: number;
  accuracy: number;
}

export interface JudgeInput {
  /** Eval (cp, mover's perspective) of the engine's best move. */
  bestCp: number;
  /** Eval (cp, mover's perspective) of the move actually played. */
  playedCp: number;
  /** True if the played move is the engine's top choice. */
  isEngineBest: boolean;
  /** Plies to mate for the best line, if the mover had a forced mate. */
  bestMate?: number | null;
  /** Plies to mate after the played move, if a forced mate is still on. */
  playedMate?: number | null;
  /** True if this move is still in a known opening book line. */
  isBookMove?: boolean;
}

export function judgeMove(input: JudgeInput): Judgment {
  const winBefore = winPct(input.bestCp);
  const winAfter = winPct(input.playedCp);
  const winDrop = Math.max(0, winBefore - winAfter);
  const accuracy = moveAccuracy(winDrop);

  let verdict: Verdict;
  if (input.isEngineBest) verdict = 'best';
  else if (input.isBookMove && winDrop < 5) verdict = 'book';
  else if (winDrop < 2) verdict = 'excellent';
  else if (winDrop < 5) verdict = 'good';
  else if (winDrop < 10) verdict = 'inaccuracy';
  else if (winDrop < 20) verdict = 'mistake';
  else verdict = 'blunder';

  // Had a forced mate, and the played move let it slip entirely.
  if (
    input.bestMate != null &&
    input.bestMate > 0 &&
    input.playedMate == null &&
    !input.isEngineBest &&
    winDrop >= 2
  ) {
    verdict = 'missed-mate';
  }
  return { verdict, winDrop, accuracy };
}
