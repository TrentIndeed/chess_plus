import { Chess } from 'chess.js';

/**
 * Small forced-mate solver used to (a) validate the bundled puzzle set in
 * tests and (b) grade user moves — ANY move that still forces mate within
 * the remaining budget counts as correct, not just one scripted line.
 *
 * "Mate in N" = the side to move mates in at most N of its own moves
 * against any defense.
 */

function orderedMoves(game: Chess) {
  // Checks and captures first — massively prunes the mate search.
  return game.moves({ verbose: true }).sort((a, b) => {
    const scoreOf = (m: { san: string; captured?: string }) =>
      (m.san.includes('+') || m.san.includes('#') ? 2 : 0) + (m.captured ? 1 : 0);
    return scoreOf(b) - scoreOf(a);
  });
}

/** Can the side to move force mate in at most n of its moves? */
export function canForceMate(game: Chess, n: number): boolean {
  if (n <= 0) return false;
  for (const move of orderedMoves(game)) {
    game.move(move);
    if (game.isCheckmate()) {
      game.undo();
      return true;
    }
    let allRepliesLose = false;
    if (n > 1 && !game.isGameOver()) {
      allRepliesLose = true;
      for (const reply of game.moves({ verbose: true })) {
        game.move(reply);
        const mated = canForceMate(game, n - 1);
        game.undo();
        if (!mated) {
          allRepliesLose = false;
          break;
        }
      }
    }
    game.undo();
    if (allRepliesLose) return true;
  }
  return false;
}

/** Minimal number of moves to force mate, or null if > maxN. */
export function mateIn(fen: string, maxN: number): number | null {
  const game = new Chess(fen);
  for (let n = 1; n <= maxN; n++) {
    if (canForceMate(game, n)) return n;
  }
  return null;
}

/** All first moves (SAN) that force mate within n moves. */
export function matingMoves(fen: string, n: number): string[] {
  const game = new Chess(fen);
  const result: string[] = [];
  for (const move of game.moves({ verbose: true })) {
    game.move(move);
    const ok = game.isCheckmate() || (n > 1 && !game.isGameOver() && allRepliesMated(game, n - 1));
    game.undo();
    if (ok) result.push(move.san);
  }
  return result;
}

function allRepliesMated(game: Chess, n: number): boolean {
  for (const reply of game.moves({ verbose: true })) {
    game.move(reply);
    const mated = canForceMate(game, n);
    game.undo();
    if (!mated) return false;
  }
  return true;
}

/**
 * After the attacker's (non-mating) move, does every defender reply still
 * lose to mate within the attacker's remaining move budget? Used to grade
 * puzzle moves: any move that keeps the forced mate counts.
 */
export function keepsForcedMate(fenAfterMove: string, remaining: number): boolean {
  if (remaining <= 0) return false;
  const game = new Chess(fenAfterMove);
  const replies = game.moves({ verbose: true });
  if (replies.length === 0) return false; // mate was handled earlier; this is stalemate
  return allRepliesMated(game, remaining);
}

/**
 * Defender's most resilient reply (SAN): prefers a move after which the
 * attacker still needs the full remaining budget.
 */
export function bestDefense(fen: string, remaining: number): string | null {
  const game = new Chess(fen);
  const replies = game.moves({ verbose: true });
  if (replies.length === 0) return null;
  let best: string | null = null;
  let bestSurvival = -1;
  for (const reply of replies) {
    game.move(reply);
    let survival = remaining; // moves the attacker still needs
    for (let n = 1; n < remaining; n++) {
      if (canForceMate(game, n)) {
        survival = n;
        break;
      }
    }
    game.undo();
    if (survival > bestSurvival) {
      bestSurvival = survival;
      best = reply.san;
    }
  }
  return best;
}
