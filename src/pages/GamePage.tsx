import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, Move } from 'chess.js';
import { BoardView } from '../components/BoardView';
import { PlayerBar } from '../components/PlayerBar';
import { MoveList, MoveRow } from '../components/MoveList';
import { VerdictBadge, VERDICT_STYLE } from '../components/verdictBadge';
import { Engine } from '../engine/uci';
import { PERSONAS, Persona } from '../core/bot/personas';
import { Candidate, chooseMove, mateToCp } from '../core/bot/humanizer';
import { Plan, pickPlan } from '../core/bot/plans';
import { judgeMove, Verdict } from '../core/coach/classify';
import { explainMove } from '../core/coach/explain';
import {
  recognizeOpening,
  getOpeningLine,
  lessonStep,
  POPULAR_OPENINGS,
  PopularOpening,
} from '../core/openings/book';
import { detectEndgame, EndgameState } from '../core/endgame/guide';

type Phase = 'picker' | 'loading' | 'playing' | 'over';
type TimeControl = 'blitz' | 'normal' | 'unlimited';

const TIME_MS: Record<Exclude<TimeControl, 'unlimited'>, number> = {
  blitz: 5 * 60_000,
  normal: 10 * 60_000,
};

interface ChatMsg {
  id: number;
  san?: string;
  verdict?: Verdict;
  text: string;
  /** Retrospective better move — revealed only on click (never for the current position). */
  better?: string | null;
  revealed?: boolean;
}

interface GameStats {
  accuracies: number[];
  counts: Record<string, number>;
  hintsUsed: number;
}

const PIECE_NAME: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const OPENING_PICK_INFO: Record<PopularOpening, { color: 'w' | 'b'; tag: string }> = {
  'London System': { color: 'w', tag: 'as White · solid system' },
  'Italian Game': { color: 'w', tag: 'as White · classical play' },
  'Sicilian Defense': { color: 'b', tag: 'as Black · fights 1.e4' },
};

