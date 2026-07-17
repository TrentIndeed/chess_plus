export interface OpeningLine {
  name: string;
  /** Main line in SAN, alternating white/black from move 1. */
  san: string[];
  /** Teaching notes, keyed by ply index into `san`. */
  ideas: Record<number, string>;
}

export const OPENING_BOOK: OpeningLine[] = [
  {
    name: 'London System',
    san: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'Bd6', 'Bg3', 'O-O', 'Bd3', 'c5', 'c3', 'Nc6', 'Nbd2', 'b6'],
    ideas: {
      0: 'd4 stakes a claim in the center and opens the dark-squared bishop’s diagonal.',
      2: 'The London move: the bishop develops OUTSIDE the pawn chain before e3 would lock it in.',
      4: 'e3 builds the trademark London pyramid (d4–e3) and frees the light-squared bishop.',
      6: 'Simple development — the knight supports the center and prepares castling.',
      8: 'Bg3 preserves the London bishop from being traded by ...Bd6.',
      10: 'The bishop aims at h7 — a standard London attacking idea against the castled king.',
      12: 'c3 reinforces d4 so the center can never be shaken loose.',
      14: 'The knight belongs on d2 in the London — it supports e4 breaks and the f3-knight.',
      15: '...b6 prepares ...Bb7, solving Black’s light-squared bishop the London way.',
    },
  },
  {
    name: 'Italian Game',
    san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'],
    ideas: {
      0: 'e4 grabs the center and opens lines for the queen and bishop.',
      2: 'Nf3 attacks e5 — developing with a threat gains time.',
      4: 'The Italian bishop eyes f7, the weakest square in Black’s camp.',
      6: 'c3 prepares d4, building a big center at the right moment.',
      8: 'd3 keeps the center solid — the "Giuoco Pianissimo" slow build-up.',
      10: 'Castle early: king safety before any attack.',
    },
  },
  {
    name: 'Ruy Lopez',
    san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O'],
    ideas: {
      4: 'Bb5 pressures the knight that defends e5 — indirect pressure on the center.',
      6: 'Retreating keeps the pin option; Bxc6 would give up the bishop pair for structure.',
      8: 'Castling first — White can meet ...Nxe4 with Re1 winning the pawn back.',
      10: 'Re1 protects e4 and puts the rook on the file that may open.',
      14: 'c3 prepares d4 — the classic Ruy Lopez space-gaining break.',
    },
  },
  {
    name: 'Queen’s Gambit Declined',
    san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'Nbd7'],
    ideas: {
      2: 'The gambit: c4 offers a pawn to deflect Black’s d-pawn and rule the center.',
      3: 'Declining with e6 keeps the center solid but hems in the c8-bishop — Black’s eternal QGD problem.',
      6: 'Bg5 pressures the knight that holds d5 — fighting for the center indirectly.',
      10: 'Quiet development; White will decide later between minority attack and central play.',
    },
  },
  {
    name: 'Caro-Kann Defense',
    san: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7'],
    ideas: {
      1: 'c6 prepares ...d5, challenging the center while keeping the c8-bishop’s diagonal open — the point over the French.',
      7: 'The Caro bishop develops actively BEFORE ...e6 closes its diagonal.',
      10: 'h4 gains space and asks the bishop questions — the main-line battle.',
      11: '...h6 gives the bishop a safe retreat on h7.',
    },
  },
  {
    name: 'Sicilian Defense',
    san: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
    ideas: {
      1: 'c5 fights for d4 with a wing pawn — unbalancing the game from move one.',
      5: 'Trading a wing pawn for a center pawn gives Black long-term central potential.',
      9: 'The Najdorf move: ...a6 controls b5 and prepares ...e5 or ...b5 expansion.',
    },
  },
];

/** The three most-played openings — offered as study choices in the picker. */
export const POPULAR_OPENINGS = ['London System', 'Italian Game', 'Sicilian Defense'] as const;
export type PopularOpening = (typeof POPULAR_OPENINGS)[number];

