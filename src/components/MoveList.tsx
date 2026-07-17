import { Fragment } from 'react';
import { Verdict } from '../core/coach/classify';
import { VerdictBadge } from './verdictBadge';

export interface MoveRow {
  san: string;
  verdict: Verdict | null;
}

export function MoveList({ moves }: { moves: MoveRow[] }) {
  const pairs: [MoveRow | null, MoveRow | null][] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push([moves[i] ?? null, moves[i + 1] ?? null]);
  }
  if (pairs.length === 0) return <div className="muted">Make a move to begin.</div>;
  return (
    <div className="movelist">
      {pairs.map(([w, b], i) => (
        <Fragment key={i}>
          <div className="num">{i + 1}.</div>
          <Cell row={w} latest={moves.length === i * 2 + 1} />
          <Cell row={b} latest={moves.length === i * 2 + 2} />
        </Fragment>
      ))}
    </div>
  );
}

function Cell({ row, latest }: { row: MoveRow | null; latest: boolean }) {
  if (!row) return <div />;
  return (
    <div className={`moveitem${latest ? ' latest' : ''}`}>
      {row.san}
      {row.verdict && <VerdictBadge verdict={row.verdict} />}
    </div>
  );
}
