import { Verdict } from '../core/coach/classify';

export const VERDICT_STYLE: Record<Verdict, { label: string; color: string; word: string }> = {
  best: { label: '★', color: 'var(--best)', word: 'Best move' },
  excellent: { label: '!', color: 'var(--excellent)', word: 'Excellent' },
  good: { label: '✓', color: 'var(--good)', word: 'Good' },
  book: { label: '📖', color: 'var(--book)', word: 'Book move' },
  inaccuracy: { label: '?!', color: 'var(--inaccuracy)', word: 'Inaccuracy' },
  mistake: { label: '?', color: 'var(--mistake)', word: 'Mistake' },
  blunder: { label: '??', color: 'var(--blunder)', word: 'Blunder' },
  'missed-mate': { label: '✗', color: 'var(--missed)', word: 'Missed mate' },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLE[verdict];
  return (
    <span className="badge" style={{ background: s.color }} title={s.word}>
      {s.label}
    </span>
  );
}
