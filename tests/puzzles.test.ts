import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { PUZZLES } from '../src/core/puzzles/data';
import { bestDefense, mateIn, matingMoves } from '../src/core/puzzles/solver';

describe('bundled puzzles', () => {
  for (const puzzle of PUZZLES) {
    it(`${puzzle.id}: is a legal position with mate in exactly ${puzzle.mateIn}`, () => {
      // Throws if the FEN is invalid.
      new Chess(puzzle.fen);
      expect(mateIn(puzzle.fen, 3)).toBe(puzzle.mateIn);
    });
  }

  it('finds Re8# in the back-rank puzzle', () => {
    expect(matingMoves('6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1', 1)).toContain('Re8#');
  });

  it('grades any forcing first move in a mate-in-2, not one scripted line', () => {
    const moves = matingMoves('k7/8/8/8/8/8/6R1/5R1K w - - 0 1', 2);
    expect(moves.length).toBeGreaterThan(0);
    // After a correct first move, the defender gets a reply and the mate
    // must still be deliverable next move.
    const game = new Chess('k7/8/8/8/8/8/6R1/5R1K w - - 0 1');
    game.move(moves[0]);
    const defense = bestDefense(game.fen(), 1);
    expect(defense).not.toBeNull();
    game.move(defense!);
    expect(matingMoves(game.fen(), 1).length).toBeGreaterThan(0);
  });
});
