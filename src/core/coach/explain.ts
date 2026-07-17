import { Chess, Move } from 'chess.js';
import { Judgment } from './classify';

const PIECE_NAME: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export interface Explanation {
  /** Short teaching notes about the move, most important first. */
  notes: string[];
  /** SAN of the engine's better move — shown only in retrospect/review. */
  betterMove: string | null;
}

interface ExplainInput {
  /** Position BEFORE the player's move. */
  before: Chess;
  /** The move the player made (verbose). */
  played: Move;
  judgment: Judgment;
  /** Engine best move (UCI) from the position before. */
  bestUci: string | null;
  /** Opponent's best reply (UCI) after the played move, if known. */
  refutationUci: string | null;
  /** Mover had forced mate in N moves (if any). */
  mateIn: number | null;
}

function pawnFiles(game: Chess, color: 'w' | 'b'): number[] {
  const files = new Array(8).fill(0);
  for (const row of game.board()) {
    for (const sq of row) {
      if (sq && sq.type === 'p' && sq.color === color) {
        files[sq.square.charCodeAt(0) - 97]++;
      }
    }
  }
  return files;
}

function kingShieldFiles(kingSquare: string): string[] {
  const f = kingSquare[0];
  if (f >= 'f') return ['f', 'g', 'h'];
  if (f <= 'c') return ['a', 'b', 'c'];
  return [];
}

/**
 * Turn engine analysis into teaching notes. Detectors are ordered by
 * priority; we only surface notes we're confident about (per plan §4a/§4).
 */
export function explainMove(input: ExplainInput): Explanation {
  const { before, played, judgment } = input;
  const notes: string[] = [];
  const after = new Chess(before.fen());
  after.move({ from: played.from, to: played.to, promotion: played.promotion });

  let betterMove: string | null = null;
  if (input.bestUci && judgment.verdict !== 'best') {
    const b = new Chess(before.fen());
    try {
      const m = b.move({
        from: input.bestUci.slice(0, 2),
        to: input.bestUci.slice(2, 4),
        promotion: input.bestUci.length > 4 ? input.bestUci[4] : undefined,
      });
      betterMove = m.san;
    } catch {
      betterMove = null;
    }
  }

  // 1. Missed forced mate — the biggest teachable moment.
  if (judgment.verdict === 'missed-mate' && input.mateIn != null) {
    notes.push(
      `You had a forced checkmate in ${input.mateIn}. When your attack looks strong, pause and calculate every check first.`,
    );
  }

  // 2. Hanging the moved piece: opponent's best reply is simply taking it.
  if (
    input.refutationUci &&
    input.refutationUci.slice(2, 4) === played.to &&
    (judgment.verdict === 'mistake' || judgment.verdict === 'blunder')
  ) {
    const target = after.get(played.to);
    if (target) {
      const defenders = after
        .moves({ verbose: true })
        .filter((m) => m.to === played.to).length;
      const name = PIECE_NAME[target.type];
      notes.push(
        defenders === 0
          ? `Your ${name} on ${played.to} is undefended and can simply be captured. Before moving, check every square your opponent attacks.`
          : `Your ${name} on ${played.to} can be captured favorably — its defense doesn't hold up. Count attackers and defenders before placing a piece there.`,
      );
    }
  }

  // 3. Losing capture: took a defended piece with a more valuable one.
  if (
    played.captured &&
    PIECE_VALUE[played.piece] > PIECE_VALUE[played.captured] &&
    (judgment.verdict === 'mistake' || judgment.verdict === 'blunder') &&
    input.refutationUci?.slice(2, 4) === played.to
  ) {
    notes.push(
      `Capturing with your ${PIECE_NAME[played.piece]} loses material — the ${PIECE_NAME[played.captured]} was defended. A capture is only "free" if you win the full exchange.`,
    );
  }

  // 4. Weakening the king's pawn shield (midgame concept).
  const kingSq = after
    .board()
    .flat()
    .find((s) => s && s.type === 'k' && s.color === played.color)?.square;
  if (
    played.piece === 'p' &&
    kingSq &&
    kingShieldFiles(kingSq).includes(played.from[0]) &&
    before.moveNumber() > 8 &&
    judgment.winDrop >= 5 &&
    notes.length === 0
  ) {
    notes.push(
      `Pushing the ${played.from[0]}-pawn loosens the shelter in front of your king. Every pawn move near your king is permanent — make sure it's forced or wins something.`,
    );
  }

  // 5. Structure damage: gave yourself doubled or isolated pawns.
  if (notes.length === 0 && judgment.winDrop >= 5) {
    const beforeFiles = pawnFiles(before, played.color);
    const afterFiles = pawnFiles(after, played.color);
    const doubledBefore = beforeFiles.filter((n) => n >= 2).length;
    const doubledAfter = afterFiles.filter((n) => n >= 2).length;
    if (doubledAfter > doubledBefore) {
      notes.push(
        'This creates doubled pawns — they can no longer defend each other and become long-term targets. Sometimes worth it, but only for real activity in return.',
      );
    }
  }

  // 6. Opening principle: same piece twice while others sleep.
  if (notes.length === 0 && before.moveNumber() <= 8 && judgment.winDrop >= 5) {
    const history = before.history({ verbose: true });
    const myMoves = history.filter((m) => m.color === played.color);
    const movedBefore = myMoves.some(
      (m) => m.to === played.from && m.piece === played.piece && m.piece !== 'p',
    );
    if (movedBefore) {
      notes.push(
        'You moved the same piece twice in the opening while other pieces are still at home. Each move here is a development race — bring out a new piece instead.',
      );
    }
  }

  // 7. Generic fallbacks so mistakes never pass silently.
  if (notes.length === 0) {
    if (judgment.verdict === 'blunder') {
      notes.push(
        "This loses significant ground — compare it with the better line to see what your opponent's reply now wins.",
      );
    } else if (judgment.verdict === 'mistake') {
      notes.push(
        'There was a noticeably stronger option here. Look at what the better move attacks or defends that yours does not.',
      );
    } else if (judgment.verdict === 'inaccuracy') {
      notes.push(
        'Playable, but slightly passive — the better move fights harder for the initiative.',
      );
    }
  }

  return { notes, betterMove };
}
