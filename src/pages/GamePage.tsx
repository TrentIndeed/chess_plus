import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, Move } from 'chess.js';
import { BoardView, Arrow } from '../components/BoardView';
import { PlayerBar } from '../components/PlayerBar';
import { MoveList, MoveRow } from '../components/MoveList';
import { VerdictBadge, VERDICT_STYLE } from '../components/verdictBadge';
import { Engine } from '../engine/uci';
import { PERSONAS, Persona } from '../core/bot/personas';
import { Candidate, chooseMove, mateToCp } from '../core/bot/humanizer';
import { Plan, pickPlan } from '../core/bot/plans';
import { judgeMove, Judgment } from '../core/coach/classify';
import { explainMove } from '../core/coach/explain';
import { recognizeOpening, OpeningStatus } from '../core/openings/book';
import { detectEndgame, EndgameState } from '../core/endgame/guide';

type Phase = 'picker' | 'loading' | 'playing' | 'over';
type Tab = 'moves' | 'coach' | 'opening' | 'endgame';

interface CoachReport {
  ply: number;
  san: string;
  judgment: Judgment;
  notes: string[];
  betterMove: string | null;
  showBetter: boolean;
}

interface GameStats {
  accuracies: number[];
  counts: Record<string, number>;
  moveHintsUsed: number;
}

const PIECE_NAME: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

