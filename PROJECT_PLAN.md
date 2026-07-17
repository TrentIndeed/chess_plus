# Chess Plus — Project Plan

A chess.com-style app focused on **playing bots** (no human matchmaking) with two big differentiators:

1. **Human-like bots** at selectable Elo levels that strategize, have intent, and make *plausibly imperfect* moves — not chess.com's "play perfectly, then randomly blunder" behavior.
2. **Built-in teaching**, free: a coach that explains your moves (especially midgame ideas) right after you play them, plus a checkmate-puzzle trainer.

---

## 1. Goals & Non-Goals

### Goals
- Play full games against bots at a chosen strength (roughly 400–2500 Elo).
- Bots feel human: they follow plans, punish mistakes proportionally to their level, and their errors are *graded* (inaccuracies and mistakes, not just perfect-or-blunder).
- After each of your moves, get instant feedback: move classification (best / good / inaccuracy / mistake / blunder), what the better idea was, and *why* in plain language — with emphasis on midgame concepts (piece activity, pawn structure, king safety, plans).
- Checkmate puzzle mode (mate in 1/2/3), sourced from the free Lichess puzzle database, with progress tracking.
- Runs entirely in the browser for the MVP (no server costs, no accounts needed to start).

### Non-Goals (for now)
- Human vs. human play, matchmaking, chat.
- Real rated Elo / anti-cheat.
- Mobile native apps (responsive web first).
- Opening courses, video lessons, or other chess.com premium content beyond the coach + puzzles.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite | Fast dev loop, huge ecosystem |
| Board UI | `react-chessboard` (or Lichess's `chessground` for extra polish) | Drag/drop, arrows, highlights out of the box |
| Rules/state | `chess.js` | Legal move generation, FEN/PGN, check/mate detection |
| Engine | Stockfish compiled to WASM (`stockfish.wasm` / `lila-stockfish-web`), run in a **Web Worker** | Free, strong, runs client-side; worker keeps UI smooth |
| Human-like play | Custom "humanizer" layer on top of Stockfish MultiPV (see §3); optionally **Maia** weights later | This is our core IP |
| Puzzles | Lichess puzzle DB (CC0 CSV, ~4M puzzles) filtered to mate themes, pre-processed into static JSON chunks | Free, high quality, already Elo-rated |
| Coach text | Rule-based explanation engine first; optional LLM (Claude API) upgrade behind a flag | Deterministic + free by default, richer prose if a key is provided |
| Persistence | `localStorage` / IndexedDB for MVP; optional backend (Supabase or small Node/Postgres) later for accounts | Ship fast, add sync when needed |

Everything above is open source or free-licensed. Stockfish is GPLv3 — keep it in a worker as a separate distributable and the repo GPL-compatible (or dynamically load official builds).

---

## 3. The Human-Like Bot (core feature)

### The problem with chess.com bots
They run a strong engine and limit strength by occasionally injecting a random blunder. The result: the bot plays like a 2800 for six moves, then hangs a queen. Real 1200s don't do that — they play *consistently mediocre* moves, miss quiet tactics, follow simple plans, and blunder more in complex positions than simple ones.

### Our approach: layered move selection

**Layer 1 — Candidate generation (Stockfish MultiPV).**
Run Stockfish with `MultiPV = 8–15` at modest depth to get the top N moves *with evaluations*. This gives a realistic candidate set — humans also only consider a handful of moves.

**Layer 2 — Softmax selection with Elo-tuned temperature.**
Pick from candidates with probability `softmax(eval_i / T)`, where temperature `T` scales with (2500 − targetElo). A 1900 bot mostly plays top-2 moves with occasional inaccuracies; a 900 bot regularly plays the 4th–8th best move. This alone already produces *graded* errors — many small ones, few catastrophic ones — matching real human eval-loss distributions.

**Layer 3 — Human plausibility filters/biases (what makes it feel human).**
Adjust candidate weights before sampling:
- **Intent/plan persistence:** the bot maintains a current *plan* (e.g., "kingside attack", "trade into a winning endgame", "improve worst piece", "queenside pawn storm") chosen from position features (pawn structure, king positions, material). Moves consistent with the active plan get a weight bonus; the plan is re-evaluated every few moves or when the eval swings. This creates visible intent across moves instead of move-by-move noise.
- **Complexity-dependent error:** measure position sharpness (eval spread across candidates, number of hanging pieces, checks/captures available). Higher complexity → higher temperature. Humans blunder in sharp positions, not quiet ones.
- **Human move biases by rating band:** low-rated bots over-prefer checks, captures, and queen moves, and under-see backward moves, long quiet moves, and defensive resources. High-rated bots lose these biases.
- **Blunder realism check:** if the sampled move loses instantly to a one-move refutation (e.g., hangs a piece to a simple capture), give the bot a rating-scaled chance to "see it" and resample. This kills the "randomly hangs the queen" artifact while still allowing believable blunders in complicated positions.
- **Time-to-move pacing:** think longer on critical positions, snap-move recaptures. Purely cosmetic, big realism payoff.

**Layer 4 (later) — Maia integration.**
[Maia](https://maiachess.com) is an open-source neural net trained to *predict human moves* at specific rating bands (1100–1900). Options: run Maia via lc0-WASM or export to ONNX and use `onnxruntime-web`. Best architecture: use Maia's policy as the *prior* over candidate moves and Stockfish evals as the *safety/quality* signal — blend the two. This is the state of the art for human-like play, but it's a heavy lift, so it's a post-MVP milestone; Layers 1–3 get 80% of the feel.

**Calibration:** validate each bot level by playing automated matches between adjacent levels (expect ~64% score for +100 Elo) and by comparing average centipawn loss per game against real human data from the Lichess database at each rating band. Tune temperature/bias parameters per level until both match.

---

## 4. The Coach (teaching mid-game, after each move)

Pipeline after every user move:

1. **Background analysis** (second Stockfish worker so the bot's thinking isn't blocked): eval before the move, eval after, best move, and the refutation line if the move was bad.
2. **Classification** by centipawn loss with win-percentage scaling (like Lichess): Best / Great / Good / Inaccuracy / Mistake / Blunder. Also detect "Missed win" and "Missed mate".
3. **Explanation engine** — turn the analysis into words. Rule-based detectors, roughly in priority order:
   - Tactics: hanging piece, missed fork/pin/skewer/discovered attack, back-rank weakness, missed mate-in-N.
   - **Midgame concepts (the focus):** undeveloped pieces, moving the same piece twice in the opening, weakening the king's pawn shield, creating backward/isolated/doubled pawns, giving up an outpost, wrong-side castling into an attack, trading your good bishop, opening files toward your own king, ignoring the opponent's threat.
   - Plans: "Your knight on f3 has no future; rerouting via e1–d3 targets the c5 hole" style advice generated from piece-mobility and pawn-structure features.
4. **Delivery UX:** a coach sidebar with a short verdict + expandable "show me" that draws arrows/highlights on the board and can play out the better line. Toggle between "coach on every move," "only warn on mistakes," and "off" (post-game review only).
5. **Post-game review:** accuracy score, eval graph, list of key moments, replayable with coach commentary.
6. **Optional LLM mode:** feed the structured analysis (never the raw position alone) to Claude to produce friendlier, more specific prose. Strictly optional and keyed by the user — the rule-based engine is the default.

---

## 5. Checkmate Puzzles

- Preprocess the Lichess puzzle CSV offline (script in `tools/`): filter themes `mateIn1`, `mateIn2`, `mateIn3`, keep FEN + solution moves + rating, bucket by rating into static JSON chunks shipped with the app.
- Puzzle UI reuses the game board component; validate the user's moves against the solution line, auto-play the opponent's replies.
- Progression: streaks, per-bucket completion, an adaptive "puzzle rating" (simple Elo update per solve/fail) stored locally.
- Later: themed sets (back-rank mates, smothered mates) — the Lichess data already tags these.

---

## 6. Architecture

```
┌────────────────────────── Browser ──────────────────────────┐
│  React UI                                                   │
│  ├─ GamePage ── Board ── MoveList ── CoachPanel             │
│  ├─ PuzzlePage ── Board ── PuzzleControls                   │
│  └─ BotPicker / Settings / GameReview                       │
│                                                             │
│  Core (pure TS, fully unit-testable, no React)              │
│  ├─ game/        chess.js wrapper, PGN, clocks              │
│  ├─ bot/         humanizer: candidates → plan bias →        │
│  │               temperature sampling → blunder check       │
│  ├─ coach/       classification + explanation rules         │
│  └─ puzzles/     loader, validator, rating tracker          │
│                                                             │
│  Workers                                                    │
│  ├─ engine-bot.worker.ts    (Stockfish — bot's moves)       │
│  └─ engine-analysis.worker.ts (Stockfish — coach analysis)  │
│                                                             │
│  Storage: IndexedDB (games, puzzle progress, settings)      │
└─────────────────────────────────────────────────────────────┘
```

Key decision: **two engine instances** so coaching analysis never delays the bot, and the `bot/` and `coach/` modules are pure functions over engine output — easy to unit test with canned MultiPV data, no engine needed in CI.

---

## 7. Milestones

**M0 — Scaffold (small):** Vite + React + TS, board renders, you can move pieces legally against yourself. CI with lint/test.

**M1 — Play vs. engine:** Stockfish worker wired up, raw strength levels via depth/skill-level caps, full game loop (mate/draw detection, resign, new game, PGN export).

**M2 — Humanizer v1 (the differentiator):** MultiPV candidates + temperature sampling + blunder-realism check + move pacing. 5–6 bot personas at distinct Elo targets. Calibration harness (bot-vs-bot matches, centipawn-loss comparison) as a script.

**M3 — Coach v1:** second worker, move classification, top ~15 rule-based explanations (tactics + midgame concepts), coach sidebar with arrows, post-game accuracy summary.

**M4 — Puzzles:** preprocessing script, mate-in-1/2/3 trainer, local progress + puzzle rating.

**M5 — Depth & polish:** plan-persistence layer for bots (visible intent), more explanation rules, full game review page with eval graph, bot personalities (aggressive/positional/endgame-grinder via bias presets), settings.

**M6 — Stretch:** Maia integration, optional accounts/sync backend, optional LLM coach prose, opening-mistake coaching.

Each milestone is shippable and demoable on its own.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Humanizer doesn't feel human (too random / too strong) | Calibration harness from day one (M2); compare centipawn-loss distributions against real Lichess games per rating band; playtest early |
| WASM engine performance on weak devices | Modest depths are fine for bot play (we're *limiting* strength anyway); single-threaded fallback build; cap MultiPV |
| Explanation engine says wrong/obvious things | Only surface an explanation when a detector fires with high confidence; fall back to showing the better line without prose |
| Stockfish GPL vs. app licensing | Keep engine as a separately-loaded worker asset; make the repo GPL-compatible (simplest: license the whole project GPLv3) |
| Puzzle DB size (~4M rows) | Offline preprocessing to small JSON chunks; ship only mate puzzles, lazy-load buckets |
| Scope creep toward chess.com parity | Non-goals list above; bots + coach + puzzles only until M5 is done |

---

## 9. Proposed Repo Structure

```
chess_plus/
├─ src/
│  ├─ components/        # Board, CoachPanel, MoveList, ...
│  ├─ pages/             # Game, Puzzles, Review, Home
│  ├─ core/
│  │  ├─ game/
│  │  ├─ bot/            # humanizer lives here
│  │  ├─ coach/
│  │  └─ puzzles/
│  ├─ workers/
│  └─ storage/
├─ public/engine/        # stockfish wasm assets
├─ tools/                # puzzle preprocessing, bot calibration scripts
└─ tests/
```

---

## 10. Open Questions

- Target Elo range for launch personas? (Suggest: 600, 1000, 1400, 1800, 2200.)
- Coach tone: terse and technical vs. friendly-teacher? (Affects explanation templates.)
- Chessground (Lichess look/feel, steeper API) vs. react-chessboard (simpler)? Suggest starting with react-chessboard and swapping later if needed — keep board behind our own component.
- Do we want time controls in v1, or untimed games only? (Untimed suggested for MVP; bots still *pace* their replies for realism.)
