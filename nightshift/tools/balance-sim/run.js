// Runs every configuration in parallel workers and aggregates.
// node run.js --rounds 300 --out results/baseline.json [--sim ./build/sim.js] [--tuning '{"decay":1.5}'] [--ns 1,2,3,4] [--profiles casual,skilled,clumsy] [--policies reckless,caution]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

function parseArgs() {
  const a = process.argv.slice(2), o = { rounds: 300, out: 'results/out.json', sim: './build/sim.js', tuning: null, ns: [1, 2, 3, 4], profiles: ['casual', 'skilled', 'clumsy'], policies: ['reckless', 'caution'], workers: 4, seedBase: 1000 };
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, ''), v = a[i + 1];
    if (k === 'rounds' || k === 'workers' || k === 'seedBase') o[k] = Number(v);
    else if (k === 'ns') o.ns = v.split(',').map(Number);
    else if (k === 'profiles' || k === 'policies') o[k] = v.split(',');
    else if (k === 'tuning') o.tuning = JSON.parse(v);
    else o[k] = v;
  }
  return o;
}

if (!isMainThread) {
  const { simPath, tuning, jobs, dt } = workerData;
  const simUrl = pathToFileURL(path.resolve(simPath)).href;
  const mod = await import(simUrl);
  if (tuning) { const tmod = await import(pathToFileURL(path.resolve(path.dirname(simPath), 'tuning.js')).href); tmod.applyTuning(tuning); }
  const { runRound } = await import('./harness.js');
  const out = [];
  for (const j of jobs) out.push(runRound(mod.Sim, { ...j, dt }));
  parentPort.postMessage(out);
} else {
  await main();
}

