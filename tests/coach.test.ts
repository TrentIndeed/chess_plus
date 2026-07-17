import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { judgeMove, moveAccuracy, winPct } from '../src/core/coach/classify';
import { explainMove } from '../src/core/coach/explain';

describe('classification', () => {
  it('win% is 50 at equality and monotonic', () => {
    expect(winPct(0)).toBeCloseTo(50);
    expect(winPct(300)).toBeGreaterThan(winPct(100));
    expect(winPct(-300)).toBeLessThan(winPct(-100));
  });

  it('labels the engine move as best', () => {
    const j = judgeMove({ bestCp: 50, playedCp: 50, isEngineBest: true });
    expect(j.verdict).toBe('best');
    expect(j.accuracy).toBe(100);
  });

  it('grades increasing eval loss more harshly', () => {
    const inn = judgeMove({ bestCp: 0, playedCp: -180, isEngineBest: false });
    const blunder = judgeMove({ bestCp: 0, playedCp: -700, isEngineBest: false });
    expect(['inaccuracy', 'mistake']).toContain(inn.verdict);
    expect(blunder.verdict).toBe('blunder');
    expect(blunder.accuracy).toBeLessThan(inn.accuracy);
  });

  it('flags a missed forced mate', () => {
    const j = judgeMove({
      bestCp: 9990,
      playedCp: 200,
      isEngineBest: false,
      bestMate: 1,
      playedMate: null,
    });
    expect(j.verdict).toBe('missed-mate');
  });

  it('accuracy decays with win drop', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100);
    expect(moveAccuracy(30)).toBeLessThan(30);
  });
});

describe('explanations', () => {
  it('explains hanging a piece', () => {
    // 1.e4 e5 2.Qh5?? and black could play Nc6; instead white queen to h5
    // then black plays g6 attacking... construct directly: white plays Qh5,
    // black knight can capture? Simpler: white moves a knight where the
    // opponent's best reply captures it.
    const before = new Chess();
    before.move('e4');
    before.move('e5');
    const played = new Chess(before.fen()).move('Ng1f3');
    // Pretend engine says the knight gets taken (it doesn't really — this
    // tests the detector plumbing, judgment drives severity).
    const result = explainMove({
      before,
      played,
      judgment: { verdict: 'blunder', winDrop: 30, accuracy: 10 },
      bestUci: 'd2d4',
      refutationUci: 'e5f3',
      mateIn: null,
    });
    expect(result.notes.join(' ')).toMatch(/captured/i);
    expect(result.betterMove).toBe('d4');
  });

  it('explains a missed mate', () => {
    const before = new Chess('6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1');
    const played = new Chess(before.fen()).move('Re2');
    const result = explainMove({
      before,
      played,
      judgment: { verdict: 'missed-mate', winDrop: 40, accuracy: 5 },
      bestUci: 'e1e8',
      refutationUci: null,
      mateIn: 1,
    });
    expect(result.notes.join(' ')).toMatch(/checkmate in 1/i);
    expect(result.betterMove).toBe('Re8#');
  });

  it('always says something about a blunder', () => {
    const before = new Chess();
    const played = new Chess(before.fen()).move('a3');
    const result = explainMove({
      before,
      played,
      judgment: { verdict: 'blunder', winDrop: 25, accuracy: 12 },
      bestUci: null,
      refutationUci: null,
      mateIn: null,
    });
    expect(result.notes.length).toBeGreaterThan(0);
  });
});
