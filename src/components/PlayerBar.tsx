import { Move } from 'chess.js';

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const CAPTURE_GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };

interface Props {
  name: string;
  rating: number | null;
  avatar: string;
  /** Full verbose history — captures BY this color are shown. */
  history: Move[];
  color: 'w' | 'b';
  thinking?: boolean;
}

export function PlayerBar({ name, rating, avatar, history, color, thinking }: Props) {
  const mine = history.filter((m) => m.color === color && m.captured);
  const theirs = history.filter((m) => m.color !== color && m.captured);
  const captured = mine
    .map((m) => m.captured!)
    .sort((a, b) => PIECE_VALUE[a] - PIECE_VALUE[b]);
  const diff =
    mine.reduce((a, m) => a + PIECE_VALUE[m.captured!], 0) -
    theirs.reduce((a, m) => a + PIECE_VALUE[m.captured!], 0);

  return (
    <div className="playerbar">
      <div className="avatar">{avatar}</div>
      <div>
        <span className="name">{name}</span>
        {rating != null && <span className="rating">({rating})</span>}
      </div>
      <div className="captures">{captured.map((p) => CAPTURE_GLYPH[p]).join('')}</div>
      {diff > 0 && <div className="mat">+{diff}</div>}
      {thinking && <div className="thinking">thinking…</div>}
    </div>
  );
}
