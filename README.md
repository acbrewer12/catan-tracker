# Catan Tracker

A phone-first web app to use at the table during a game of Catan: enter the
board, track everyone's pieces and the robber, log dice rolls and your cards,
and get placement and strategy suggestions.

Fan-made helper. Not affiliated with or endorsed by the game's publisher, and it
uses no official artwork.

**Live site:** https://acbrewer12.github.io/catan-tracker/

## Status

| Feature | Status |
| --- | --- |
| App foundation, shared game-state model, saving to the browser, undo | done |
| Board input: tiles, numbers, harbors; 3-4 and 5-6 player boards | done |
| Players: names, colours, turn order, which one is you | done |
| Settlements, cities, roads, robber tracking | planned |
| Dice log, what each roll gives you, your cards, opponents' estimated hands | planned |
| Starting-placement and strategy suggestions | planned |

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # model + reducer tests (vitest)
npm run check    # type check + lint + tests, run this before pushing
npm run build    # static site in dist/
```

Every push to `main` is tested and deployed to GitHub Pages by
`.github/workflows/deploy.yml`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model and how to add a feature.
