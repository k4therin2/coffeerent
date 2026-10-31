// node compare.js results/a.json [results/b.json ...]  -> compact per-config table per file
import { readFileSync } from 'node:fs';
const pad = (s, w) => String(s).padStart(w), padE = (s, w) => String(s).padEnd(w);
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  console.log(`\n### ${f}  tuning=${JSON.stringify(j.args.tuning)}`);
  console.log([padE('config', 22), pad('chaos', 7), pad('c/plr', 6), pad('bust%', 6), pad('tEnd', 6), pad('spray', 6), pad('hide%', 6), pad('mg%', 5), pad('walk%', 6), pad('all3%', 6), pad('tAll3', 6), pad('patrol%', 8), pad('patr.s', 7), pad('peakS', 6)].join(' '));
  for (const s of j.summary) console.log([padE(`${s.n}p ${s.profile} ${s.policy}`, 22), pad(s.chaos.mean, 7), pad(s.chaosPerPlayer, 6), pad(s.bustRate, 6), pad(s.endTime, 6), pad(s.sprays.mean, 6), pad(s.timePct.hide, 6), pad(s.timePct.mg, 5), pad(s.timePct.walk, 6), pad(s.objectives.all3pct, 6), pad(s.tAll3, 6), pad(s.patrol.pctRounds, 8), pad(s.patrol.secondsPerRound, 7), pad(s.peakSusp, 6)].join(' '));
}
