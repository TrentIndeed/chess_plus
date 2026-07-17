import { Chess, Move, Square } from 'chess.js';

export type PlanId = 'develop' | 'attack-king' | 'trade-ahead' | 'improve';

export interface Plan {
  id: PlanId;
  description: string;
}

const PLAN_TEXT: Record<PlanId, string> = {
  develop: 'getting its pieces out and fighting for the center',
  'attack-king': 'building an attack against your king',
  'trade-ahead': 'trading pieces to convert its material advantage',
  improve: 'improving its worst-placed pieces',
};

const HOME_SQUARES: Record<'w' | 'b', Square[]> = {
  w: ['b1', 'g1', 'c1', 'f1'],
  b: ['b8', 'g8', 'c8', 'f8'],
};

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function materialDiff(game: Chess, color: 'w' | 'b'): number {
  let diff = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq) continue;
      diff += (sq.color === color ? 1 : -1) * PIECE_VALUE[sq.type];
    }
  }
  return diff;
}

function undevelopedMinors(game: Chess, color: 'w' | 'b'): number {
  let n = 0;
  for (const sq of HOME_SQUARES[color]) {
    const p = game.get(sq);
    if (p && p.color === color && (p.type === 'n' || p.type === 'b')) n++;
  }
  return n;
}

function kingSquare(game: Chess, color: 'w' | 'b'): Square {
  for (const row of game.board()) {
    for (const sq of row) {
      if (sq && sq.type === 'k' && sq.color === color) return sq.square;
    }
  }
  /* istanbul ignore next -- a legal position always has both kings */
  throw new Error('no king');
}

function fileOf(sq: string): number {
  return sq.charCodeAt(0) - 97;
}
function rankOf(sq: string): number {
  return Number(sq[1]) - 1;
}

/** Chebyshev distance between two squares. */
export function squareDistance(a: string, b: string): number {
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
}

/**
 * Pick (or keep) a plan for the side to move. Plans persist across moves so
 * the bot shows *intent* — it re-evaluates only when the situation changes.
 */
export function pickPlan(game: Chess, prev: Plan | null): Plan {
  const color = game.turn();
  if (undevelopedMinors(game, color) >= 2 && game.moveNumber() <= 12) {
    return plan('develop');
  }
  if (materialDiff(game, color) >= 3) {
    return plan('trade-ahead');
  }
  // With the queen still on and development done, lean into attacking.
  const hasQueen = game
    .board()
    .flat()
    .some((s) => s && s.type === 'q' && s.color === color);
  if (hasQueen && undevelopedMinors(game, color) === 0) {
    return prev && prev.id === 'improve' ? prev : plan('attack-king');
  }
  return plan('improve');
}

function plan(id: PlanId): Plan {
  return { id, description: PLAN_TEXT[id] };
}

const CENTER_WEIGHT = [0, 1, 2, 3, 3, 2, 1, 0];
function centrality(sq: string): number {
  return CENTER_WEIGHT[fileOf(sq)] + CENTER_WEIGHT[rankOf(sq)];
}

/** Does a verbose chess.js move fit the given plan? Used to bias selection. */
export function moveFitsPlan(game: Chess, move: Move, planId: PlanId): boolean {
  const color = move.color;
  switch (planId) {
    case 'develop': {
      if (move.san === 'O-O' || move.san === 'O-O-O') return true;
      if (
        (move.piece === 'n' || move.piece === 'b') &&
        HOME_SQUARES[color].includes(move.from)
      ) {
        return true;
      }
      // Central pawn advances support development.
      return move.piece === 'p' && ['d', 'e'].includes(move.from[0]);
    }
    case 'trade-ahead': {
      if (!move.captured) return false;
      // Only "even or better" captures fit the simplification plan.
      return PIECE_VALUE[move.captured] >= PIECE_VALUE[move.piece];
    }
    case 'attack-king': {
      const enemyKing = kingSquare(game, color === 'w' ? 'b' : 'w');
      if (move.san.includes('+') || move.san.includes('#')) return true;
      return squareDistance(move.to, enemyKing) <= 2;
    }
    case 'improve': {
      if (move.captured) return false;
      return centrality(move.to) > centrality(move.from);
    }
  }
}
