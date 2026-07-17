import { useState } from 'react';
import { GamePage } from './pages/GamePage';
import { PuzzlePage } from './pages/PuzzlePage';

type Page = 'play' | 'puzzles';

export default function App() {
  const [page, setPage] = useState<Page>('play');
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo">
          ♞ Chess<span>Plus</span>
        </div>
        <button className={`navbtn${page === 'play' ? ' active' : ''}`} onClick={() => setPage('play')}>
          ♟ Play
        </button>
        <button
          className={`navbtn${page === 'puzzles' ? ' active' : ''}`}
          onClick={() => setPage('puzzles')}
        >
          🧩 Puzzles
        </button>
      </nav>
      <main className="main">
        {page === 'play' && <GamePage />}
        {page === 'puzzles' && <PuzzlePage />}
      </main>
    </div>
  );
}
