# Architecture

Static client-side app: Vite + TypeScript + React. No backend. The whole game
lives in one `GameState` object, kept in React context, saved to
`localStorage` on every change, with undo.

```
src/
  model/                 pure TypeScript, no React. Easy to unit test.
    types.ts             GameState and every type in it  <- start here
    geometry.ts          hex coordinates, corner/edge IDs, topology
    layouts.ts           board shapes (standard 19, extended 30) and their counts
    board.ts             board helpers: pips, validation, random board, harbors
    model.test.ts
  state/
    store.tsx            <GameProvider>, useGame(), localStorage, undo
    reducer.ts           root reducer, routes actions to slices by prefix
    initialState.ts      newGame()
    slices/              one file per area: board, players, pieces, dice, game
  components/
    HexBoard.tsx         SVG board, reused by every screen
    theme.ts             terrain colours / icons / labels
  features/
    registry.tsx         the list of screens in the bottom tab bar
    board-input/         board entry screen
    players/             players screen
```

## The game-state model (`src/model/types.ts`)

```ts
GameState {
  version: 1                       // bump + add a step in store.migrate() when the shape changes
  phase: 'setup' | 'placement' | 'playing'
  board: { layout, hexes: Record<HexId, Hex>, ports: Port[] }
  players: Player[]                // turn order; exactly one has isMe
  pieces: { buildings: Record<VertexId, {player, kind}>, roads: Record<EdgeId, PlayerId> }
  robber: HexId | null
  diceHistory: DiceRoll[]          // oldest first
  hands: Record<PlayerId, Hand>    // { resources, unknown, devCards }
}
```

- `Hex.terrain` is a resource, `'desert'`, or `null` (not entered yet).
  `Hex.number` is 2 to 12, never 7, null on the desert.
- `cardLog` records every card movement (`CardEvent`). `hands` is rebuilt
  from it after each change, so never write `hands` directly: log an event.
  Piece actions charge build costs automatically (`syncBuilds` in
  `slices/dice.ts`). For detail beyond `hands` (min / max / expected per
  resource, dev cards left, bank) use `handEstimates`, `devCardsLeft` and
  `bankLeft` from `model/cards.ts`.
- `hands[me]` is exact. For opponents it is an estimate; `unknown` counts cards
  we know exist but can't name (for example after a steal we didn't see).

### IDs: hexes, corners, edges

Pointy-top hexes in axial coordinates.

| Thing | ID format | Example |
| --- | --- | --- |
| Hex | `"q,r"` | `"0,0"` (centre) |
| Corner (settlement / city spot) | the 3 hexes meeting there, sorted, joined by `\|` | `"0,-1\|0,0\|1,-1"` |
| Edge (road / harbor spot) | the 2 hexes on each side, sorted, joined by `\|` | `"0,0\|1,0"` |

Sea hexes count in IDs, so coastal corners and edges have IDs too. Build IDs
with `vertexIdOf` / `edgeIdOf` (never by hand) and use the topology for
everything else:

```ts
import { topologyFor } from './model/board';
const topo = topologyFor(state.board.layout);
topo.vertices[v]  // { x, y, hexes (land, 1-3), adjacent corners, edges }
topo.edges[e]     // { vertices: [a, b], hexes (land, 1-2), coastal }
topo.coast        // coastal edges in order around the island
```

Handy helpers in `model/board.ts`: `pips(n)`, `rollChance(n)`,
`hexesAtVertex(board, v)`, `vertexPips(board, v)`, `portAtVertex(board, v)`,
`desertHex(board)`, `validateBoard(board)`.

## Changing state

```ts
const { state, dispatch, undo, canUndo } = useGame();
dispatch({ type: 'pieces/setBuilding', vertex, player, kind: 'settlement' });
```

Action types are `'<slice>/<verb>'`. `reducer.ts` sends each action to the
slice named by its prefix. Reducers must be pure and return a new object (or
the same object to mean "no change", which also skips the undo entry).

Existing actions:

| Slice | Actions |
| --- | --- |
| `board` | `setLayout`, `setTerrain`, `setNumber`, `setPort`, `clear`, `randomize`, `replace` |
| `players` | `add`, `remove`, `rename`, `setColor`, `setMe`, `move` |
| `pieces` / `robber` | `pieces/setBuilding`, `pieces/removeBuilding`, `pieces/setRoad`, `pieces/removeRoad`, `robber/move` (baseline, no rule checks yet) |
| `dice` / `hands` / `cards` | `dice/add` (also logs the payout), `dice/removeLast`, `dice/remove`, `hands/set`, `cards/log`, `cards/remove` |
| `game` | `setPhase`, `new`, `load` |

## Adding a feature

1. Put the screen in `src/features/<name>/` and add one entry to
   `src/features/registry.tsx` (replace its "coming soon" placeholder).
2. Put new state changes in a slice file under `src/state/slices/` and add it
   to `Action` and `SLICES` in `src/state/reducer.ts`. Extend the baseline
   `pieces.ts` / `dice.ts` slices rather than duplicating them.
3. Put game logic (legality checks, roll payouts, scoring) in `src/model/` as
   plain functions with tests, so other features can reuse it.
4. If you add a field to `GameState`, give it a default in `newGame()` and
   handle old saves in `migrate()` in `store.tsx`.
5. Draw on the board by passing SVG children to `<HexBoard>` (positions are
   `topo.vertices[v].x * S`, `.y * S`) and use its `onVertexClick` /
   `onEdgeClick` / `onHexClick` props with `vertexFilter` / `edgeFilter` to
   offer only legal spots.
6. Run `npm run check` before pushing. Design for a phone first: tap targets of
   at least 40px, nothing that needs hover.

### Who owns what

| Area | Files |
| --- | --- |
| Foundation + board input | `model/geometry.ts`, `model/layouts.ts`, `model/board.ts`, `state/store.tsx`, `features/board-input`, `features/players` |
| Pieces + robber | `state/slices/pieces.ts`, `features/pieces/` |
| Dice, cards, hand estimates | `state/slices/dice.ts`, `features/dice/` |
| Suggestions | `model/suggestions*.ts`, `features/tips/` |

`model/types.ts`, `state/reducer.ts` and `features/registry.tsx` are shared:
keep changes there small and additive to avoid merge conflicts.

## Future board types

Layouts are data (`model/layouts.ts`): a list of land hexes plus tile, number
and harbor counts. A seafarers-style map could add `'sea'` / `'gold'` terrain
and ships on edges (`pieces.roads` would become typed road/ship pieces) without
changing the ID scheme, since sea hexes already have IDs.