export function GamePage() {
  const gameRef = useRef(new Chess());
  const botEngine = useRef<Engine | null>(null);
  const coachEngine = useRef<Engine | null>(null);
  const planRef = useRef<Plan | null>(null);
  const sessionRef = useRef(0);
  const clocksRef = useRef<{ w: number; b: number }>({ w: 0, b: 0 });
  const lastTickRef = useRef(0);
  const chatIdRef = useRef(0);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const endgameRef = useRef<EndgameState | null>(null);
  // Dedupe refs so chat commentary fires once per event, not per render.
  const openingNameRef = useRef<string | null>(null);
  const openingDevPlyRef = useRef(-1);
  const lessonPromptPlyRef = useRef(-1);
  const lessonDevPlyRef = useRef(-1);
  const lessonCompleteRef = useRef(false);
  const endgameTypeRef = useRef<string | null>(null);
  const endgameNarrationRef = useRef('');
  const stalemateWarnFenRef = useRef('');
  const fiftyWarnedRef = useRef(false);
  const hintRef = useRef<{ ply: number; level: number }>({ ply: -1, level: 0 });

  const [phase, setPhase] = useState<Phase>('picker');
  const [persona, setPersona] = useState<Persona>(PERSONAS[1]);
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [colorChoice, setColorChoice] = useState<'w' | 'b' | 'random'>('w');
  const [coachOn, setCoachOn] = useState(true);
  const [timeControl, setTimeControl] = useState<TimeControl>('normal');
  const [learnOpening, setLearnOpening] = useState<PopularOpening | null>(null);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [rows, setRows] = useState<MoveRow[]>([]);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [clocks, setClocks] = useState<{ w: number; b: number }>({ w: 0, b: 0 });
  const [result, setResult] = useState<string | null>(null);
  const [stats, setStats] = useState<GameStats>({ accuracies: [], counts: {}, hintsUsed: 0 });
  const [engineError, setEngineError] = useState<string | null>(null);

  const history = gameRef.current.history({ verbose: true }) as Move[];

  const pushChat = useCallback((msg: Omit<ChatMsg, 'id'>) => {
    setChat((c) => [...c, { ...msg, id: chatIdRef.current++ }]);
  }, []);

  useEffect(() => {
    const el = chatBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

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

  /** Chat commentary that runs after ANY move: openings, lesson, endgame. */
  const afterAnyMove = useCallback(
    (movedByPlayer: boolean) => {
      const g = gameRef.current;
      const sans = g.history();

      if (learnOpening) {
        const line = getOpeningLine(learnOpening);
        if (line) {
          const step = lessonStep(line, sans);
          if (step.status === 'deviated' && lessonDevPlyRef.current !== step.atPly) {
            lessonDevPlyRef.current = step.atPly;
            if (step.deviatedBy === playerColor) {
              pushChat({
                text: `📖 In the ${learnOpening}, the book move was ${step.expectedSan}${step.idea ? ` — ${step.idea}` : '.'} We've left the study line, so play on general principles now.`,
              });
            } else {
              pushChat({
                text: `📖 ${persona.name} left the ${learnOpening} main line (book was ${step.expectedSan}). That's normal — keep developing and watch what their move changed.`,
              });
            }
          } else if (step.status === 'complete' && !lessonCompleteRef.current) {
            lessonCompleteRef.current = true;
            pushChat({ text: `🎓 That's the full ${learnOpening} main line — well studied! From here it's a real game.` });
          } else if (
            step.status === 'in-line' &&
            step.nextColor === playerColor &&
            lessonPromptPlyRef.current !== step.ply
          ) {
            lessonPromptPlyRef.current = step.ply;
            pushChat({
              text: `📖 ${learnOpening} — the book move here is ${step.nextSan}${step.nextIdea ? `: ${step.nextIdea}` : '.'}`,
            });
          }
        }
      } else {
        // Passive recognition when nothing is being studied.
        const status = recognizeOpening(sans);
        if (status.name && openingNameRef.current !== status.name) {
          openingNameRef.current = status.name;
          pushChat({
            text: `📖 This is the ${status.name}.${status.lastIdea ? ` ${status.lastIdea}` : ''}`,
          });
        }
        if (
          movedByPlayer &&
          status.deviation &&
          status.deviation.atPly === sans.length - 1 &&
          openingDevPlyRef.current !== status.deviation.atPly
        ) {
          openingDevPlyRef.current = status.deviation.atPly;
          pushChat({
            text: `📖 Theory here was ${status.deviation.expectedSan}${status.deviation.idea ? ` — ${status.deviation.idea}` : '.'} Your move is playable, just no longer book.`,
          });
        }
      }

      const eg = detectEndgame(g);
      endgameRef.current = eg;
      if (eg) {
        if (eg.type !== endgameTypeRef.current) {
          endgameTypeRef.current = eg.type;
          endgameNarrationRef.current = eg.narration;
          const mine = eg.strongSide === playerColor;
          pushChat({
            text: mine
              ? `🏁 ${eg.title}. ${eg.technique[0]} ${eg.narration}`
              : `🏁 Basic mate territory — defend as long as you can and watch for stalemate chances.`,
          });
        } else if (eg.strongSide === playerColor && eg.narration !== endgameNarrationRef.current) {
          endgameNarrationRef.current = eg.narration;
          pushChat({ text: `📍 ${eg.narration}` });
        }
        if (
          eg.strongSide === playerColor &&
          eg.stalemateWarning &&
          stalemateWarnFenRef.current !== g.fen()
        ) {
          stalemateWarnFenRef.current = g.fen();
          pushChat({
            text: '⚠️ Careful — the defending king is nearly out of squares. Before your next move, make sure it still has one (or that you give check). Stalemate throws the win away.',
          });
        }
        if (eg.strongSide === playerColor && eg.fiftyMoveClock >= 70 && !fiftyWarnedRef.current) {
          fiftyWarnedRef.current = true;
          pushChat({
            text: `⏳ The 50-move rule is approaching (${100 - eg.fiftyMoveClock} half-moves left). Make progress: shrink the box, bring your king up.`,
          });
        }
      } else {
        endgameTypeRef.current = null;
      }
    },
    [learnOpening, playerColor, persona, pushChat],
  );

  const botMove = useCallback(async () => {
    const g = gameRef.current;
    const session = sessionRef.current;
    if (g.isGameOver() || !botEngine.current) return;
    setThinking(true);

    const applyBotMove = (san: string) => {
      const mv = g.move(san);
      setFen(g.fen());
      setLastMove({ from: mv.from, to: mv.to });
      setRows((r) => [...r, { san: mv.san, verdict: null }]);
      afterAnyMove(false);
      finishIfOver();
    };

    try {
      // When studying an opening, the bot cooperates: it plays its side of
      // the chosen line (usually), so the student gets real practice.
      if (learnOpening) {
        const line = getOpeningLine(learnOpening);
        const step = line ? lessonStep(line, g.history()) : null;
        if (step && step.status === 'in-line' && step.nextColor === g.turn() && Math.random() < 0.9) {
          await new Promise((r) => setTimeout(r, 500 + Math.random() * 700));
          if (session !== sessionRef.current) return;
          applyBotMove(step.nextSan);
          return;
        }
      }

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

      // Pace realistically, but never burn the clock in timed games.
      let cap = timeControl === 'blitz' ? 1800 : 4000;
      if (timeControl !== 'unlimited') {
        const left = clocksRef.current[g.turn()];
        if (left < 60_000) cap = Math.min(cap, 700);
        if (left < 15_000) cap = Math.min(cap, 200);
      }
      await new Promise((r) => setTimeout(r, Math.min(choice.thinkMs, cap)));
      if (session !== sessionRef.current) return;
      const uci = choice.move;
      const mv = g.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      g.undo();
      applyBotMove(mv.san);
    } catch (e) {
      console.error('bot move failed', e);
      const fallback = g.moves();
      if (fallback.length > 0 && session === sessionRef.current) applyBotMove(fallback[0]);
    } finally {
      if (session === sessionRef.current) setThinking(false);
    }
  }, [persona, learnOpening, timeControl, afterAnyMove, finishIfOver]);

  const analyzePlayerMove = useCallback(
    async (beforeFen: string, sansBefore: string[], played: Move, ply: number) => {
      if (!coachEngine.current) return;
      const session = sessionRef.current;
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

        setRows((rows) =>
          rows.map((row, i) => (i === ply ? { ...row, verdict: judgment.verdict } : row)),
        );
        setStats((s) => ({
          ...s,
          accuracies: [...s.accuracies, judgment.accuracy],
          counts: { ...s.counts, [judgment.verdict]: (s.counts[judgment.verdict] ?? 0) + 1 },
        }));
        // Quiet coach: good moves just get their badge; notes appear when
        // there's something to learn.
        const teachable = ['inaccuracy', 'mistake', 'blunder', 'missed-mate'].includes(
          judgment.verdict,
        );
        if (teachable && explanation.notes.length > 0) {
          pushChat({
            san: played.san,
            verdict: judgment.verdict,
            text: explanation.notes.join('\n'),
            better: explanation.betterMove,
            revealed: false,
          });
        }
      } catch (e) {
        console.error('coach analysis failed', e);
      }
    },
    [pushChat],
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
      afterAnyMove(true);
      if (coachOn) void analyzePlayerMove(beforeFen, sansBefore, mv, ply);
      if (!finishIfOver()) void botMove();
      return true;
    },
    [phase, playerColor, thinking, coachOn, analyzePlayerMove, botMove, finishIfOver, afterAnyMove],
  );

  // Clock: real elapsed time is charged to whoever's turn it is.
  useEffect(() => {
    if (phase !== 'playing' || timeControl === 'unlimited') return;
    lastTickRef.current = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      const turn = gameRef.current.turn();
      clocksRef.current[turn] = Math.max(0, clocksRef.current[turn] - delta);
      setClocks({ ...clocksRef.current });
      if (clocksRef.current[turn] === 0) {
        sessionRef.current++;
        setThinking(false);
        setResult(
          turn === playerColor
            ? `You ran out of time — ${persona.name} wins`
            : `${persona.name} ran out of time — you win!`,
        );
        setPhase('over');
      }
    }, 200);
    return () => clearInterval(iv);
  }, [phase, timeControl, playerColor, persona]);

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
    endgameRef.current = null;
    openingNameRef.current = null;
    openingDevPlyRef.current = -1;
    lessonPromptPlyRef.current = -1;
    lessonDevPlyRef.current = -1;
    lessonCompleteRef.current = false;
    endgameTypeRef.current = null;
    endgameNarrationRef.current = '';
    stalemateWarnFenRef.current = '';
    fiftyWarnedRef.current = false;
    hintRef.current = { ply: -1, level: 0 };
    chatIdRef.current = 0;
    const color = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice;
    setPlayerColor(color);
    setFen(gameRef.current.fen());
    setRows([]);
    setChat([]);
    setLastMove(null);
    setResult(null);
    setStats({ accuracies: [], counts: {}, hintsUsed: 0 });
    const base = timeControl === 'unlimited' ? 0 : TIME_MS[timeControl];
    clocksRef.current = { w: base, b: base };
    setClocks({ w: base, b: base });
    setPhase('playing');
    setChat([
      {
        id: chatIdRef.current++,
        text: `👋 You're playing ${persona.name} (${persona.elo})${
          timeControl !== 'unlimited' ? `, ${timeControl === 'blitz' ? '5 min blitz' : '10 min'}` : ''
        }.${learnOpening ? ` We're studying the ${learnOpening} — I'll walk you through the line.` : ''}${
          coachOn ? ' I’ll comment after your moves — never before.' : ''
        } Good luck!`,
      },
    ]);
    if (color === 'b') void botMove();
    else if (learnOpening) {
      // First lesson prompt for White before any move is made.
      const line = getOpeningLine(learnOpening);
      const step = line ? lessonStep(line, []) : null;
      if (step && step.status === 'in-line' && step.nextColor === color) {
        lessonPromptPlyRef.current = step.ply;
        setChat((c) => [
          ...c,
          {
            id: chatIdRef.current++,
            text: `📖 ${learnOpening} — the book move here is ${step.nextSan}${step.nextIdea ? `: ${step.nextIdea}` : '.'}`,
          },
        ]);
      }
    }
  }, [colorChoice, timeControl, learnOpening, coachOn, persona, botMove]);

  /**
   * Hints never reveal a move for the current position — that would be
   * cheating. Level 1 is a concept, level 2 points at a piece. That's it.
   */
  const requestHint = useCallback(async () => {
    const g = gameRef.current;
    if (phase !== 'playing' || g.turn() !== playerColor || !coachEngine.current) return;
    const ply = g.history().length;
    if (hintRef.current.ply !== ply) hintRef.current = { ply, level: 0 };
    if (hintRef.current.level >= 2) {
      pushChat({ text: '💡 That’s all the help I’ll give for this move — the rest is yours.' });
      return;
    }
    const level = ++hintRef.current.level;
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
      if (level === 1) {
        const eg = endgameRef.current;
        if (eg && eg.strongSide === playerColor) text = `💡 ${eg.narration}`;
        else if (best.captured) text = '💡 There’s a tactical capture available — count attackers and defenders on the contested squares.';
        else if (best.san.includes('+')) text = '💡 Your checks deserve a look here.';
        else text = '💡 Nothing forcing — improve your least active piece, and re-check what your opponent’s last move attacks.';
      } else {
        text = `💡 Think about your ${PIECE_NAME[best.piece]} on ${best.from}. Where does it want to be?`;
      }
      setStats((s) => ({ ...s, hintsUsed: s.hintsUsed + 1 }));
      pushChat({ text });
    } catch (e) {
      console.error('hint failed', e);
    }
  }, [phase, playerColor, pushChat]);

  const resign = useCallback(() => {
    if (phase !== 'playing') return;
    sessionRef.current++;
    setThinking(false);
    setResult(`You resigned — ${persona.name} wins`);
    setPhase('over');
  }, [phase, persona]);

  const reveal = useCallback((id: number) => {
    setChat((c) => c.map((m) => (m.id === id ? { ...m, revealed: true } : m)));
  }, []);

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
            Time
            <span className="seg">
              {(
                [
                  ['blitz', 'Blitz · 5 min'],
                  ['normal', 'Normal · 10 min'],
                  ['unlimited', 'Unlimited'],
                ] as const
              ).map(([tc, label]) => (
                <button key={tc} className={timeControl === tc ? 'on' : ''} onClick={() => setTimeControl(tc)}>
                  {label}
                </button>
              ))}
            </span>
          </label>
          <label>
            Play as
            <span className="seg">
              {(['w', 'random', 'b'] as const).map((c) => (
                <button key={c} className={colorChoice === c ? 'on' : ''} onClick={() => setColorChoice(c)}>
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
        <div className="sub" style={{ marginBottom: 8 }}>
          Study an opening (optional) — the coach walks you through the line and the bot plays along:
        </div>
        <div className="opening-row">
          <button
            className={`opening-card${learnOpening === null ? ' selected' : ''}`}
            onClick={() => setLearnOpening(null)}
          >
            <div className="name">Free play</div>
            <div className="tag">no study line</div>
          </button>
          {POPULAR_OPENINGS.map((name) => (
            <button
              key={name}
              className={`opening-card${learnOpening === name ? ' selected' : ''}`}
              onClick={() => {
                setLearnOpening(name);
                setColorChoice(OPENING_PICK_INFO[name].color);
              }}
            >
              <div className="name">{name}</div>
              <div className="tag">{OPENING_PICK_INFO[name].tag}</div>
            </button>
          ))}
        </div>
        <button className="btn primary big" onClick={() => void startGame()} disabled={phase === 'loading'}>
          {phase === 'loading' ? 'Loading engine…' : 'Play'}
        </button>
        {engineError && (
          <div className="muted" style={{ marginTop: 12 }}>
            Engine failed to load: {engineError}
          </div>
        )}
      </div>
    );
  }

  const avgAccuracy =
    stats.accuracies.length > 0
      ? stats.accuracies.reduce((a, b) => a + b, 0) / stats.accuracies.length
      : null;
  const showClocks = timeControl !== 'unlimited';
  const botColor = playerColor === 'w' ? 'b' : 'w';

  return (
    <>
      <div className="board-col">
        <PlayerBar
          name={persona.name}
          rating={persona.elo}
          avatar={persona.avatar}
          history={history}
          color={botColor}
          thinking={thinking}
          clockMs={showClocks ? clocks[botColor] : null}
          clockActive={phase === 'playing' && gameRef.current.turn() === botColor}
        />
        <BoardView
          fen={fen}
          orientation={playerColor === 'w' ? 'white' : 'black'}
          onDrop={onDrop}
          lastMove={lastMove}
          draggable={phase === 'playing'}
        />
        <PlayerBar
          name="You"
          rating={null}
          avatar="🙂"
          history={history}
          color={playerColor}
          clockMs={showClocks ? clocks[playerColor] : null}
          clockActive={phase === 'playing' && gameRef.current.turn() === playerColor}
        />
      </div>

      <div className="panel">
        <div className="panel-head">
          vs {persona.name} ({persona.elo})
          {learnOpening && <span className="panel-tag">📖 {learnOpening}</span>}
        </div>
        <div className="moves-scroll">
          <MoveList moves={rows} />
        </div>
        <div className="chat" ref={chatBoxRef}>
          {chat.map((m) => (
            <div className="bubble" key={m.id}>
              {m.verdict && (
                <div className="coach-verdict" style={{ color: VERDICT_STYLE[m.verdict].color }}>
                  <VerdictBadge verdict={m.verdict} />
                  {m.san}: {VERDICT_STYLE[m.verdict].word}
                </div>
              )}
              <div style={{ whiteSpace: 'pre-line' }}>{m.text}</div>
              {m.better != null &&
                (m.revealed ? (
                  <div className="coach-better">
                    Better was <b>{m.better}</b>
                  </div>
                ) : (
                  <button className="btn small" onClick={() => reveal(m.id)}>
                    Show what was better
                  </button>
                ))}
            </div>
          ))}
        </div>
        <div className="panel-actions">
          <button
            className="btn"
            onClick={() => void requestHint()}
            disabled={phase !== 'playing' || gameRef.current.turn() !== playerColor}
          >
            Hint
          </button>
          <button className="btn" onClick={resign} disabled={phase !== 'playing'}>
            Resign
          </button>
          <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => setPhase('picker')}>
            New Game
          </button>
        </div>
      </div>

      {phase === 'over' && result && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{result}</h2>
            <div className="sub">
              vs {persona.name} ({persona.elo})
            </div>
            {avgAccuracy != null && (
              <div style={{ textAlign: 'left', marginBottom: 14 }}>
                <div className="stat-row">
                  <span>Your accuracy</span>
                  <b>{avgAccuracy.toFixed(1)}%</b>
                </div>
                {Object.entries(stats.counts).map(([v, n]) => (
                  <div className="stat-row" key={v}>
                    <span>{VERDICT_STYLE[v as keyof typeof VERDICT_STYLE]?.word ?? v}</span>
                    <b>{n}</b>
                  </div>
                ))}
                {stats.hintsUsed > 0 && (
                  <div className="stat-row">
                    <span>Hints used</span>
                    <b>{stats.hintsUsed}</b>
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
