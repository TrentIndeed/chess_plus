import { useCallback, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { BoardView } from '../components/BoardView';
import { PUZZLES, Puzzle } from '../core/puzzles/data';
import { bestDefense, keepsForcedMate, matingMoves } from '../core/puzzles/solver';

interface PuzzleProgress {
  index: number;
  rating: number;
  streak: number;
}

const STORAGE_KEY = 'chess-plus-puzzles';

function loadProgress(): PuzzleProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PuzzleProgress;
  } catch {
    /* fresh start */
  }
  return { index: 0, rating: 400, streak: 0 };
}

export function PuzzlePage() {
  const [progress, setProgress] = useState<PuzzleProgress>(loadProgress);
  const [attempt, setAttempt] = useState(0);
  const puzzle = PUZZLES[progress.index % PUZZLES.length];

  const advance = useCallback((solved: boolean, firstTry: boolean) => {
    setProgress((p) => {
      const next: PuzzleProgress = {
        index: p.index + 1,
        rating: Math.max(100, p.rating + (solved ? (firstTry ? 15 : 5) : -10)),
        streak: solved ? p.streak + 1 : 0,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setAttempt(0);
  }, []);

  return (
    <PuzzleBoard
      key={`${progress.index}-${attempt}`}
      puzzle={puzzle}
      number={(progress.index % PUZZLES.length) + 1}
      progress={progress}
      onNext={advance}
      onReset={() => setAttempt((a) => a + 1)}
    />
  );
}

type Status = 'solving' | 'wrong' | 'solved' | 'revealed';

function PuzzleBoard({
  puzzle,
  number,
  progress,
  onNext,
  onReset,
}: {
  puzzle: Puzzle;
  number: number;
  progress: PuzzleProgress;
  onNext: (solved: boolean, firstTry: boolean) => void;
  onReset: () => void;
}) {
  const gameRef = useRef(new Chess(puzzle.fen));
  const [fen, setFen] = useState(puzzle.fen);
  const [remaining, setRemaining] = useState(puzzle.mateIn);
  const [status, setStatus] = useState<Status>('solving');
  const [firstTry, setFirstTry] = useState(true);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [solutionSan, setSolutionSan] = useState<string | null>(null);

  const sideToMove = new Chess(puzzle.fen).turn();

  const onDrop = useCallback(
    (from: string, to: string): boolean => {
      const g = gameRef.current;
      if (status === 'solved' || status === 'revealed') return false;
      let mv;
      try {
        mv = g.move({ from, to, promotion: 'q' });
      } catch {
        return false;
      }
      setLastMove({ from: mv.from, to: mv.to });
      if (g.isCheckmate()) {
        setFen(g.fen());
        setStatus('solved');
        return true;
      }
      // Any move that keeps the forced mate counts — solver-graded, not one
      // scripted line. The defender then plays its most resilient reply.
      if (remaining > 1 && keepsForcedMate(g.fen(), remaining - 1)) {
        const defense = bestDefense(g.fen(), remaining - 1);
        if (defense) {
          const reply = g.move(defense);
          setLastMove({ from: reply.from, to: reply.to });
        }
        setFen(g.fen());
        setRemaining((r) => r - 1);
        setStatus('solving');
        return true;
      }
      // Doesn't force the mate — take it back and let them retry.
      g.undo();
      setFen(g.fen());
      setStatus('wrong');
      setFirstTry(false);
      return false;
    },
    [remaining, status],
  );

  const reveal = useCallback(() => {
    const solutions = matingMoves(gameRef.current.fen(), remaining);
    if (solutions.length > 0) setSolutionSan(solutions[0]);
    setStatus('revealed');
  }, [remaining]);

  return (
    <>
      <div className="board-col">
        <div className="puzzle-banner">
          🧩 Puzzle #{number} · {puzzle.theme} · rated ~{puzzle.rating}
        </div>
        <BoardView
          fen={fen}
          orientation={sideToMove === 'w' ? 'white' : 'black'}
          onDrop={onDrop}
          lastMove={lastMove}
          draggable={status === 'solving' || status === 'wrong'}
        />
        {status === 'solving' && (
          <div className="puzzle-banner">
            {sideToMove === 'w' ? 'White' : 'Black'} to move — mate in {remaining}
          </div>
        )}
        {status === 'wrong' && (
          <div className="puzzle-banner wrong">
            That lets the king escape — find the move that forces mate. Try again!
          </div>
        )}
        {status === 'solved' && (
          <div className="puzzle-banner solved">
            ✓ Checkmate! {firstTry ? 'Flawless.' : 'Got there.'}
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => onNext(true, firstTry)}>
              Next puzzle →
            </button>
          </div>
        )}
        {status === 'revealed' && (
          <div className="puzzle-banner">
            The key move was <b>&nbsp;{solutionSan}&nbsp;</b> — study why it traps the king.
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => onNext(false, false)}>
              Next puzzle →
            </button>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-body">
          <div className="stat-row">
            <span>Puzzle rating</span>
            <b>{progress.rating}</b>
          </div>
          <div className="stat-row">
            <span>Streak</span>
            <b>{progress.streak > 0 ? `🔥 ${progress.streak}` : '—'}</b>
          </div>
          <div className="muted" style={{ marginTop: 14 }}>
            Checkmate training: spot the forced mate. Any move that keeps the
            forced mate counts, not just one scripted line. The defender always
            plays its most resilient reply.
          </div>
        </div>
        <div className="panel-actions">
          <button className="btn" onClick={reveal} disabled={status === 'solved' || status === 'revealed'}>
            Show solution
          </button>
          <button
            className="btn"
            style={{ marginLeft: 'auto' }}
            onClick={onReset}
            disabled={status === 'solved' || status === 'revealed'}
          >
            Reset
          </button>
        </div>
      </div>
    </>
  );
}