async function main() {
  const o = parseArgs();
  const configs = [];
  for (const n of o.ns) for (const profile of o.profiles) for (const policy of o.policies) configs.push({ n, profile, policy });
  const jobs = [];
  configs.forEach((c, ci) => { for (let r = 0; r < o.rounds; r++) jobs.push({ ...c, seed: o.seedBase + ci * 100000 + r }); });
  // round-robin split
  const chunks = Array.from({ length: o.workers }, () => []);
  jobs.forEach((j, i) => chunks[i % o.workers].push(j));
  const t0 = Date.now();
  const results = (await Promise.all(chunks.map(ch => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { simPath: o.sim, tuning: o.tuning, jobs: ch, dt: 1 / 30 } });
    w.on('message', res); w.on('error', rej); w.on('exit', c => { if (c !== 0) rej(new Error('worker exit ' + c)); });
  })))).flat();
  console.error(`ran ${results.length} rounds in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const summary = configs.map(c => summarize(results.filter(r => r.n === c.n && r.profile === c.profile && r.policy === c.policy)));
  mkdirSync(path.dirname(o.out), { recursive: true });
  writeFileSync(o.out, JSON.stringify({ args: o, summary }, null, 1));
  console.log(formatTables(summary));
}

function pct(arr, p) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const i = Math.min(s.length - 1, Math.floor(p * s.length)); return s[i]; }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN; }
function r1(x) { return Math.round(x * 10) / 10; }

export function summarize(rs) {
  const S = { n: rs[0].n, profile: rs[0].profile, policy: rs[0].policy, rounds: rs.length };
  const chaos = rs.map(r => r.chaos);
  S.chaos = { mean: r1(mean(chaos)), p10: r1(pct(chaos, 0.1)), p50: r1(pct(chaos, 0.5)), p90: r1(pct(chaos, 0.9)) };
  S.chaosPerPlayer = r1(mean(chaos) / S.n);
  S.bustRate = r1(100 * mean(rs.map(r => r.busted ? 1 : 0)));
  S.endTime = r1(mean(rs.map(r => r.endTime)));
  S.bustTime = r1(mean(rs.filter(r => r.busted).map(r => r.endTime)));
  const stir = rs.filter(r => r.firstStir !== null), pat = rs.filter(r => r.firstPatrol !== null);
  S.stir = { pctRounds: r1(100 * stir.length / rs.length), meanT: r1(mean(stir.map(r => r.firstStir))) };
  S.patrol = { pctRounds: r1(100 * pat.length / rs.length), meanT: r1(mean(pat.map(r => r.firstPatrol))), secondsPerRound: r1(mean(rs.map(r => r.patrolSeconds))) };
  S.peakSusp = r1(mean(rs.map(r => r.peakSusp)));
  S.tFirstObj = r1(mean(rs.filter(r => r.tFirstObj !== null).map(r => r.tFirstObj)));
  S.tAll3 = r1(mean(rs.filter(r => r.tAll3 !== null).map(r => r.tAll3)));
  S.sprays = { mean: r1(mean(rs.map(r => r.sprays))), p90: pct(rs.map(r => r.sprays), 0.9) };
  const od = rs.map(r => r.objDone.length);
  S.objectives = { mean: r1(mean(od)), dist: [0, 1, 2, 3].map(k => r1(100 * od.filter(x => x === k).length / rs.length)), all3pct: r1(100 * rs.filter(r => r.objDone.length === r.objectives.length).length / rs.length), boardSize: r1(mean(rs.map(r => r.objectives.length))) };
  const per = {};
  for (const r of rs) for (const o of r.objProgress) { per[o.id] ??= { offered: 0, done: 0, prog: 0 }; per[o.id].offered++; if (o.done) per[o.id].done++; per[o.id].prog += o.progress / o.target; }
  S.perObjective = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { offered: v.offered, donePct: r1(100 * v.done / v.offered), meanProgress: r1(100 * v.prog / v.offered) }]));
  // chaos / noise attribution: mean per round
  const cb = {}, nb = {}, cnt = {};
  for (const r of rs) {
    for (const [k, v] of Object.entries(r.stats.chaosBy)) cb[k] = (cb[k] || 0) + v / rs.length;
    for (const [k, v] of Object.entries(r.stats.noiseBy)) nb[k] = (nb[k] || 0) + v / rs.length;
    for (const [k, v] of Object.entries(r.stats.counts)) cnt[k] = (cnt[k] || 0) + v / rs.length;
  }
  S.chaosBy = Object.fromEntries(Object.entries(cb).map(([k, v]) => [k, r1(v)]));
  S.noiseBy = Object.fromEntries(Object.entries(nb).map(([k, v]) => [k, r1(v)]));
  S.counts = Object.fromEntries(Object.entries(cnt).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  // time shares (per player, as % of round time)
  const tt = { walk: 0, mg: 0, hide: 0, vent: 0, idle: 0, stunned: 0 };
  for (const r of rs) for (const k of Object.keys(tt)) tt[k] += r.stats.time[k] / (r.endTime * r.n) / rs.length;
  S.timePct = Object.fromEntries(Object.entries(tt).map(([k, v]) => [k, r1(100 * v)]));
  // suspicion trajectory
  const nb30 = Math.ceil(240 / 30); S.susp = [];
  for (let b = 0; b < nb30; b++) {
    let sum = 0, cnt2 = 0, alive = 0;
    for (const r of rs) if (r.suspCnt[b]) { sum += r.suspSum[b]; cnt2 += r.suspCnt[b]; alive++; }
    S.susp.push({ t: b * 30, mean: cnt2 ? r1(sum / cnt2) : null, alivePct: r1(100 * alive / rs.length) });
  }
  return S;
}

export function formatTables(summary) {
  const L = [];
  const pad = (s, w) => String(s).padStart(w);
  const padE = (s, w) => String(s).padEnd(w);
  const row = (cells, ws) => cells.map((c, i) => (i === 0 ? padE(c, ws[i]) : pad(c, ws[i]))).join(' ');
  L.push('== Outcome by configuration ==');
  const ws = [22, 7, 7, 7, 7, 8, 6, 8, 8, 8, 8, 6, 7, 7, 7];
  L.push(row(['config', 'chaos', 'p10', 'p90', 'c/plr', 'bust%', 'tEnd', 'stir%', 'tStir', 'patrol%', 'tPatrol', 'spray', 'obj/3', 'all3%', 'tAll3'], ws));
  for (const s of summary) L.push(row([`${s.n}p ${s.profile} ${s.policy}`, s.chaos.mean, s.chaos.p10, s.chaos.p90, s.chaosPerPlayer, s.bustRate, s.endTime, s.stir.pctRounds, s.stir.meanT, s.patrol.pctRounds, s.patrol.meanT, s.sprays.mean, s.objectives.mean, s.objectives.all3pct, s.tAll3], ws));
  L.push('');
  L.push('== Time use (% of player-seconds) and action counts per round ==');
  const ws2 = [22, 6, 6, 6, 6, 6, 7, 6, 6, 7, 7, 7, 7, 7];
  L.push(row(['config', 'walk', 'mg', 'hide', 'vent', 'idle', 'stun', 'vent#', 'shove', 'groomTry', 'groomOK', 'pillow', 'pick', 'pickOK'], ws2));
  for (const s of summary) L.push(row([`${s.n}p ${s.profile} ${s.policy}`, s.timePct.walk, s.timePct.mg, s.timePct.hide, s.timePct.vent, s.timePct.idle, s.timePct.stunned, s.counts.vent, s.counts.shove, s.counts.groomAttempt, s.counts.groom_ok || 0, s.counts.pillow, s.counts.pickAttempt, s.counts.pick_ok || 0], ws2));
  L.push('');
  L.push('== Objective completion % (offered rounds) ==');
  const ids = ['knock3', 'cabinet', 'mouse', 'tp', 'stare', 'hairball', 'zoomies2', 'vent', 'lick'];
  L.push(row(['config', ...ids], [22, ...ids.map(() => 9)]));
  for (const s of summary) L.push(row([`${s.n}p ${s.profile} ${s.policy}`, ...ids.map(id => s.perObjective[id] ? s.perObjective[id].donePct : '-')], [22, ...ids.map(() => 9)]));
  L.push('');
  L.push('== Chaos per round by source (mean) ==');
  const keys = ['swipe_ok', 'swipe_smash', 'swipe_timeout', 'pick_ok', 'pick_fail', 'rug_ok', 'rug_meh', 'tp_ok', 'tp_fail', 'stare_ok', 'stare_fail', 'zoomies', 'pillow', 'groom_ok', 'groom_squirm', 'groom_bap', 'vent', 'objective', 'spray', 'bust'];
  const short = k => k.replace('swipe_', 'sw_').replace('stare_', 'st_').replace('groom_', 'gr_').replace('objective', 'objctv').replace('timeout', 'tout');
  L.push(row(['config', ...keys.map(short)], [22, ...keys.map(() => 7)]));
  for (const s of summary) L.push(row([`${s.n}p ${s.profile} ${s.policy}`, ...keys.map(k => s.chaosBy[k] ?? 0)], [22, ...keys.map(() => 7)]));
  L.push('');
  L.push('== Suspicion (noise) added per round by source (mean) ==');
  const nkeys = keys.filter(k => !['vent', 'objective', 'spray', 'bust'].includes(k));
  L.push(row(['config', ...nkeys.map(short)], [22, ...nkeys.map(() => 7)]));
  for (const s of summary) L.push(row([`${s.n}p ${s.profile} ${s.policy}`, ...nkeys.map(k => s.noiseBy[k] ?? 0)], [22, ...nkeys.map(() => 7)]));
  L.push('');
  L.push('== Mean suspicion by 30s bucket (alive rounds only; alive% in brackets) ==');
  L.push(row(['config', ...summary[0].susp.map(b => `${b.t}s`)], [22, ...summary[0].susp.map(() => 11)]));
  for (const s of summary) L.push(row([`${s.n}p ${s.profile} ${s.policy}`, ...s.susp.map(b => b.mean === null ? '-' : `${b.mean}[${Math.round(b.alivePct)}]`)], [22, ...s.susp.map(() => 11)]));
  return L.join('\n');
}
