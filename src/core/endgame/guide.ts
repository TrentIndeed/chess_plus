import { Chess } from 'chess.js';
import { squareDistance } from '../bot/plans';

export type EndgameType = 'KQvK' | 'KRvK' | 'KRRvK';

export interface EndgameState {
  type: EndgameType;
  /** Which color is doing the mating. */
  strongSide: 'w' | 'b';
  title: string;
  /** The named technique for this mate. */
  technique: string[];
  /** Live, position-specific guidance (phase narration, not moves). */
  narration: string;
  /** True when the defender is short of moves — stalemate danger zone. */
  stalemateWarning: boolean;
  /** Halfmove clock — moves toward the 50-move rule. */
  fiftyMoveClock: number;
}

const TECHNIQUE: Record<EndgameType, { title: string; steps: string[] }> = {
  KQvK: {
    title: 'Queen mate — the box method',
    steps: [
      'Use the queen a knight’s-move away from the king to shrink its box without ever giving check.',
      'Drive the king to the edge, then STOP the queen and walk your own king up.',
      'Deliver mate only with your king guarding the queen (or covering escape squares).',
      'Danger: a queen alone near a cornered king is the #1 stalemate trap.',
    ],
  },
  KRvK: {
    title: 'Rook mate — the box method',
    steps: [
      'Use the rook to fence the king into a box; shrink it one rank or file at a time.',
      'When the kings stand opposed (opposition), a rook check pushes the king toward the edge.',
      'If the king attacks your rook, slide it to the far side of the same line.',
      'Mate happens on the edge with your king directly opposing theirs.',
    ],
  },
  KRRvK: {
    title: 'Two-rook mate — the ladder',
    steps: [
      'One rook cuts off a rank; the other checks on the next rank — like climbing a ladder.',
      'The king never needs to help. Alternate rooks rank by rank toward the edge.',
      'If the king attacks a rook, swing that rook far away along its rank.',
    ],
  },
};

function pieceList(game: Chess, color: 'w' | 'b'): string {
  return game
    .board()
    .flat()
    .filter((s) => s !== null && s.color === color)
    .map((s) => s!.type)
    .sort()
    .join('');
}

function findSquare(game: Chess, color: 'w' | 'b', type: string): string | null {
  for (const row of game.board()) {
    for (const sq of row) {
      if (sq && sq.color === color && sq.type === type) return sq.square;
    }
  }
  return null;
}

function distToEdge(sq: string): number {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  return Math.min(f, 7 - f, r, 7 - r);
}

/** Detect a basic-mate endgame (bare king vs. K+Q / K+R / K+RR). */
export function detectEndgame(game: Chess): EndgameState | null {
  for (const strong of ['w', 'b'] as const) {
    const weak = strong === 'w' ? 'b' : 'w';
    if (pieceList(game, weak) !== 'k') continue;
    const strongPieces = pieceList(game, strong);
    let type: EndgameType | null = null;
    if (strongPieces === 'kq') type = 'KQvK';
    else if (strongPieces === 'kr') type = 'KRvK';
    else if (strongPieces === 'krr') type = 'KRRvK';
    if (!type) continue;

    const enemyKing = findSquare(game, weak, 'k')!;
    const myKing = findSquare(game, strong, 'k')!;
    const kingDist = squareDistance(myKing, enemyKing);
    const edge = distToEdge(enemyKing);

    let narration: string;
    if (edge === 0) {
      narration =
        kingDist > 2 && type !== 'KRRvK'
          ? 'The king is on the edge — now bring YOUR king closer before looking for the mate.'
          : 'The king is trapped on the edge and your pieces are close. Look for the mating net — and double-check it isn’t stalemate.';
    } else {
      narration = `The enemy king is ${edge} square${edge > 1 ? 's' : ''} from the edge. Shrink its box — cut off lines, don’t chase with checks.`;
    }

    // Stalemate danger: defender to move soon with very few squares.
    const probe = new Chess(game.fen());
    let defenderMoves = -1;
    if (probe.turn() === weak) {
      defenderMoves = probe.moves().length;
    }
    const stalemateWarning = defenderMoves >= 0 && defenderMoves <= 2 && !probe.inCheck();

    return {
      type,
      strongSide: strong,
      title: TECHNIQUE[type].title,
      technique: TECHNIQUE[type].steps,
      narration,
      stalemateWarning,
      fiftyMoveClock: Number(game.fen().split(' ')[4]),
    };
  }
  return null;
}
