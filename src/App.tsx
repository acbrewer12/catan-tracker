import { useEffect, useState } from 'react';
import { SCREENS } from './features/registry';
import { GameProvider, useGame } from './state/store';

const TAB_KEY = 'catan-tracker:tab';

function Shell() {
  const { undo, canUndo, dispatch } = useGame();
  const [tab, setTab] = useState<string>(() => {
    try {
      return localStorage.getItem(TAB_KEY) ?? 'board';
    } catch {
      return 'board';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);
  const screen = SCREENS.find((s) => s.id === tab) ?? SCREENS[0];

  return (
    <div className="app">
      <header className="topbar">
        <h1>Catan Tracker</h1>
        <div className="row">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo">
            ↶ Undo
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              if (window.confirm('Start a new game? Keeps the players, clears the board and everything else.'))
                dispatch({ type: 'game/new', keepPlayers: true });
            }}
          >
            New
          </button>
        </div>
      </header>
      <main>{screen.render(setTab)}</main>
      <nav className="tabbar">
        {SCREENS.map((s) => (
          <button key={s.id} className={s.id === screen.id ? 'on' : ''} onClick={() => setTab(s.id)}>
            <span className="tab-icon">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <Shell />
    </GameProvider>
  );
}
