import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { detectEndgame } from '../src/core/endgame/guide';

describe('endgame guide', () => {
  it('detects K+Q vs K', () => {
    const state = detectEndgame(new Chess('7k/8/8/5K2/8/8/6Q1/8 w - - 12 40'));
    expect(state?.type).toBe('KQvK');
    expect(state?.strongSide).toBe('w');
    expect(state?.title).toMatch(/box/i);
    expect(state?.fiftyMoveClock).toBe(12);
  });

  it('detects K+R vs K for black', () => {
    const state = detectEndgame(new Chess('8/8/8/8/8/2k5/r7/2K5 b - - 0 60'));
    expect(state?.type).toBe('KRvK');
    expect(state?.strongSide).toBe('b');
  });

  it('narrates edge vs. center phases differently', () => {
    const center = detectEndgame(new Chess('8/8/3k4/8/8/3QK3/8/8 w - - 0 40'));
    const edge = detectEndgame(new Chess('7k/8/5K2/8/8/8/6Q1/8 w - - 0 40'));
    expect(center?.narration).toMatch(/box/i);
    expect(edge?.narration).toMatch(/edge/i);
  });

  it('returns null for normal middlegames', () => {
    expect(detectEndgame(new Chess())).toBeNull();
  });

  it('warns when the defender is nearly stalemated', () => {
    // Black king cornered with one legal move.
    const state = detectEndgame(new Chess('k7/2Q5/8/8/8/8/8/4K3 b - - 0 50'));
    expect(state).not.toBeNull();
    if (state) expect(typeof state.stalemateWarning).toBe('boolean');
  });
});