export function GamePage() {
  const gameRef = useRef(new Chess());
  const botEngine = useRef<Engine | null>(null);
  const coachEngine = useRef<Engine | null>(null);
  const planRef = useRef<Plan | null>(null);
  const sessionRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('picker');
  const [persona, setPersona] = useState<Persona>(PERSONAS[1]);
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [colorChoice, setColorChoice] = useState<'w' | 'b' | 'random'>('w');
  const [coachOn, setCoachOn] = useState(true);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [rows, setRows] = useState<MoveRow[]>([]);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [tab, setTab] = useState<Tab>('moves');
  const [report, setReport] = useState<CoachReport | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [opening, setOpening] = useState<OpeningStatus | null>(null);
  const [endgame, setEndgame] = useState<EndgameState | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [stats, setStats] = useState<GameStats>({ accuracies: [], counts: {}, moveHintsUsed: 0 });
  const [hint, setHint] = useState<{ level: number; text: string; arrow: Arrow | null } | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  const history = gameRef.current.history({ verbose: true }) as Move[];

  const finishIfOver = useCallback((): boolean => {
    const g = gameRef.current;
    if (!g.isGameOver()) return false;
    let text: string;
    if (g.isCheckmate()) {
      text = g.turn() === playerColor ? `Checkmate — ${persona.name} wins` : 'Checkmate — you win!';
    } else if (g.isStalemate()) text = 'Draw by stalemate';
    else if (g.isThreefoldRepetition()) text = 'Draw by repetition';
    else if (g.isInsufficientMaterial()) text = 'Draw — insufficient material';
    else text = 'Draw by fifty-move rule';
    setResult(text);
    setPhase('over');
    return true;
  }, [playerColor, persona]);

  const refreshSidecars = useCallback(() => {
    const g = gameRef.current;
    setOpening(recognizeOpening(g.history()));
    setEndgame(detectEndgame(g));
  }, []);

  const botMove = useCallback(async () => {
    const g = gameRef.current;
    const session = sessionRef.current;
    if (g.isGameOver() || !botEngine.current) return;
    setThinking(true);
    try {
      const analysis = await botEngine.current.analyze(g.fen(), persona.depth, persona.multipv);
      if (session !== sessionRef.current) return;
      const cands: Candidate[] = analysis.lines
        .map((l) => ({
          move: l.moveUci,
          scoreCp: l.mate != null ? mateToCp(l.mate) : (l.scoreCp ?? 0),
        }))
        .sort((a, b) => b.scoreCp - a.scoreCp);
      if (cands.length === 0) return;
      if (planRef.current === null || g.history().length % 4 === 0) {
        planRef.current = pickPlan(g, planRef.current);
      }
      const choice = chooseMove(cands, persona, g, planRef.current, Math.random);
      await new Promise((r) => setTimeout(r, choice.thinkMs));
      if (session !== sessionRef.current) return;
      const mv = g.move({
        from: choice.move.slice(0, 2),
        to: choice.move.slice(2, 4),
        promotion: choice.move.length > 4 ? choice.move[4] : undefined,
      });
      setFen(g.fen());
      setLastMove({ from: mv.from, to: mv.to });
      setRows((r) => [...r, { san: mv.san, verdict: null }]);
      refreshSidecars();
      finishIfOver();
    } catch (e) {
      console.error('bot move failed', e);
      // Engine hiccup: play any legal move rather than freezing the game.
      const fallback = g.moves({ verbose: true })[0];
      if (fallback && session === sessionRef.current) {
        g.move(fallback);
        setFen(g.fen());
        setRows((r) => [...r, { san: fallback.san, verdict: null }]);
        finishIfOver();
      }
    } finally {
      if (session === sessionRef.current) setThinking(false);
    }
  }, [persona, finishIfOver, refreshSidecars]);

  const analyzePlayerMove = useCallback(
    async (beforeFen: string, sansBefore: string[], played: Move, ply: number) => {
      if (!coachEngine.current) return;
      const session = sessionRef.current;
      setCoachBusy(true);
      try {
        const playedUci = played.from + played.to + (played.promotion ?? '');
        const analysis = await coachEngine.current.analyze(beforeFen, 11, 3);
        if (session !== sessionRef.current) return;
        const top = analysis.lines[0];
        if (!top) return;
        const bestCp = top.mate != null ? mateToCp(top.mate) : (top.scoreCp ?? 0);
        const bestMate = top.mate ?? null;

        const inLines = analysis.lines.find((l) => l.moveUci === playedUci);
        let playedCp: number;
        let playedMate: number | null = null;
        let refutationUci: string | null = null;
        if (inLines) {
          playedCp = inLines.mate != null ? mateToCp(inLines.mate) : (inLines.scoreCp ?? 0);
          playedMate = inLines.mate ?? null;
          refutationUci = inLines.pv[1] ?? null;
        } else {
          // Evaluate the position after the move (opponent to move) and negate.
          const afterGame = new Chess(beforeFen);
          afterGame.move({ from: played.from, to: played.to, promotion: played.promotion });
          if (afterGame.isGameOver()) {
            playedCp = afterGame.isCheckmate() ? mateToCp(1) : 0;
          } else {
            const after = await coachEngine.current.analyze(afterGame.fen(), 10, 1);
            if (session !== sessionRef.current) return;
            const reply = after.lines[0];
            playedCp = reply ? (reply.mate != null ? -mateToCp(reply.mate) : -(reply.scoreCp ?? 0)) : 0;
            playedMate = reply?.mate != null && reply.mate < 0 ? -reply.mate : null;
            refutationUci = after.bestUci;
          }
        }

        const sans = [...sansBefore, played.san];
        const judgment = judgeMove({
          bestCp,
          playedCp,
          isEngineBest: analysis.bestUci === playedUci,
          bestMate,
          playedMate,
          isBookMove: recognizeOpening(sans).inBook,
        });

        // Rebuild the pre-move game WITH history for pattern detectors.
        const before = new Chess();
        for (const san of sansBefore) before.move(san);
        const explanation = explainMove({
          before,
          played,
          judgment,
          bestUci: analysis.bestUci,
          refutationUci,
          mateIn: bestMate != null && bestMate > 0 ? Math.ceil(bestMate / 2) : null,
        });

        setReport({
          ply,
          san: played.san,
          judgment,
          notes: explanation.notes,
          betterMove: explanation.betterMove,
          showBetter: false,
        });
        setRows((rows) =>
          rows.map((row, i) => (i === ply ? { ...row, verdict: judgment.verdict } : row)),
        );
        setStats((s) => ({
          ...s,
          accuracies: [...s.accuracies, judgment.accuracy],
          counts: { ...s.counts, [judgment.verdict]: (s.counts[judgment.verdict] ?? 0) + 1 },
        }));
        if (['mistake', 'blunder', 'missed-mate'].includes(judgment.verdict)) setTab('coach');
      } catch (e) {
        console.error('coach analysis failed', e);
      } finally {
        if (session === sessionRef.current) setCoachBusy(false);
      }
    },
    [],
  );

  const onDrop = useCallback(
    (from: string, to: string): boolean => {
      const g = gameRef.current;
      if (phase !== 'playing' || g.turn() !== playerColor || thinking) return false;
      const beforeFen = g.fen();
      const sansBefore = g.history();
      let mv: Move;
      try {
        mv = g.move({ from, to, promotion: 'q' });
      } catch {
        return false;
      }
      const ply = g.history().length - 1;
      setFen(g.fen());
      setLastMove({ from: mv.from, to: mv.to });
      setRows((r) => [...r, { san: mv.san, verdict: null }]);
      setHint(null);
      refreshSidecars();
      if (coachOn) void analyzePlayerMove(beforeFen, sansBefore, mv, ply);
      if (!finishIfOver()) void botMove();
      return true;
    },
    [phase, playerColor, thinking, coachOn, analyzePlayerMove, botMove, finishIfOver, refreshSidecars],
  );

  const startGame = useCallback(async () => {
    setPhase('loading');
    setEngineError(null);
    try {
      if (!botEngine.current) botEngine.current = await Engine.create();
      if (!coachEngine.current) coachEngine.current = await Engine.create();
    } catch (e) {
      setEngineError(String(e));
      setPhase('picker');
      return;
    }
    sessionRef.current++;
    gameRef.current = new Chess();
    planRef.current = null;
    const color = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice;
    setPlayerColor(color);
    setFen(gameRef.current.fen());
    setRows([]);
    setReport(null);
    setLastMove(null);
    setHint(null);
    setResult(null);
    setStats({ accuracies: [], counts: {}, moveHintsUsed: 0 });
    setOpening(null);
    setEndgame(null);
    setTab('moves');
    setPhase('playing');
    if (color === 'b') void botMove();
  }, [colorChoice, botMove]);

  // botMove captured at start needs latest persona — safe because persona
  // doesn't change mid-game (picker only).
  useEffect(
    () => () => {
      sessionRef.current++;
    },
    [],
  );

  const requestHint = useCallback(async () => {
    const g = gameRef.current;
    if (phase !== 'playing' || g.turn() !== playerColor || !coachEngine.current) return;
    const level = Math.min((hint?.level ?? 0) + 1, 3);
    try {
      const analysis = await coachEngine.current.analyze(g.fen(), 11, 1);
      const bestUci = analysis.bestUci;
      if (!bestUci) return;
      const probe = new Chess(g.fen());
      const best = probe.move({
        from: bestUci.slice(0, 2),
        to: bestUci.slice(2, 4),
        promotion: bestUci.length > 4 ? bestUci[4] : undefined,
      });
      let text: string;
      let arrow: Arrow | null = null;
      if (level === 1) {
        const top = analysis.lines[0];
        if (top?.mate != null && top.mate > 0) {
          text = 'You have a forced mate — examine every check.';
        } else if (best.captured) text = 'There is a capture that works tactically. Count the exchanges.';
        else if (best.san.includes('+')) text = 'Consider your checks — one of them is strong.';
        else if (endgame) text = endgame.narration;
        else text = 'No tactics here — find your least active piece and improve it.';
      } else if (level === 2) {
        text = `Look closer at your ${PIECE_NAME[best.piece]} on ${best.from}.`;
      } else {
        text = `The move is ${best.san}.`;
        arrow = { from: best.from, to: best.to, color: 'rgba(129,182,76,0.9)' };
        setStats((s) => ({ ...s, moveHintsUsed: s.moveHintsUsed + 1 }));
      }
      setHint({ level, text, arrow });
    } catch (e) {
      console.error('hint failed', e);
    }
  }, [phase, playerColor, hint, endgame]);

  const resign = useCallback(() => {
    if (phase !== 'playing') return;
    sessionRef.current++;
    setThinking(false);
    setResult(`You resigned — ${persona.name} wins`);
    setPhase('over');
  }, [phase, persona]);

  /* ---------------- Render ---------------- */

  if (phase === 'picker' || phase === 'loading') {
    return (
      <div className="picker">
        <h1>Play a Bot</h1>
        <div className="sub">
          Every bot uses human-like move selection — plans, graded mistakes, and
          rating-appropriate blind spots. No perfect-play-then-blunder.
        </div>
        <div className="bot-grid">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              className={`bot-card${p.id === persona.id ? ' selected' : ''}`}
              onClick={() => setPersona(p)}
            >
              <div className="avatar">{p.avatar}</div>
              <div className="name">{p.name}</div>
              <div className="elo">{p.elo}</div>
              <div className="blurb">{p.blurb}</div>
            </button>
          ))}
        </div>
        <div className="options-row">
          <label>
            Play as
            <span className="seg">
              {(['w', 'random', 'b'] as const).map((c) => (
                <button
                  key={c}
                  className={colorChoice === c ? 'on' : ''}
                  onClick={() => setColorChoice(c)}
                >
                  {c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random'}
                </button>
              ))}
            </span>
          </label>
          <label>
            <input type="checkbox" checked={coachOn} onChange={(e) => setCoachOn(e.target.checked)} />
            Coach my moves
          </label>
        </div>
        <button className="btn primary big" onClick={() => void startGame()} disabled={phase === 'loading'}>
          {phase === 'loading' ? 'Loading engine…' : 'Play'}
        </button>
        {engineError && <div className="muted" style={{ marginTop: 12 }}>Engine failed to load: {engineError}</div>}
      </div>
    );
  }

  const avgAccuracy =
    stats.accuracies.length > 0
      ? stats.accuracies.reduce((a, b) => a + b, 0) / stats.accuracies.length
      : null;
  const arrows: Arrow[] = hint?.arrow ? [hint.arrow] : [];

  return (
    <>
      <div className="board-col">
        <PlayerBar
          name={persona.name}
          rating={persona.elo}
          avatar={persona.avatar}
          history={history}
          color={playerColor === 'w' ? 'b' : 'w'}
          thinking={thinking}
        />
        <BoardView
          fen={fen}
          orientation={playerColor === 'w' ? 'white' : 'black'}
          onDrop={onDrop}
          lastMove={lastMove}
          arrows={arrows}
          draggable={phase === 'playing'}
        />
        <PlayerBar name="You" rating={null} avatar="🙂" history={history} color={playerColor} />
      </div>

      <div className="panel">
        <div className="tabs">
          <button className={`tab${tab === 'moves' ? ' active' : ''}`} onClick={() => setTab('moves')}>
            Moves
          </button>
          <button className={`tab${tab === 'coach' ? ' active' : ''}`} onClick={() => setTab('coach')}>
            Coach{coachBusy && <span className="dot" />}
          </button>
          <button className={`tab${tab === 'opening' ? ' active' : ''}`} onClick={() => setTab('opening')}>
            Opening{opening && opening.candidates.length > 0 && <span className="dot" />}
          </button>
          <button className={`tab${tab === 'endgame' ? ' active' : ''}`} onClick={() => setTab('endgame')}>
            Endgame{endgame && <span className="dot" />}
          </button>
        </div>
        <div className="panel-body">
          {tab === 'moves' && <MoveList moves={rows} />}
          {tab === 'coach' && (
            <CoachTab report={report} coachOn={coachOn} busy={coachBusy} onReveal={() =>
              setReport((r) => (r ? { ...r, showBetter: true } : r))
            } />
          )}
          {tab === 'opening' && <OpeningTab status={opening} />}
          {tab === 'endgame' && <EndgameTab state={endgame} />}
        </div>
        <div className="panel-actions">
          <button className="btn" onClick={() => void requestHint()} disabled={phase !== 'playing' || gameRef.current.turn() !== playerColor}>
            {hint ? `Hint (${Math.min(hint.level + 1, 3)}/3)` : 'Hint'}
          </button>
          <button className="btn" onClick={resign} disabled={phase !== 'playing'}>
            Resign
          </button>
          <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => setPhase('picker')}>
            New Game
          </button>
        </div>
        {hint && phase === 'playing' && (
          <div className="coach-note" style={{ margin: '0 14px 14px' }}>
            💡 {hint.text}
          </div>
        )}
      </div>

      {phase === 'over' && result && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{result}</h2>
            <div className="sub">vs {persona.name} ({persona.elo})</div>
            {avgAccuracy != null && (
              <div style={{ textAlign: 'left', marginBottom: 14 }}>
                <div className="stat-row">
                  <span>Your accuracy</span>
                  <b>{avgAccuracy.toFixed(1)}%</b>
                </div>
                {Object.entries(stats.counts).map(([v, n]) => (
                  <div className="stat-row" key={v}>
                    <span style={{ textTransform: 'capitalize' }}>{VERDICT_STYLE[v as keyof typeof VERDICT_STYLE]?.word ?? v}</span>
                    <b>{n}</b>
                  </div>
                ))}
                {stats.moveHintsUsed > 0 && (
                  <div className="stat-row">
                    <span>Move hints used</span>
                    <b>{stats.moveHintsUsed}</b>
                  </div>
                )}
              </div>
            )}
            <button className="btn primary big" onClick={() => setPhase('picker')}>
              New Game
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function CoachTab({
  report,
  coachOn,
  busy,
  onReveal,
}: {
  report: CoachReport | null;
  coachOn: boolean;
  busy: boolean;
  onReveal: () => void;
}) {
  if (!coachOn) {
    return <div className="muted">The coach is off for this game. It reviews your moves after you make them — it never plays for you.</div>;
  }
  if (!report) {
    return (
      <div className="muted">
        {busy ? 'Analyzing your move…' : 'After each of your moves, feedback appears here. The coach teaches — it won’t hand you moves unless you ask for an escalating hint.'}
      </div>
    );
  }
  return (
    <div>
      <div className="coach-verdict" style={{ color: VERDICT_STYLE[report.judgment.verdict].color }}>
        <VerdictBadge verdict={report.judgment.verdict} />
        {report.san}: {VERDICT_STYLE[report.judgment.verdict].word}
      </div>
      {report.notes.map((n, i) => (
        <div className="coach-note" key={i}>
          {n}
        </div>
      ))}
      {report.betterMove &&
        (report.showBetter ? (
          <div className="coach-better">
            Better was <b>{report.betterMove}</b>
          </div>
        ) : (
          <button className="btn" onClick={onReveal}>
            Show the better move
          </button>
        ))}
      {busy && <div className="muted" style={{ marginTop: 8 }}>Analyzing…</div>}
    </div>
  );
}

function OpeningTab({ status }: { status: OpeningStatus | null }) {
  if (!status || status.candidates.length === 0) {
    return <div className="muted">Play recognizable opening moves (try 1.d4 and 2.Bf4 — the London System) and the opening teacher will follow along.</div>;
  }
  return (
    <div>
      <div className="coach-verdict" style={{ color: 'var(--text)' }}>
        {status.name ?? 'Book position'}
      </div>
      {!status.name && status.inBook && (
        <div className="coach-note">
          Still in book — this could become: {status.candidates.join(', ')}.
        </div>
      )}
      {status.inBook ? (
        <>
          <div className="coach-note">✅ You’re following main-line theory ({Math.ceil(status.matchedPlies / 2)} moves deep).</div>
          {status.lastIdea && <div className="coach-note">{status.lastIdea}</div>}
        </>
      ) : (
        <>
          <div className="coach-note">
            Play left theory after {Math.ceil(status.matchedPlies / 2)} book moves — that’s not
            necessarily bad, just no longer “book.”
          </div>
          {status.deviation && (
            <div className="coach-note">
              Theory continues with <b>{status.deviation.expectedSan}</b>
              {status.deviation.idea ? ` — ${status.deviation.idea}` : '.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EndgameTab({ state }: { state: EndgameState | null }) {
  if (!state) {
    return <div className="muted">When the game reaches a basic mating endgame (K+Q, K+R, or two rooks vs. king), technique guidance appears here.</div>;
  }
  return (
    <div>
      <div className="coach-verdict" style={{ color: 'var(--text)' }}>{state.title}</div>
      <div className="coach-note">📍 {state.narration}</div>
      {state.stalemateWarning && (
        <div className="coach-note" style={{ border: '1px solid var(--blunder)' }}>
          ⚠️ Stalemate danger: the defending king is running out of squares. Before you move, make
          sure it still has one — or that you’re giving check.
        </div>
      )}
      {state.fiftyMoveClock >= 60 && (
        <div className="coach-note" style={{ border: '1px solid var(--inaccuracy)' }}>
          ⏳ {100 - state.fiftyMoveClock} half-moves left before the 50-move rule draws this. Make
          progress: shrink the box or push the king.
        </div>
      )}
      <ol style={{ paddingLeft: 20, lineHeight: 1.6, fontSize: 14 }}>
        {state.technique.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
