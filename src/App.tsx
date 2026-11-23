import { useEffect, useState } from 'react';
import { SCREENS } from './features/registry';
import { GameProvider, useGame } from './state/store';
import { ArchiveProvider, useArchive } from './state/archive';
import { hasPlay } from './model/archive';

const TAB_KEY = 'catan-tracker:tab';

function Shell() {
  const { state, undo, canUndo, dispatch } = useGame();
  const { save, archive, learning } = useArchive();
  // Re-render the screens' plans when what the planner learned changes.
  const learnKey = `${archive.settings.learn}-${archive.settings.learnSince}-${learning?.games ?? 0}`;
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
              const msg = hasPlay(state)
                ? 'Start a new game? This game is kept in Review (finish it there to record the winner). Keeps the players, clears the board.'
                : 'Start a new game? Keeps the players, clears the board and everything else.';
              if (!window.confirm(msg)) return;
              if (hasPlay(state)) save(state, null, false);
              dispatch({ type: 'game/new', keepPlayers: true });
            }}
          >
            New
          </button>
        </div>
      </header>
      <main key={learnKey}>{screen.render(setTab)}</main>
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
      <ArchiveProvider>
        <Shell />
      </ArchiveProvider>
    </GameProvider>
  );
}
