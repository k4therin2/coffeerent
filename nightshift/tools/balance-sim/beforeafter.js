import { readFileSync } from 'node:fs';
const files = process.argv.slice(2); const J = files.map(f => JSON.parse(readFileSync(f, 'utf8')));
const names = files.map(f => f.replace(/^.*\//, '').replace('.json', ''));
const pad = (s, w) => String(s).padStart(w), padE = (s, w) => String(s).padEnd(w);
const metrics = [['chaos/plr', s => s.chaosPerPlayer], ['bust%', s => s.bustRate], ['hide%', s => s.timePct.hide], ['sprays', s => s.sprays.mean], ['allObj%', s => s.objectives.all3pct], ['tAllObj', s => s.tAll3], ['patrol s', s => s.patrol.secondsPerRound]];
for (const [m, f] of metrics) {
  console.log(`\n${m}: ` + names.join(' | '));
  console.log([padE('config', 22), ...names.map(n => pad(n, 9))].join(' '));
  for (let i = 0; i < J[0].summary.length; i++) { const s0 = J[0].summary[i]; console.log([padE(`${s0.n}p ${s0.profile} ${s0.policy}`, 22), ...J.map(j => pad(f(j.summary[i]), 9))].join(' ')); }
}