export function getOpeningLine(name: string): OpeningLine | null {
  return OPENING_BOOK.find((l) => l.name === name) ?? null;
}

export type LessonStep =
  | { status: 'in-line'; nextSan: string; nextIdea: string | null; nextColor: 'w' | 'b'; ply: number }
  | { status: 'deviated'; expectedSan: string; idea: string | null; deviatedBy: 'w' | 'b'; atPly: number }
  | { status: 'complete' };

/**
 * Where the game stands relative to a *chosen* study line. Unlike
 * recognizeOpening (which passively identifies), this drives active teaching:
 * the player opted in, so the coach may show the next book move.
 */
export function lessonStep(line: OpeningLine, sanHistory: string[]): LessonStep {
  let i = 0;
  while (i < sanHistory.length && i < line.san.length && sanHistory[i] === line.san[i]) i++;
  if (i < sanHistory.length && i < line.san.length) {
    return {
      status: 'deviated',
      expectedSan: line.san[i],
      idea: line.ideas[i] ?? null,
      deviatedBy: i % 2 === 0 ? 'w' : 'b',
      atPly: i,
    };
  }
  if (sanHistory.length >= line.san.length) return { status: 'complete' };
  return {
    status: 'in-line',
    nextSan: line.san[sanHistory.length],
    nextIdea: line.ideas[sanHistory.length] ?? null,
    nextColor: sanHistory.length % 2 === 0 ? 'w' : 'b',
    ply: sanHistory.length,
  };
}

export interface OpeningStatus {
  /** Named only once the game uniquely identifies one book line. */
  name: string | null;
  /** All book lines still consistent with the game so far. */
  candidates: string[];
  /** Number of plies of the game that matched the book line. */
  matchedPlies: number;
  /** Still inside the book line? */
  inBook: boolean;
  /** Idea note for the most recent in-book ply, if any. */
  lastIdea: string | null;
  /** When play left book: what theory recommended and why. */
  deviation: { expectedSan: string; idea: string | null; atPly: number } | null;
}

/** Match the game's SAN history against the book (longest prefix wins). */
export function recognizeOpening(sanHistory: string[]): OpeningStatus {
  let bestLine: OpeningLine | null = null;
  let bestMatched = 0;
  for (const line of OPENING_BOOK) {
    let i = 0;
    while (i < sanHistory.length && i < line.san.length && sanHistory[i] === line.san[i]) i++;
    if (i > bestMatched) {
      bestMatched = i;
      bestLine = line;
    }
  }
  if (!bestLine || bestMatched === 0) {
    return { name: null, candidates: [], matchedPlies: 0, inBook: false, lastIdea: null, deviation: null };
  }
  const inBook = bestMatched === sanHistory.length && bestMatched <= bestLine.san.length;
  // Only claim a specific opening once the moves rule out the alternatives —
  // after 1.e4 it could still be four different openings.
  const candidates = OPENING_BOOK.filter((line) =>
    sanHistory.slice(0, bestMatched).every((san, i) => line.san[i] === san),
  ).map((l) => l.name);
  let lastIdea: string | null = null;
  for (let i = bestMatched - 1; i >= 0; i--) {
    if (bestLine.ideas[i]) {
      lastIdea = bestLine.ideas[i];
      break;
    }
  }
  let deviation: OpeningStatus['deviation'] = null;
  if (!inBook && bestMatched < bestLine.san.length) {
    deviation = {
      expectedSan: bestLine.san[bestMatched],
      idea: bestLine.ideas[bestMatched] ?? null,
      atPly: bestMatched,
    };
  }
  return {
    name: candidates.length === 1 ? bestLine.name : null,
    candidates,
    matchedPlies: bestMatched,
    inBook,
    lastIdea,
    deviation,
  };
}
