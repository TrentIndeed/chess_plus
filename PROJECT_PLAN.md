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
- Learn classic openings (London System, Italian, Queen's Gambit, etc.): the coach recognizes what you're playing, explains the ideas behind book moves, and points out when and why you've left theory.
- Endgame checkmate guidance: when you reach a won endgame (K+Q vs K, K+R vs K, two-rook ladder), the coach teaches the *technique* — concepts like "shrink the box" and "bring your king up" — instead of feeding you moves.
- **The coach is a guide, not a cheat engine** (see §4a): it teaches concepts and reviews your decisions; it never simply hands you the best move during play.
- Checkmate puzzle mode (mate in 1/2/3), sourced from the free Lichess puzzle database, with progress tracking.
- Runs entirely in the browser for the MVP (no server costs, no accounts needed to start).

### Non-Goals (for now)
- Human vs. human play, matchmaking, chat.
- Real rated Elo / anti-cheat.
- Mobile native apps (responsive web first).
- Video lessons or other chess.com premium content beyond the coach, opening teacher, endgame guide, and puzzles.
- Exhaustive opening theory — we teach ~10–15 classic systems well, not a full database.

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

### 4a. Coaching philosophy: a guide, not a cheat engine

The coach exists to make the player stronger, not to play for them. Hard rules that shape every teaching feature:

- **Feedback is retrospective by default.** The coach reacts to moves you already made. It never volunteers "play this move next" during a live game.
- **Hints are conceptual and escalate only on request.** If the player explicitly asks for help, hints go concept → piece → line: first a principle ("your king is doing nothing — endgames are won with active kings"), then a nudge ("look at your rook"), and only at the last level a concrete line — and using a line-level hint is recorded in the post-game summary so progress tracking stays honest.
- **No engine crutches during play.** No eval bar, no best-move arrows, no "engine says" readouts while a game is in progress. Those live in the post-game review only.
- **Technique over answers in endgames.** The endgame guide (§4c) teaches repeatable methods (the box method, ladder mate, opposition) rather than solving the position for you.
- Since all opponents are bots, there's no fair-play issue with other humans — this stance is purely about learning: a coach that hands out moves teaches dependence, not chess.

### 4b. Opening teacher (classic openings)

Goal: learn real openings — London System, Italian Game, Ruy Lopez, Queen's Gambit, Caro-Kann, Sicilian basics — by playing them, not memorizing them.

- **Opening book data:** build a curated book (ECO codes + move trees + per-move idea annotations) for ~10–15 classic openings. Sources: public-domain ECO classifications plus our own written annotations; Lichess opening explorer data (free API/dumps) for popularity stats. Stored as static JSON, same pattern as puzzles.
- **Recognition & narration:** during the opening phase the coach names what's on the board ("This is the London System — the point of 3.Bf4 is to develop the bishop *before* locking it in with e3") and explains the idea behind each book move as it's played, by either side.
- **Deviation feedback:** when the player leaves the book, the coach doesn't just say "theory says d4" — it explains what the book move accomplishes and what the played move gives up, using the same rule-based detectors as the midgame coach. Reasonable non-book moves are acknowledged as playable, not marked wrong.
- **Guided practice mode:** pick an opening to study; the bot plays the main-line responses (with rating-appropriate variety from sidelines) so the player can drill the system against live resistance. A "learn" sub-mode walks through the main line once with annotations before free play.
- **Repertoire tracking:** per-opening familiarity stats (how deep the player stays in book, common deviation points) feed a simple "your repertoire" page.

### 4c. Endgame checkmate guide

Goal: stop the classic beginner failure — being up a queen and shuffling into stalemate or the 50-move rule.

- **Detection:** when the game reaches a known won-mate configuration (K+Q vs K, K+R vs K, K+2R vs K; later K+2B vs K and K+B+N vs K), the coach switches into endgame-guide mode.
- **Technique teaching:** each mate type has a small scripted lesson built on its standard method — the box/shrinking-fence method for K+Q and K+R, the ladder for two rooks, opposition and king activity throughout. The coach narrates the *phase* the player is in ("the box is small enough — now bring your king to help") rather than dictating squares.
- **Guardrails, not answers:** consistent with §4a, the guide warns about the two real dangers — stalemate patterns and the 50-move counter — when the player is about to walk into them ("careful: does your opponent's king have any moves after this?" as a pre-move nudge only when a stalemating blunder is on the board and the player hovers/commits it — flagged as a "coach save" in the summary).
- **Practice drills:** standalone drill mode seeded with randomized won positions of each type; success = mate within a move budget without stalemate. This complements the puzzle trainer (§5): puzzles teach *spotting* forced mates, drills teach *converting* won endgames.

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
│  ├─ coach/       classification + explanation rules,        │
│  │               hint escalation policy (§4a)               │
│  ├─ openings/    book data, recognition, deviation feedback │
│  ├─ endgame/     mate detection, technique lessons, drills  │
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

**M3 — Coach v1:** second worker, move classification, top ~15 rule-based explanations (tactics + midgame concepts), coach sidebar with arrows, post-game accuracy summary. Guide-not-cheat rules (§4a) enforced from the start: retrospective feedback, escalating hints, no live eval bar.

**M4 — Puzzles & endgame guide:** puzzle preprocessing script, mate-in-1/2/3 trainer, local progress + puzzle rating. Endgame checkmate guide v1 (§4c): K+Q, K+R, and two-rook mates with technique narration, stalemate/50-move guardrails, and conversion drills.

**M5 — Opening teacher:** curated book for ~10 classic openings (London first), recognition + idea narration during games, deviation feedback, guided practice mode against the bots, repertoire tracking page.

**M6 — Depth & polish:** plan-persistence layer for bots (visible intent), more explanation rules, full game review page with eval graph, bot personalities (aggressive/positional/endgame-grinder via bias presets), settings.

**M7 — Stretch:** Maia integration, remaining hard mates (K+2B, K+B+N), deeper opening book coverage, optional accounts/sync backend, optional LLM coach prose.

Each milestone is shippable and demoable on its own.

---

## 7a. UI / Design Spec — chess.com parity

**Design goal: instantly familiar to a chess.com user.** We replicate the layout, color language, and interaction patterns; we do NOT copy their asset files (logo, name, "Neo" piece art, bot avatars, sound files, coach characters are copyrighted/trademarked — layout and color schemes are not). Own-made or open-licensed lookalike assets in the same style.

### Frame & theme
- Dark charcoal app background (~`#312e2b`), dark left **sidebar nav** (logo top; Play, Puzzles, Learn, Review, Settings), content area with board center-left and a context-sensitive **right panel**.
- Primary action green (~`#81b64c`) for Play/New Game buttons; muted gray secondary buttons; same rounded-card visual language.

### Board
- Default green theme: light squares ~`#ebecd0`, dark ~`#739552`; yellow last-move highlight, legal-move dots, red check flash, coordinate labels on the board edge.
- Open-licensed 2D piece set closest in feel to chess.com's default; board & piece themes user-selectable later.
- Standard sounds (move, capture, check, game end) — sourced free-licensed or self-recorded.

### Game screen
- Player bars above/below board: avatar, name, rating badge, captured pieces + material diff, clock on the right.
- Right panel: two-column move list, game controls (resign, draw, rematch, new bot), and our additions as tabs in the same panel: **Coach**, **Opening**, **Endgame Guide** — parity layout, extra tabs.
- Move-quality badges in chess.com's iconography style: brilliant (teal !!), great, best (green star), excellent, good, book, inaccuracy (yellow ?!), mistake (orange ?), blunder (red ??), missed win — shown on the destination square and beside moves in the list (post-move/review contexts only, per §4a).

### Bot picker
- Card grid of bot personas grouped by tier (Beginner → Master), each with avatar, name, Elo badge; challenge panel on the right (color choice, coach on/off, time control later). Our own characters, same layout.

### Review & puzzles
- Review: eval bar + eval graph + per-side accuracy + coach speech-bubble commentary — same structure, our teaching engine behind it.
- Puzzles/drills: centered board, prompt banner ("White to move — find the mate"), streak and rating counters.

### Differences (intentional)
- No matchmaking, social, chat, news, or premium/upsell surfaces.
- Coach panel is more prominent (teaching is the product).
- Our own branding: name, logo, bot characters, coach character.

Parity details (exact paddings, fonts) get refined by visual comparison against the live site during M0–M3; "you'd have to look twice" is the bar, pixel-perfect is polish.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Humanizer doesn't feel human (too random / too strong) | Calibration harness from day one (M2); compare centipawn-loss distributions against real Lichess games per rating band; playtest early |
| WASM engine performance on weak devices | Modest depths are fine for bot play (we're *limiting* strength anyway); single-threaded fallback build; cap MultiPV |
| Explanation engine says wrong/obvious things | Only surface an explanation when a detector fires with high confidence; fall back to showing the better line without prose |
| Stockfish GPL vs. app licensing | Keep engine as a separately-loaded worker asset; make the repo GPL-compatible (simplest: license the whole project GPLv3) |
| Puzzle DB size (~4M rows) | Offline preprocessing to small JSON chunks; ship only mate puzzles, lazy-load buckets |
| Opening annotations are hand-written (slow, needs chess knowledge) | Start with the London only (small, systemic, beginner-favorite), template the annotation format, add one opening at a time |
| Coach drifts into move-feeding as features grow | §4a rules are acceptance criteria for every teaching feature; hint-usage tracking keeps it visible |
| Scope creep toward chess.com parity | Non-goals list above; bots + coach + puzzles + opening/endgame guides only until M6 is done |
| Copying chess.com too literally (assets/branding) | §7a rule: replicate layout/colors/patterns only; all art, names, sounds, and characters are original or open-licensed |

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
│  │  ├─ openings/       # opening book + teacher
│  │  ├─ endgame/        # mate technique guide + drills
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
