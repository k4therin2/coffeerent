# Balance simulation harness

Headless bot simulation of `src/sim.ts` used for the balance reviews in `docs/balance/`.
Written against the first balance pass; the constants it reads now live in the `BAL`
block at the top of `src/sim.ts`, and some objective ids changed (`knock3` → `knock`,
`zoomies2` → `zoomies`), so expect to adapt `harness.js` before re-running.

Build the sim for node, then run the sweep:

```
npx tsc src/sim.ts src/map.ts src/types.ts --outDir tools/balance-sim/build \
  --module es2020 --target es2020 --moduleResolution bundler --skipLibCheck
echo '{"type":"module"}' > tools/balance-sim/build/package.json
# add .js to the relative import specifiers in build/*.js, then:
node tools/balance-sim/run.js
```

`harness.js` holds the bots (BFS pathing, statistical minigame outcomes per skill profile,
reckless vs cautious policies); `run.js` runs the 1-4 player × skill × policy grid and prints
the tables; `make-tuned.js` produces a copy of the compiled sim with every constant routed
through `tuning.js` for before/after comparisons (`beforeafter.js`, `compare.js`).
