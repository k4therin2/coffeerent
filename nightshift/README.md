# Night Shift

A 1 to 4 player co-op browser game about four cats (Dorian, Bean, Melon and Ginny)
causing problems while the humans sleep. Phasmophobia-style loop: a shared objective
board, small timing minigames, a suspicion meter that wakes the human, and a
dominance side-score that only matters for bragging rights.

- Host a room, share the 4-letter code or the link, friends join from their browser.
- Peer to peer over WebRTC (PeerJS). The host's browser runs the simulation. No backend.
- You only see what is near your cat, Among Us style. Use voice chat.

## Controls

- `WASD` or arrows: move
- `E` or `Space`: interact / confirm in minigames
- Minigames tell you their own keys.

## Run locally

```
npm install
npm run dev
```

## Deploy on Vercel

This folder is a plain Vite static site. Create a Vercel project from the repo and set
**Root Directory** to `nightshift`. Framework preset: Vite. No environment variables.

## Layout

- `src/sim.ts`: host-side game rules (scoring, suspicion, the human, minigame resolution)
- `src/minigames.ts`: the client-side minigames
- `src/render.ts`: map, fog of war, HUD
- `src/map.ts`: house layout, furniture, interactables
- `src/net.ts`: PeerJS room hosting / joining
- `src/main.ts`: menu, lobby, results, client loop
