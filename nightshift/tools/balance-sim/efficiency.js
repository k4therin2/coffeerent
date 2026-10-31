// Per-attempt economics of each action, from a results file, grouped by profile (all N, both policies pooled).
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2] || 'results/baseline.json', 'utf8'));
const groups = { swipe: ['swipe_ok', 'swipe_smash', 'swipe_timeout'], pick: ['pick_ok', 'pick_fail'], rug: ['rug_ok', 'rug_meh'], tp: ['tp_ok', 'tp_fail'], stare: ['stare_ok', 'stare_fail'], zoomies: ['zoomies'], pillow: ['pillow'], groom: ['groom_ok', 'groom_squirm', 'groom_bap'] };
// approx seconds of player time per attempt (minigame duration from the bot model + walking share is excluded)
const secs = { swipe: 2.0, pick: 8, rug: 4.8, tp: 4.8, stare: 5.5, zoomies: 4.5, pillow: 8, groom: 6 };
const pad = (s, w) => String(s).padStart(w), padE = (s, w) => String(s).padEnd(w);
for (const prof of ['casual', 'skilled', 'clumsy']) {
  const rows = j.summary.filter(s => s.profile === prof);
  console.log(`\n### ${prof} (pooled over N=1..4, both policies; per attempt)`);
  console.log([padE('action', 9), pad('att/rnd', 8), pad('chaos/att', 10), pad('noise/att', 10), pad('chaos/noise', 12), pad('chaos/sec', 10), pad('ok%', 6)].join(' '));
  for (const [g, labels] of Object.entries(groups)) {
    let att = 0, ch = 0, no = 0, ok = 0;
    for (const s of rows) for (const l of labels) { att += s.counts[l] || 0; ch += s.chaosBy[l] || 0; no += s.noiseBy[l] || 0; if (/_ok$|^pillow$|^zoomies$/.test(l)) ok += s.counts[l] || 0; }
    if (g === 'pillow') for (const s of rows) att += 0; // pillow counted via counts.pillow
    if (g === 'pillow') { att = 0; for (const s of rows) att += s.counts.pillow; ok = att; }
    att /= rows.length; ch /= rows.length; no /= rows.length; ok /= rows.length;
    console.log([padE(g, 9), pad(att.toFixed(2), 8), pad((ch / att).toFixed(1), 10), pad((no / att).toFixed(1), 10), pad(no > 0 ? (ch / no).toFixed(2) : 'inf', 12), pad((ch / att / secs[g]).toFixed(1), 10), pad(Math.round(100 * ok / att), 6)].join(' '));
  }
  // vent: chaos per second on vent
  let ventC = 0, ventS = 0; for (const s of rows) { ventC += s.chaosBy.vent; ventS += s.timePct.vent / 100 * s.endTime * s.n; }
  console.log([padE('vent', 9), pad('-', 8), pad('-', 10), pad('0.0', 10), pad('inf', 12), pad((ventC / ventS).toFixed(1), 10), pad('-', 6)].join(' '));
}
// share of gross positive chaos by source for a few configs
console.log('\n### Share of gross positive chaos by source');
for (const s of j.summary.filter(s => s.profile === 'casual' && (s.n === 1 || s.n === 4))) {
  const pos = Object.entries(s.chaosBy).filter(([k, v]) => v > 0); const tot = pos.reduce((a, [, v]) => a + v, 0);
  console.log(`${s.n}p ${s.profile} ${s.policy}: ` + pos.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(100 * v / tot)}%`).join(', ') + `  | losses: spray ${s.chaosBy.spray}, bust ${s.chaosBy.bust}`);
}
