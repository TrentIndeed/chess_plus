export interface Puzzle {
  id: string;
  fen: string;
  mateIn: number;
  theme: string;
  /** Approximate difficulty rating, chess.com/lichess scale. */
  rating: number;
}

/**
 * Bundled starter puzzle set. Every entry is verified by the mate solver in
 * tests (tests/puzzles.test.ts) — the solver, not this file, is the source
 * of truth for correctness. Larger sets (from the CC0 Lichess puzzle DB)
 * come later per plan §5.
 */
export const PUZZLES: Puzzle[] = [
  {
    id: 'm1-backrank',
    fen: '6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1',
    mateIn: 1,
    theme: 'Back-rank mate',
    rating: 400,
  },
  {
    id: 'm1-scholars',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
    mateIn: 1,
    theme: 'Scholar’s mate pattern',
    rating: 450,
  },
  {
    id: 'm1-smothered',
    fen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1',
    mateIn: 1,
    theme: 'Smothered mate',
    rating: 700,
  },
  {
    id: 'm1-support',
    fen: 'k7/2K5/8/8/8/8/8/1Q6 w - - 0 1',
    mateIn: 1,
    theme: 'Supported queen mate',
    rating: 500,
  },
  {
    id: 'm1-ladder',
    fen: 'k7/7R/8/8/8/8/8/6RK w - - 0 1',
    mateIn: 1,
    theme: 'Ladder mate',
    rating: 450,
  },
  {
    id: 'm1-boxed',
    fen: '3k4/8/4K3/8/8/8/8/3Q4 w - - 0 1',
    mateIn: 1,
    theme: 'Queen and king mate',
    rating: 550,
  },
  {
    id: 'm1-arabian',
    fen: '7k/8/5N2/8/8/8/8/K5R1 w - - 0 1',
    mateIn: 1,
    theme: 'Arabian mate',
    rating: 800,
  },
  {
    id: 'm1-corner-q',
    fen: '7k/8/7K/8/8/8/8/Q7 w - - 0 1',
    mateIn: 1,
    theme: 'Corner mate',
    rating: 500,
  },
  {
    id: 'm1-fools',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2',
    mateIn: 1,
    theme: 'Fool’s mate',
    rating: 400,
  },
  {
    id: 'm1-backrank-black',
    fen: '4r1k1/8/8/8/8/8/5PPP/6K1 b - - 0 1',
    mateIn: 1,
    theme: 'Back-rank mate (as Black)',
    rating: 450,
  },
  {
    id: 'm2-ladder',
    fen: 'k7/8/8/8/8/8/6R1/5R1K w - - 0 1',
    mateIn: 2,
    theme: 'Ladder mate',
    rating: 700,
  },
  {
    id: 'm2-ladder-b8',
    fen: '1k6/8/8/8/8/8/R6R/6K1 w - - 0 1',
    mateIn: 2,
    theme: 'Ladder mate',
    rating: 750,
  },
  {
    id: 'm2-kq-walk',
    fen: '7k/8/8/5K2/8/8/6Q1/8 w - - 0 1',
    mateIn: 2,
    theme: 'King and queen coordination',
    rating: 900,
  },
];
