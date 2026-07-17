import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { Candidate, chooseMove, complexityOf } from '../src/core/bot/humanizer';
import { PERSONAS } from '../src/core/bot/personas';
import { mulberry32 } from '../src/core/bot/rng';
import { pickPlan } from '../src/core/bot/plans';

const START = new Chess();

function startCandidates(): Candidate[] {
  // Plausible MultiPV output for the starting position (white to move).
  return [
    { move: 'e2e4', scoreCp: 30 },
    { move: 'd2d4', scoreCp: 28 },
    { move: 'g1f3', scoreCp: 22 },
    { move: 'c2c4', scoreCp: 20 },
    { move: 'e2e3', scoreCp: 5 },
    { move: 'a2a3', scoreCp: -20 },
    { move: 'g2g4', scoreCp: -120 },
  ];
}

function pickRate(personaId: string, topMoves: string[], samples = 300): number {
  const persona = PERSONAS.find((p) => p.id === personaId)!;
  const rng = mulberry32(42);
  let hits = 0;
  for (let i = 0; i < samples; i++) {
    const c = chooseMove(startCandidates(), persona, START, null, rng);
    if (topMoves.includes(c.move)) hits++;
  }
  return hits / samples;
}

describe('humanizer', () => {
  it('stronger personas play top moves more often and losing moves almost never', () => {
    const weak = pickRate('willow', ['e2e4', 'd2d4']);
    const strong = pickRate('viktor', ['e2e4', 'd2d4']);
    // When candidates are close in eval, even masters vary — but the rate
    // still separates clearly by rating.
    expect(strong).toBeGreaterThan(weak + 0.15);
    // The clearest signal: strong players essentially never pick the move
    // that loses 150cp; weak players do sometimes.
    const strongLosing = pickRate('viktor', ['g2g4']);
    const weakLosing = pickRate('willow', ['g2g4']);
    expect(strongLosing).toBeLessThan(0.02);
    expect(weakLosing).toBeGreaterThan(strongLosing);
  });

  it('weak personas still make graded errors, not just blunders', () => {
    const persona = PERSONAS.find((p) => p.id === 'willow')!;
    const rng = mulberry32(7);
    const losses: number[] = [];
    for (let i = 0; i < 300; i++) {
      losses.push(chooseMove(startCandidates(), persona, START, null, rng).lossCp);
    }
    const small = losses.filter((l) => l > 0 && l < 60).length;
    const huge = losses.filter((l) => l >= 150).length;
    // The signature human pattern: many small errors, few catastrophes.
    expect(small).toBeGreaterThan(huge);
  });

  it('blunder-awareness resamples big blunders for strong personas', () => {
    const cands: Candidate[] = [
      { move: 'e2e4', scoreCp: 30 },
      { move: 'g2g4', scoreCp: -400 },
    ];
    const persona = PERSONAS.find((p) => p.id === 'viktor')!;
    const rng = mulberry32(3);
    let blunders = 0;
    for (let i = 0; i < 200; i++) {
      const c = chooseMove(cands, persona, START, null, rng);
      if (c.move === 'g2g4') blunders++;
    }
    expect(blunders).toBeLessThan(5);
  });

  it('measures complexity from eval spread', () => {
    const quiet: Candidate[] = [
      { move: 'a', scoreCp: 20 },
      { move: 'b', scoreCp: 18 },
      { move: 'c', scoreCp: 15 },
    ];
    const sharp: Candidate[] = [
      { move: 'a', scoreCp: 350 },
      { move: 'b', scoreCp: -200 },
      { move: 'c', scoreCp: -450 },
    ];
    expect(complexityOf(sharp)).toBeGreaterThan(complexityOf(quiet));
  });

  it('picks a development plan in the opening', () => {
    expect(pickPlan(new Chess(), null).id).toBe('develop');
  });

  it('picks trade-ahead when up material', () => {
    // White is up a queen.
    const game = new Chess('rnb1kbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3');
    // Force out of development phase by clearing home minors.
    const late = new Chess('4k3/8/8/8/8/8/PPP5/Q3K3 w - - 0 40');
    expect(pickPlan(late, null).id).toBe('trade-ahead');
    expect(pickPlan(game, null).id).toBe('develop');
  });
});
