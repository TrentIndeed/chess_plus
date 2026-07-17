import { useEffect, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

export interface Arrow {
  from: string;
  to: string;
  color?: string;
}

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  onDrop: (from: string, to: string) => boolean;
  lastMove?: { from: string; to: string } | null;
  arrows?: Arrow[];
  draggable?: boolean;
}

/**
 * chess.com-style green board (plan §7a) with last-move + check highlights.
 * Supports both drag-and-drop and click-click moving.
 */
export function BoardView({ fen, orientation, onDrop, lastMove, arrows = [], draggable = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.floor(w));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const game = new Chess(fen);

  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { background: 'rgba(255, 255, 51, 0.4)' };
    squareStyles[lastMove.to] = { background: 'rgba(255, 255, 51, 0.4)' };
  }
  if (selected) {
    squareStyles[selected] = { background: 'rgba(255, 255, 51, 0.55)' };
    for (const m of game.moves({ square: selected as never, verbose: true })) {
      squareStyles[m.to] = {
        background: m.captured
          ? 'radial-gradient(circle, transparent 55%, rgba(0,0,0,0.25) 56%)'
          : 'radial-gradient(circle, rgba(0,0,0,0.25) 22%, transparent 23%)',
      };
    }
  }
  if (game.inCheck()) {
    const king = game
      .board()
      .flat()
      .find((s) => s && s.type === 'k' && s.color === game.turn());
    if (king) {
      squareStyles[king.square] = {
        background: 'radial-gradient(circle, rgba(250,65,45,0.75) 30%, rgba(255,255,51,0.2) 70%)',
      };
    }
  }

  const clickSquare = (square: string) => {
    if (!draggable) return;
    if (selected && selected !== square) {
      const moved = onDrop(selected, square);
      setSelected(null);
      if (moved) return;
      // Not a legal target — treat the click as a new selection if it's a piece.
    }
    const piece = game.get(square as never);
    setSelected(piece && piece.color === game.turn() && square !== selected ? square : null);
  };

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <Chessboard
        id="board"
        position={fen}
        boardWidth={width}
        boardOrientation={orientation}
        onPieceDrop={(from, to) => {
          setSelected(null);
          return onDrop(from, to);
        }}
        onSquareClick={(square) => clickSquare(square)}
        arePiecesDraggable={draggable}
        animationDuration={150}
        customDarkSquareStyle={{ backgroundColor: 'var(--dark-sq)' }}
        customLightSquareStyle={{ backgroundColor: 'var(--light-sq)' }}
        customSquareStyles={squareStyles}
        customArrows={arrows.map((a) => [a.from, a.to, a.color ?? 'var(--green)']) as never}
        customBoardStyle={{ borderRadius: '6px', boxShadow: '0 6px 18px rgba(0,0,0,0.4)' }}
      />
    </div>
  );
}
