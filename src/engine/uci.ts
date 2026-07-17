/**
 * Thin UCI client for a Stockfish WASM worker (single-threaded build copied
 * to /public/engine by tools/copy-engine.mjs).
 */

export interface EngineLine {
  multipv: number;
  /** Centipawns from the perspective of the side to move in the analyzed position. */
  scoreCp: number | null;
  /** Moves to mate (positive = mover mates, negative = mover gets mated). */
  mate: number | null;
  /** First move of the PV, in UCI. */
  moveUci: string;
  pv: string[];
  depth: number;
}

export interface AnalysisResult {
  lines: EngineLine[];
  bestUci: string | null;
}

export class Engine {
  private worker: Worker;
  private lineHandler: ((line: string) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e: MessageEvent) => {
      const text = typeof e.data === 'string' ? e.data : '';
      if (text && this.lineHandler) this.lineHandler(text);
    };
  }

  static async create(): Promise<Engine> {
    const res = await fetch('/engine/manifest.json');
    if (!res.ok) throw new Error('engine manifest missing — run npm install');
    const { worker } = (await res.json()) as { worker: string };
    const engine = new Engine(new Worker(`/engine/${worker}`));
    await engine.init();
    return engine;
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs = 30_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const prev = this.lineHandler;
      const timer = setTimeout(() => {
        this.lineHandler = prev;
        reject(new Error('engine timeout'));
      }, timeoutMs);
      this.lineHandler = (line) => {
        prev?.(line);
        if (predicate(line)) {
          clearTimeout(timer);
          this.lineHandler = prev;
          resolve();
        }
      };
    });
  }

  private async init(): Promise<void> {
    const uciok = this.waitFor((l) => l.startsWith('uciok'));
    this.send('uci');
    await uciok;
    const ready = this.waitFor((l) => l.startsWith('readyok'));
    this.send('isready');
    await ready;
  }

  /**
   * Analyze a position. Calls are serialized per engine instance — a second
   * analyze() waits for the first to finish.
   */
  analyze(fen: string, depth: number, multipv: number): Promise<AnalysisResult> {
    const run = async (): Promise<AnalysisResult> => {
      const lines = new Map<number, EngineLine>();
      let bestUci: string | null = null;

      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.lineHandler = null;
          reject(new Error('analysis timeout'));
        }, 120_000);
        this.lineHandler = (line) => {
          if (line.startsWith('info ') && line.includes(' pv ')) {
            const parsed = parseInfo(line);
            if (parsed) {
              const existing = lines.get(parsed.multipv);
              if (!existing || parsed.depth >= existing.depth) lines.set(parsed.multipv, parsed);
            }
          } else if (line.startsWith('bestmove')) {
            const m = line.split(/\s+/)[1];
            bestUci = m && m !== '(none)' ? m : null;
            clearTimeout(timer);
            this.lineHandler = null;
            resolve();
          }
        };
      });

      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      await done;

      const sorted = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
      return { lines: sorted, bestUci };
    };

    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  dispose() {
    this.worker.terminate();
  }
}

function parseInfo(line: string): EngineLine | null {
  const tokens = line.split(/\s+/);
  let multipv = 1;
  let depth = 0;
  let scoreCp: number | null = null;
  let mate: number | null = null;
  let pv: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    switch (tokens[i]) {
      case 'depth':
        depth = Number(tokens[++i]);
        break;
      case 'multipv':
        multipv = Number(tokens[++i]);
        break;
      case 'score':
        if (tokens[i + 1] === 'cp') scoreCp = Number(tokens[i + 2]);
        else if (tokens[i + 1] === 'mate') mate = Number(tokens[i + 2]);
        i += 2;
        break;
      case 'pv':
        pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
    }
  }
  if (pv.length === 0) return null;
  return { multipv, depth, scoreCp, mate, moveUci: pv[0], pv };
}
