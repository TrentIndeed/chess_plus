export interface Persona {
  id: string;
  name: string;
  elo: number;
  avatar: string;
  blurb: string;
  /** Engine search depth for candidate generation. */
  depth: number;
  /** Number of candidate moves (MultiPV) considered. */
  multipv: number;
  /**
   * Softmax temperature in centipawns. Higher = more random move choice.
   * This produces *graded* errors: mostly small inaccuracies, occasionally
   * bigger mistakes — unlike a perfect-play-then-blunder bot.
   */
  baseTemp: number;
  /**
   * Probability of "seeing" that a sampled move loses material to a simple
   * refutation and re-sampling. Models the fact that even weak players
   * usually don't hang their queen in quiet positions.
   */
  blunderAwareness: number;
  /** Bonus (cp) low-rated bots give checks and captures — a real human bias. */
  checkCaptureBias: number;
  /** Penalty (cp) low-rated bots apply to backward/retreating quiet moves. */
  backwardPenalty: number;
  /** Bonus (cp) for moves that fit the bot's current plan — creates intent. */
  planWeight: number;
}

export const PERSONAS: Persona[] = [
  {
    id: 'willow',
    name: 'Willow',
    elo: 600,
    avatar: '🌱',
    blurb: 'Loves checks and captures. Forgets about your threats.',
    depth: 5,
    multipv: 14,
    baseTemp: 260,
    blunderAwareness: 0.3,
    checkCaptureBias: 30,
    backwardPenalty: 25,
    planWeight: 35,
  },
  {
    id: 'sage',
    name: 'Sage',
    elo: 1000,
    avatar: '🦉',
    blurb: 'Knows the rules of thumb, but sharp positions get scary.',
    depth: 6,
    multipv: 12,
    baseTemp: 180,
    blunderAwareness: 0.55,
    checkCaptureBias: 20,
    backwardPenalty: 15,
    planWeight: 30,
  },
  {
    id: 'marcus',
    name: 'Marcus',
    elo: 1400,
    avatar: '🎯',
    blurb: 'Club player. Has plans, follows them, sometimes too long.',
    depth: 8,
    multipv: 10,
    baseTemp: 120,
    blunderAwareness: 0.75,
    checkCaptureBias: 8,
    backwardPenalty: 6,
    planWeight: 22,
  },
  {
    id: 'elena',
    name: 'Elena',
    elo: 1800,
    avatar: '⚡',
    blurb: 'Punishes loose moves. Rarely blunders outright.',
    depth: 10,
    multipv: 8,
    baseTemp: 70,
    blunderAwareness: 0.92,
    checkCaptureBias: 0,
    backwardPenalty: 0,
    planWeight: 12,
  },
  {
    id: 'viktor',
    name: 'Viktor',
    elo: 2200,
    avatar: '👑',
    blurb: 'Near-master strength with a human touch of imprecision.',
    depth: 13,
    multipv: 6,
    baseTemp: 18,
    blunderAwareness: 0.985,
    checkCaptureBias: 0,
    backwardPenalty: 0,
    planWeight: 6,
  },
];
