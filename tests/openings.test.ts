import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  OPENING_BOOK,
  POPULAR_OPENINGS,
  getOpeningLine,
  lessonStep,
  recognizeOpening,
} from '../src/core/openings/book';

describe('opening book', () => {
  it('every book line is legal', () => {
    for (const line of OPENING_BOOK) {
      const game = new Chess();
      for (const san of line.san) {
        expect(() => game.move(san), `${line.name}: ${san}`).not.toThrow();
      }
    }
  });

  it('recognizes the London System', () => {
    const status = recognizeOpening(['d4', 'd5', 'Bf4']);
    expect(status.name).toBe('London System');
    expect(status.inBook).toBe(true);
    expect(status.lastIdea).toMatch(/bishop/i);
  });

  it('reports a deviation with the book move and its idea', () => {
    const status = recognizeOpening(['d4', 'd5', 'Nc3']);
    // At the deviation point both the London and the QGD were possible.
    expect(status.candidates).toContain('London System');
    expect(status.inBook).toBe(false);
    expect(status.deviation?.expectedSan).toBe('Bf4');
    expect(status.deviation?.atPly).toBe(2);
  });

  it('does not claim a specific opening while several lines still match', () => {
    const status = recognizeOpening(['e4', 'e5']);
    expect(status.name).toBeNull();
    expect(status.inBook).toBe(true);
    expect(status.candidates.length).toBeGreaterThan(1);
  });

  it('returns null for unknown starts', () => {
    expect(recognizeOpening(['h4']).name).toBeNull();
    expect(recognizeOpening([]).candidates).toHaveLength(0);
  });
});

describe('opening lessons', () => {
  it('every popular study opening exists in the book', () => {
    for (const name of POPULAR_OPENINGS) {
      expect(getOpeningLine(name), name).not.toBeNull();
    }
  });

  it('walks the London line move by move', () => {
    const line = getOpeningLine('London System')!;
    let step = lessonStep(line, []);
    expect(step).toMatchObject({ status: 'in-line', nextSan: 'd4', nextColor: 'w' });
    step = lessonStep(line, ['d4', 'd5']);
    expect(step).toMatchObject({ status: 'in-line', nextSan: 'Bf4', nextColor: 'w' });
  });

  it('reports who deviated and what book was', () => {
    const line = getOpeningLine('London System')!;
    const step = lessonStep(line, ['d4', 'd5', 'Nc3']);
    expect(step).toMatchObject({ status: 'deviated', expectedSan: 'Bf4', deviatedBy: 'w', atPly: 2 });
  });

  it('reports completion at the end of the line', () => {
    const line = getOpeningLine('Italian Game')!;
    expect(lessonStep(line, [...line.san]).status).toBe('complete');
    expect(lessonStep(line, [...line.san, 'h3', 'h6']).status).toBe('complete');
  });
});
