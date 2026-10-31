# Night Shift: balance review

Scope: `nightshift/src/sim.ts`, `minigames.ts`, `map.ts`, `types.ts`, `main.ts` (read-only). Numbers below come from the source and from two scratch scripts (Dijkstra walk times over the real tile grid with solid furniture; a Monte Carlo of the suspicion meter). Nothing in the game was modified.

Headline findings, in order of impact:

1. Three zero-noise, zero-risk farms outscore the whole "intended" game: sitting on the vent (120 chaos/min, no input), chain-grooming (up to 500 chaos/min for 4 cats, 0 noise), and zoomies camping (120 chaos/min at a noise rate the meter decays faster than it accrues). An AFK vent cat (480/round) beats a team that completes every objective and knocks everything (about 320).
2. The suspicion meter is a shared pool fed at a rate proportional to N and drained at a constant 1.2/s. Simulated without self-throttling: 1 cat never even reaches "stirring"; 3 cats bust at ~95 s; 4 cats bust at ~55 s. It is irrelevant at N=1 and round-ending at N=3-4.
3. The human is nearly toothless at the places where cats actually stand: of 15 hotspot stand-tiles, only the pillow (2.7 s of exposure per 29 s loop), the zoomies runway (1.2 s) and the rug edge (0.1 s) are ever inside spray range with line of sight. The patrol never enters the bathroom, laundry or office at all. The spray (-15, 3 s, teleport next to the richest farm) costs less than one swipe.
4. Objectives are 3 of 9 regardless of N and are usually cleared in the first 60-90 s (30-40 s with 4 cats), leaving 150+ s of "keep causing problems" with no board.
5. The counter-swipe fail rule mixes success and failure semantics (fail = object consumed + progress + 6 chaos + 20 noise). Players are right to be confused.

---

## Part 1. What successful co-op games do (research)

### Phasmophobia (the game the README cites as the model)
- Sanity is a **per-player** meter; hunts are decided on the **team average** of living players. Passive drain is 0.12 %/s on small maps (0.08 medium, 0.05 large), multiplied by difficulty (x0.5 Training, x1 Amateur, x1.5 Intermediate, x2 Professional+). **Solo play halves the drain.** A death costs every other player 15 % sanity. Source: [Fextralife: Sanity](https://phasmophobia.wiki.fextralife.com/Sanity).
- Difficulty is a bundle, not one knob: drain multiplier, evidence count (3/3/3/2/1), setup time (300/120/0/0/0 s), hunt duration, grace period, and reward multiplier (1x/2x/3x/4x). Source: [Steam guide: The Hunter's Guide to Difficulties](https://steamcommunity.com/sharedfiles/filedetails/?id=3046189586).
- Optional objectives: exactly **3 per contract, randomized**, independent of player count; the open-ended main objective (identify the ghost) is what absorbs extra players. Sources: [fdaytalk perfect-investigation guide](https://www.fdaytalk.com/perfect-investigation-phasmophobia/), [Steam discussion on group size](https://steamcommunity.com/app/739630/discussions/0/5300214375028238777) (community reports: 2-4 players are not scaled; only hiding-spot counts change).
- Why its loop works: tension is driven by a meter that **only goes down** and whose consequence (a hunt) is a **bounded 15-30 s danger window, not a game over**. Danger is survivable with skill (hide, break line of sight), so a peak is followed by relief and the round continues.

### Overcooked
- Scoring moved from 3 lives (which made players feel they were "constantly failing") to a **fixed time limit, serve as many orders as possible; failed orders cost a small deduction**. Orders carry visible timers so the team can triage. Cooking and plating delays exist deliberately so players must task-switch, and levels are built so "there are usually more actions than players" to stop anyone settling into one repeated action. Source: [Game Developer deep dive](https://www.gamedeveloper.com/design/game-design-deep-dive-building-truly-cooperative-play-in-i-overcooked-i-).
- Order pacing scales implicitly: the queue never empties, so a bigger team simply serves more; solo has reduced score thresholds (reported by reviews, not a primary source: [Play UK review](https://www.pressreader.com/australia/play-uk-1/20180828/281741270268624)). Analysis of the "urgency, mistake, recovery" rhythm: [Overcooked: The Other as Gameplay](https://medium.com/cores-of-game-design/overcooked-the-other-as-gameplay-5a9627df0203).

### Left 4 Dead, AI Director (primary source read directly)
Booth's GDC 2009 slides ([PDF](https://cdn.fastly.steamstatic.com/apps/valve/2009/GDC2009_ReplayableCooperativeGameDesign_Left4Dead.pdf)):
- "Constant, unchanging combat is fatiguing. Long periods of inactivity are boring. Unpredictable peaks and valleys of intensity create a powerfully compelling and replayable experience."
- Algorithm: estimate each survivor's intensity (rises with damage, incapacitation, nearby kills; decays over time, **but not while enemies are engaging**), track the **max** across the team, and cycle **Build Up -> Sustain Peak (3-5 s) -> Peak Fade -> Relax (30-45 s, minimal threats)**. Peak Fade exists so the current fight can "play out without using up the entire Relax period".
- Cooperation rules: "Ensure cooperation is the only winning strategy", "Treat entire Survivor team as the player", "Penalize non-cooperative behavior harshly" but "avoid artificial/arbitrary enforcement; players rebel against overtly heavy-handed punishments."

### Deep Rock Galactic (sublinear scaling, numbers)
- Enemy health is constant; **damage resistance and enemy count** scale with hazard and player count. At Hazard 4 the enemy-count multiplier is 0.75 / 0.75 / 1.15 / 1.35 for 1/2/3/4 players; at Hazard 3 it is 0.50 / 0.50 / 0.80 / 1.10. Enemy damage at Hazard 4: 2.00 / 2.15 / 2.30 / 2.50. Large-enemy resistance at Hazard 4: 1.00 / 1.00 / 1.20 / 1.30. Pattern: **1 and 2 players are treated the same (the drone compensates), then roughly +50 % and +80 %, i.e. clearly sublinear.** Source: [DRG wiki: Difficulty Scaling](https://deeprockgalactic.wiki.gg/wiki/Difficulty_Scaling), [Creatures](https://deeprockgalactic.wiki.gg/wiki/Creatures).

### Vermintide 2
- No fixed per-player multiplier; a Conflict Director spawns dynamically against a threat budget, delaying hordes when more than 60 enemies are alive, and **bots count as players** for spawn placement. Difficulty, not player count, sets horde size. Sources: [Vermintide 2 wiki: Hordes](https://vermintide2.fandom.com/wiki/Hordes) (via search snippet), [ludo.guide director overview](https://www.ludo.guide/guide/warhammer-vermintide-2/enemy-types-weaknesses/enemy-formations-spawns/enemy-spawns-director-system). I could not reach a primary Fatshark source on count scaling; treat as community-reported.

### Among Us
- Task counts are **per crewmate** (common 0-2, long 0-3, short 0-5), so total team work scales linearly with crew size by construction; common guidance is 1 common / 1 long / 2-4 short, with fewer for beginners ("four tasks are quite a lot for beginners"). Crew vision is usually set below impostor vision (0.5-1.0x vs 1.5-1.75x) so information asymmetry, not speed, is the threat. Sources: [Among Us wiki: Options](https://among-us.fandom.com/wiki/Options), [PCGamesN settings guide](https://www.pcgamesn.com/among-us/settings-best), [Pro Game Guides](https://progameguides.com/among-us/best-settings-for-among-us/).

### General co-op scaling writing
- Decide *what* scales (health, count, pressure), whether scaling is **linear or tapers**, and whether it updates live; the main failure is overcorrection ("bullet-sponge slog at 4, unfair at 1"), which "needs playtesting at every player-count configuration". [Game Mechanics Hoard: Co-op scaling](https://gamemechanicshoard.com/mechanic/co-op-scaling/). Tabletop designers reach the same place with per-player-count pressure tokens: [BGG thread](https://boardgamegeek.com/thread/2219480/scaling-the-co-op-scenario-difficulty).
- Balance = "avoiding dominant strategies ... a play pattern that earns the highest theoretical payoff", unless the dominant strategy *is* the experience goal. [Level Design Book: Balance](https://book.leveldesignbook.com/process/combat/balance). The standard lever is to make an over-performing option more expensive rather than removing it: [Jul, Balancing Zero-Sum Games with One Variable per Strategy](https://www.cs.cornell.edu/~ajul/zerosum/zerosum.pdf).
- Scoring: let the value of a scoring move change over time and avoid runaway leaders (catch-up / upkeep): [League of Gamemakers: Scoring](https://www.leagueofgamemakers.com/game-elements-scoring/), [Games Precipice: Positional Balance](https://www.gamesprecipice.com/positional-balance/).

**Takeaways applied below:** (a) scale pressure sublinearly in N (DRG), (b) a shared meter needs its drain to depend on N or its sources to be per-player (Phasmophobia), (c) the "bust" should be a bounded danger window followed by relief, not a cliff (L4D relax, Phasmophobia hunts), (d) keep the objective queue from running dry (Overcooked), (e) normalize every action to points-per-minute-of-effort and tax the outliers rather than deleting them.

---

## Part 2. Applying it to Night Shift

### 2.1 Map facts used throughout
- Map 36x20, cat 4.6 tiles/s, human 2.6 tiles/s, fog radius 5.5 tiles, spray 3.2 tiles with LOS, interact range 1.6 (server) / 1.5 (client).
- Walk times between hotspots (Dijkstra, seconds at 4.6 t/s): the four kitchen glasses are 0.4 s apart; cabinet is 0.2 s from glass4; window/rug/vent/mug/cat bed are all within 1.0-2.2 s of each other; the far corners are expensive (pens to tp 7.4 s, water to tp 8.4 s); mouse pad to pillow 5.2 s; cat bed to the living-room farm 1.4-1.7 s. Longest corner-to-corner trip is 8.4 s = 3.5 % of a round.
- Patrol loop = 76 tiles = **29.2 s**. It visits only the hallway plus three spurs (bedroom door, kitchen door to (18.5,6.5), living room to (5.5,7.5)). Suspicion must still be >= 45 at the end of a loop to do a second one; from 60 it decays to 45 in 12.5 s, so almost every wake-up is a single 29 s lap unless cats keep adding noise.

### 2.2 Scoring action table (one cat, keyboard, including typical walk)

"Effort time" = minigame time to a result + walk to the next copy of the same action + ~1 s to read the prompt. "Sustained" = the rate if one cat repeats this action as fast as cooldowns allow (what a farmer gets). "Burst" = chaos per minute while it is available.

| Action | Chaos | Dom | Noise | Effort time | Cooldown | Burst c/min | Sustained c/min | Noise/min sustained | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Swipe, success | 15 | +4 | 5 | ~3.5 s (2.5 s bar + 0.4-1.3 s walk in kitchen) | 50 s / object, 7 objects | ~255 | ~126 (all 7 per 50 s incl. 5-6 s trips to water/pens) | 42 (all success) to 92 (40 % fails) | the "intended" core loop; good in bursts |
| Swipe, fail ("SMASH") | 6 | +1 | **20** | same | object consumed 50 s | ~100 | n/a | 1 fail = 4 successes of noise | counts toward knock3, see 2.6 |
| Swipe, timeout | 0 | 0 | 2 | 6 s | 4 s | 0 | 0 | | correct "nothing happened" case |
| Pick cabinet, solo (4 pins) | 30 | +8 | 8 | 8-14 s | 60 s | ~180 | 30 | 8 | first-timer success ~30 % |
| Pick cabinet, helper (2 pins) | 30 | +8 | 8 | 4-6 s | 60 s | ~360 | 30 | 8 | helper only needs to be within 2.5 tiles **at the start**; can leave immediately |
| Pick, fail | 0 | 0 | 5 | up to 14 s | none | 0 | | | 14 s lost |
| Hairball on rug | 5 + 20q (success ~22, fail 5-11) | +4 / 0 | 3 | ~4 s | 20 s | ~330 | **57** | 8 | never `done`; infinitely repeatable, near-zero noise |
| Unroll TP, success | 20 | +5 | 4 | ~4 s | 60 s | 300 | 20 | 4 | window 0.75-1.0 on a bar capped at 1.0: just mash to full |
| Unroll TP, fail | 4 | 0 | 2 | | 8 s | | | | hard to fail |
| Staring contest, win | 20 | **+10** | **0** | 6 s (7 s limit) | 25 s | 200 | **48** | **0** | zero skill (do nothing); window is 6.3 tiles from the patrol |
| Staring contest, lose | 0 | -3 | 6 | | 25 s | | | | only by pressing something |
| Zoomies (q ~0.9) | 30q = 27 | +6q | 2 + 10q = 11 | ~4 s kb | 10 s | ~400 | **~120** | **49 (< 72 decay)** | infinite solo loop that never wakes the human |
| Vent (sit) | **2 / s** | **1 / s** | 0 | 0 (no minigame) | none | 120 | **120** | **0** | 480 chaos + 240 dom per round for pressing E once; patrol passes 4.0 tiles away, never sprays it |
| Shove off vent | 0 | +6 / -2 victim | 0 | ~1 s | 3 s per shover | 0 | 0 | 0 | pure dominance; two cats can ping-pong for +4 net dom each per 3 s |
| Mouse to pillow | 40 | +10 | 12 | ~16 s round trip from spawn; 10.4 s pad<->pillow | mouse respawns 30 s after delivery | 150 | ~60 | 18 | only action that forces a hallway crossing; good |
| Groom, both succeed | 25 (licker) | +12 licker / -3 lickee | 0 | 6 s x 2 cats | 15 s per pair | 250 per licker | 4 cats rotating pairs: **~240 expected, 500 max, team** | **0** | second cat gets nothing but a dominance loss |
| Groom, lickee squirms | 8 | +2 | 0 | | | | | | |
| Groom, licker misses | 3 | -2 | 3 | | | | | | never negative for the team |
| Objective complete | +25 | | | | | | | | |
| All objectives | +50 | | | | | | | | |
| Spray | **-15** team and personal | -5 | 0 | 3 s stun + 1.4-8 s walk back | 1.5 s human cd | | | | teleports to cat bed, 1.4 s from rug/window/vent |
| Bust (100) | **x0.5 total**, round ends | | | | | | | | |

**Reference points.** A solo cat doing the "intended" full tour (all 7 knockables, cabinet, tp, mouse, 3 objectives + bonus) earns roughly 105 + 30 + 20 + 40 + 75 + 50 = **320**. One cat pressing E on the vent at t=0 and walking away earns **480**. Four cats grooming in the laundry room earn 1000+ with the meter at 0.

**Dominant strategies:** vent camping, groom chaining (N>=2), zoomies camping, and (mildly) the window/rug/vent living-room triangle, which is 1-2 s of walking, ~100 chaos/min, ~8 noise/min, and outside the patrol's reach. **Dead options:** the far knockables (water 5-7 s away, pens 5-8 s away, 15 chaos each: ~90 chaos/min of effort and a hallway crossing when the kitchen pays 255), solo cabinet (hard and 30/min), TP after its first use, the shove (0 chaos). The mouse delivery is fine on paper but is the only risky errand in a game where safe farms exist, so rational players skip it.

### 2.3 The suspicion economy

Sources vs drain: drain is 1.2/s = 72/min, constant. Average noise per action for a mixed "honest" play profile is about 6.5 (first-timers, 40 % swipe fails: ~7.5). Cats act at ~6-7 actions/min each (walk + read + minigame). So the team adds roughly **40-50 x N noise per minute** against a fixed 72. Noise is a shared meter; N multiplies the inflow and nothing scales the outflow. Capacity to the patrol threshold from 0 is 60 points; to the bust, 100.

Monte Carlo (300 rounds each, random action choice, no self-throttling, correct `>= 100` check):

| N | team actions/min | stirring (35) | patrol (60) | bust (100) | median peak |
|---|---|---|---|---|---|
| 1 | 6.7 | 2 % of rounds | never | never | 20 |
| 2 | 13.5 | 93 % at ~85 s | 65 % at ~150 s | 15 % at ~195 s | 71 |
| 3 | 21 | 100 % at 26 s | 100 % at 51 s | 99-100 % at ~95 s | 97 |
| 4 | 29 | 100 % at 14 s | 100 % at 28 s | 100 % at ~55 s | 97 |

(First-timer and competent profiles differ by a few seconds; the fail-noise on swipes roughly cancels the extra actions of competent play.)

Reading: at **N=1 the meter is decorative**: a solo cat cannot reach "stirring" without stringing failed swipes (three SMASHes in 10 s = 60). At **N=2** it works roughly as intended (one or two wake-ups per round). At **N=3-4 it is a brick wall**: without heavy self-throttling the round ends by bust at 55-95 s with the score halved, and after the human goes back to bed the meter is still in the 40s so the second wake-up comes within seconds. Sustainable rates: a team can take about 72 / 6.5 = **11 noisy actions per minute in total** before the meter rises, i.e. 11 per cat at N=1, 5.5 at N=2, 3.7 at N=3, 2.8 at N=4. At N=4 that is one action per cat every 22 s, i.e. mostly standing still, which pushes groups toward the zero-noise farms in 2.2.

Alternatives simulated:
- `decay = 1.2 * sqrt(N)` (1.2 / 1.7 / 2.08 / 2.4): N=4 patrol ~80 s, bust ~70 % at ~145 s, late-round meter mean ~65. Tension every round, bust avoidable with modest throttling. N=1 unchanged (still never stirs).
- `decay = 0.6 + 0.6 N` (linear): N=4 patrols only 30 % of rounds, bust 2 %. Overcorrected; the meter becomes decorative at every N.

So the drain should scale sublinearly (sqrt or DRG-style step 1/1/1.4/1.7), and solo needs a tension source that is not noise volume (see 3.1 item 6).

### 2.4 Objectives: 3 of 9 regardless of N

Time to clear each objective solo, honest play: knock3 ~12 s (kitchen chain), cabinet 8-14 s (+ retries), mouse ~16 s, tp ~4 s, stare 6 s, hairball 4-25 s (one retry), zoomies2 ~17 s (10 s cooldown between), vent 20 s, lick 6 s. A solo cat clears any 3 in about 60-90 s; four cats in 30-40 s. The +50 "all done" bonus then explicitly says "keep causing problems" for the remaining 150-200 s with nothing on the board. Phasmophobia also fixes 3 optional objectives, but its main objective is open-ended; Night Shift has no equivalent, so the board is the whole structure and it runs dry. Overcooked's answer is a queue that never empties.

Which objectives scale naturally with N and which do not:
- Scale with N (more cats, more copies of the action): knock (7 objects), zoomies and hairball (one object each, short cooldown), stare, lick (needs pairs), mouse (one mouse, 30 s respawn, but 4 cats can relay).
- Do **not** scale: vent (single occupant, so "20 s team total" takes 20 s wall-clock at any N), cabinet (one object, 60 s), tp (one object, 60 s).

Proposal (see 3.2 for exact numbers): board size = min(5, 2 + N), per-objective targets as functions of N, and a **board refill** when all are done (each new board +25 per objective, +50 clear bonus, targets escalate by one step). That keeps Overcooked's "orders never stop" structure and gives the last two minutes a purpose.

### 2.5 The human

- **Speed 2.6 vs 4.6**: cats are 77 % faster. A cat that sees the human (fog 5.5 > spray 3.2) and turns around is never caught; a cat walking toward the human closes at 7.2 t/s and has ~0.3 s between first sight and spray. So sprays happen to cats that are busy, stunned, or crossing the hallway blind, which is acceptable, but it makes the patrol a hallway toll rather than a hunt.
- **Where the human goes**: never the bathroom, laundry or office. From the hotspot exposure scan, only the pillow (2.7 s per loop), the zoomies runway (1.2 s) and the rug (0.1 s, one tile of the spur) are ever in range with LOS. Kitchen counter, cabinet, window, vent, cat bed, mouse pad, tp, water, pens: **never**. A cat mid-minigame at any of those is perfectly safe for the entire patrol.
- **Spray penalty**: -15 chaos (one swipe), -5 dom, 3 s stun, teleport to the cat bed at (1.5,7.5), which is 1.4-1.7 s from the rug/window/vent. For a living-room farmer the teleport is a free taxi; for a kitchen cat it is a 3.2 s walk back. Total cost is about 15 chaos plus 5-8 s. Against vent income of 2/s that is 15 s of camping. Not meaningful. The loss of a carried mouse and the cancelled minigame are the only parts that sting.
- **Tension and relief**: there is a build-up (stirring log line at 35, hysteresis back to asleep below 25) and a peak (toast + 29 s lap), but **no relief**: the meter keeps its value when the human lies down, and at N>=3 it is still in the 40s, so the next wake-up is seconds away. The bust is a cliff (round over, x0.5) rather than L4D's peak-fade-relax or Phasmophobia's survivable hunt. Patrol timing is also fully deterministic (same loop, same spurs), so after two rounds players know the hallway is the only danger.

### 2.6 The counter-swipe complaint

Current code (`finishMinigame`, case `swipe`): timeout -> nothing falls, 2 noise, 4 s retry. Any press -> `o.done = true`, 50 s cooldown, `progress('knock3')`; then success = 15 chaos / 5 noise / "nudged", fail = 6 chaos / 20 noise / "SMASHED". So a red "OOPS" banner is followed by objective progress and a score bump. The minigame hint ("Too hard and it shatters") intends fail = fell loudly, but the UI language (OOPS, red) and the objective tick contradict each other, and the 20 noise is the single largest noise source in the game, delivered on a red screen that the player reads as "nothing good happened".

Proposed rule, one sentence players can hold: **if it counts, it was a success; if it failed, nothing happened.**
- Hit inside the zone: it falls. 15 chaos, +4 dom, 5 noise, counts, object on 50 s cooldown.
- Hit inside the zone but near its edge (`quality < 0.3`, i.e. outer 30 % of the zone): it falls **and shatters**. Counts, 10 chaos, 15 noise, banner "CRASH" in yellow, not red. This keeps the "too hard" flavor as a *quality tier of success*.
- Miss: paw whiffs. 0 chaos, 3 noise (a rattle), object retries after 3 s, no progress, banner "MISS" in red.
- Timeout: unchanged.
Side effect: the dominant noise spike (20 on a fail) disappears and swipe noise becomes 5 / 15 / 3, which is also what makes the sqrt(N) drain in 3.1 work without players feeling punished for learning the timing.

### 2.7 How much of a round is walking

Full "honest" solo tour from spawn: window 1.0, rug 1.2, vent 1.0, glass1 1.6, glass2 0.4, glass3 0.4, glass4 0.4, cabinet 0.2, mouse 4.1, pillow 5.2, water 1.3, pens 4.4, tp 7.4, zoomies 1.4 = **30 s of walking for 14 actions** (~2.1 s per action), plus ~36 s of minigames and ~20 s of reading prompts. Walking is about 35 % of active time for a cat that is touring, and the tour takes ~90 s, after which cooldowns force re-walks, so a touring solo cat spends roughly **75-100 s of the 240 s round walking (30-40 %)**. A cat that camps the living-room triangle walks under 10 %. Conclusion: the map is not too big (max traverse 8.4 s, 3.5 % of the round); it is too **clustered**. The richest, safest actions are 1-2 s apart in the living room and the far corners hold 15-chaos items 5-8 s away. Fog (5.5 tiles) means first-timers also lose time finding things, which the objective text does not help with (no room names).

### 2.8 Dominance layer

- Shove: 0 chaos, +6 shover / -2 victim, 3 s cooldown per shover, no per-victim cooldown. Two cats can trade shoves every 3 s for +4 net dominance each (80/min), while the vent keeps paying the team 2/s, so it is not team-harmful, just degenerate. The 1.2 s stun and 1-tile warp are harmless.
- Groom: forced on the target with no consent and no movement check. It locks a teammate for 6 s, kicks both off the vent, and the lickee's best outcome is -3 dominance. That is a griefing tool (lick-lock a teammate in the hallway as the human arrives; steal the vent by grooming the occupant) and the lickee has no reason to cooperate except altruism. It is also the biggest chaos exploit (2.2).
- Stare: +10 dominance for a zero-skill action is the cheapest dominance in the game; it makes the dominance race "who camps the window".
- Vent: +1 dom/s, so the vent occupant also wins dominance by default, which makes the shove fight over it the main dominance interaction. That is actually the healthiest part of the layer (silly, local, visible), it just pays too much on the chaos side.
- Spray: -5 dominance. Fine.
Overall: the incentive is healthy in spirit (bragging rights that do not touch the team score) but the implementation lets dominance actions **also** be the best chaos actions (vent, groom), which is what turns them into griefing-adjacent dominant strategies. Separate the two: dominance actions should be chaos-neutral or chaos-cheap.

### 2.9 Minigame difficulty for a first-time player

| Minigame | Key numbers | Keyboard, first time | Phone touch, first time | Judgement |
|---|---|---|---|---|
| Swipe | bar speed 1.0-1.6 widths/s, zone 0.22 -> 137-220 ms in zone per pass, 6 s | predictive timing, ~60-70 % | add ~60-100 ms touch latency and a 60 Hz frame: the 1.6 speed roll is ~40 % | medium-hard, and the fail is the loudest event in the game; reduce the top speed or widen the zone on touch |
| Mash (rug) | +0.09/press, decay 0.35/s, target 0.75 +/- 0.075; release is a *different* key (E / LET GO) | ~65 %; the two-key release trips people once | two buttons stacked, workable; ~55 % | medium; fail still pays 5-11 so it is low-stakes. Good |
| Mash (tp) | target 0.9 +/- 0.15 on a bar capped at 1.0 | ~95 % (mash to full, release) | ~95 % | trivial; fine as the "newbie" action but it should not pay as much as a rug success |
| Pick (cabinet) | 4 pins, speed 1.6/2.0/2.4/2.8 -> 125/100/83/71 ms windows, miss loses a pin, 14 s | ~30 % solo, ~60 % with helper | pin 3-4 are below touch latency; ~15 % solo | too hard solo; the helper rule is right but checked only at start |
| Zoomies | 9 arrows, 8 s, success at 5/9, wrong press still advances | ~90 % quality | d-pad of 4 buttons, ~75-80 % | easy; fine |
| Stare | hold 6 s, any key fails | ~90 % | any screen touch fails (including an accidental thumb), ~85 % | no skill; it is a 6 s wait for 20 chaos + 10 dom |
| Rhythm (licker) | 8 beats at 100 bpm, +/-130 ms, need 6/8, no audio | ~55-65 % | latency bias, ~45 % | medium-hard; visual-only rhythm with 130 ms is tight on phones |
| Balance (lickee) | unstable drift 0.9, push 2.2, need 60 % of 6 s inside +/-0.28 | ~55-70 % | hold-buttons left/right, ~45-55 % | medium-hard; combined pair success ~35 % first time, ~70 % practised |

Touch is handled client-side (`hints.touch`), and the host trusts the client's reported result anyway (P2P), so a client-side leniency factor on touch is legitimate and cheap.

---

## Part 3. Recommendations (prioritized)

"N" = connected players at round start (or live count; either is fine for a 4-minute round). Confidence: R = recommend, O = option / unsure.

### 3.1 Must fix (dominant strategies and the meter)

| # | Change | Current | Proposed | Rationale |
|---|---|---|---|---|
| 1 (R) | Vent chaos income | 2 chaos/s, 1 dom/s, no cap | **0.4 chaos/s** for the first 20 s on the vent, then 0.1/s; dominance stays 1/s; the `vent` objective keeps counting | 480/round for one keypress must go; the vent stays the dominance throne and the objective still works |
| 1b (O) | Vent team utility | none | while occupied, suspicion drains an extra 0.3/s ("muffled") | gives "Lord of the vent" a co-op role instead of a chaos farm; unsure whether it is too invisible to read |
| 2 (R) | Groom chaos and cooldown | 25 chaos licker, 15 s per pair | **12 chaos** licker, +12 dom unchanged; **per-player cooldown 20 s** (as licker or lickee) in addition to the pair cooldown; keep 8 / 3 partials | caps a 4-cat chain at ~70 chaos/min theoretical, ~35 realistic, for 12 cat-seconds of effort; keeps it as the co-op-only objective |
| 2b (R) | Groom consent | forced on any non-busy cat in 1.6 tiles | target must have `moving == false` for the last 1.0 s, and may not be targeted while carrying the mouse or within 8 tiles of a patrolling human | removes lick-locking without adding a prompt |
| 2c (O) | Lickee reward | -3 dom, nothing else | 0 dom, +5 personal chaos (team chaos unchanged) | gives the lickee a reason to hold still |
| 3 (R) | Zoomies cooldown and noise | 10 s cd, noise 2 + 10q | **25 s cd**, noise **4 + 12q** | sustained drops from 120 to ~58 chaos/min and noise/min rises above the solo drain, so it is no longer an infinite silent loop |
| 4 (R) | Staring contest value | 20 chaos, +10 dom, 25 s cd | **8 chaos, +10 dom, 40 s cd** | it is a 6 s wait; pay it in dominance, which is what the fiction promises ("dominance asserted") |
| 4b (O) | Stare skill check | do nothing for 6 s | the neighbor cat "blinks" once at a random time; press within 0.5 s to win, pressing at any other time loses | turns a wait into a reaction test and makes the bait text matter; unsure if it reads on first play |
| 5 (R) | Suspicion drain | 1.2/s constant | **`1.2 * sqrt(N)`** per second (1.2 / 1.7 / 2.1 / 2.4) | shared meter, N-proportional inflow; sqrt keeps a 4-cat team under real pressure (patrol ~80 s, bust avoidable) without making the meter decorative like linear scaling does |
| 6 (R) | Guaranteed wake-up | none; a solo cat never stirs | once per round, at a random t in [100, 160] s regardless of suspicion, the human does a bathroom trip (bedroom -> hallway -> bathroom door, waits 5 s, returns); announce with the creak line 5 s before | L4D "structured unpredictability": every round at every N gets at least one peak; this is the solo game's tension source |
| 7 (R) | Relief after a patrol | meter keeps its value; at N>=3 it is still ~45 when the human lies down | when the human goes back to bed: `suspicion = min(suspicion, 20)` and drain x2 for 15 s ("deep sleep", log line "The human is snoring. Go.") | the Relax phase; survivors should get a window to spend, which is also when the mouse run and far knockables become rational |
| 8 (R) | Bust | at 100: round ends, chaos x0.5 | at 100: **"LIGHTS ON" hunt**, not round end: human patrols one full loop at 3.4 t/s with spray radius 4.5 and -25 chaos per spray, team chaos **-20 % once**, then suspicion resets to 40 and the human goes to bed (relief rule 7 applies). A **second** bust in the same round ends it as today | Phasmophobia hunts and L4D peaks are survivable; a 4-cat round ending at 55 s with the score halved is the worst outcome for a party game |

### 3.2 Objectives

| # | Change | Current | Proposed | Rationale |
|---|---|---|---|---|
| 9 (R) | Board size | 3 for all N | **`min(5, 2 + N)`** -> 3 / 4 / 5 / 5 | Among Us scales work per player; the +25 per objective keeps the board as the main score driver |
| 10 (R) | Board refill | "keep causing problems" after all done | when every objective is done: +50 as now, then deal a fresh board of the same size from the unused pool (reshuffle when exhausted) with targets one step higher; log "The night is young. New board." | Overcooked: the queue never empties; the last 150 s get structure |
| 11 (R) | Per-objective targets as f(N) | fixed | knock: **2 + N** (3/4/5/6; 7 objects exist). zoomies: **1 + ceil(N/2)** (2/2/3/3). hairball: 1 for N<=2, 2 for N>=3. stare: 1, 2 at N=4. lick (N>=2): **ceil(N/2)** distinct pairs (1/1/2). mouse: 1, 2 at N=4 (respawn 30 -> 20 s to make it reachable). vent: **20 s at every N** (single occupant, does not scale). cabinet, tp: 1 | scale the ones with copies or short cooldowns; leave single-object 60 s actions alone |
| 12 (O) | Objective text | "Knock 3 things off counters" | add the room: "Knock 3 things off counters (kitchen, bedroom, office)" | with 5.5-tile fog, first-timers spend their first minute finding things |
| 13 (O) | Secret personal goals | none | each cat also gets one private dominance-only goal ("be the last cat to use the vent", "groom Dorian") | gives the dominance layer a non-griefing outlet; unsure it fits a 4-minute round |

### 3.3 The human

| # | Change | Current | Proposed | Rationale |
|---|---|---|---|---|
| 14 (R) | Patrol routes | one fixed 12-point loop; never enters bathroom, laundry, office; never in range of the counter, cabinet, window, vent, cat bed | three routes chosen at random per wake-up: (A) current loop; (B) kitchen check: spur to **(16.5, 3.5)** (puts glass2-4 and the cabinet stand tiles within 3.2); (C) living-room check: spur to **(8.5, 4.5)** (rug 2.0, vent 3.2) then to the bathroom door. Keep total loop ~30 s | the human must sometimes go where cats are, and the route must not be memorizable (Booth: "timing and location of peaks will differ") |
| 15 (R) | Spray cost | -15 chaos, -5 dom, 3 s, teleport to cat bed (1.4 s from the farm) | **-20 chaos**, -5 dom, 3 s, teleport to the **litter box (20.5, 17.5)** in the laundry; spray also sets `suspicion = max(suspicion, 50)` so the human finishes the lap | a spray should cost about one and a half swipes plus a real walk (4.7 s back to the living room), and getting caught should escalate the night, not shorten it |
| 16 (O) | Footstep cue | one toast at patrol start | a soft screen pulse whose rate scales with 1/distance when the human is within 9 tiles, even through walls | Phasmophobia's heartbeat; the human is otherwise invisible until 0.3 s before the spray; unsure about cost on the renderer |
| 17 (O) | Human speed by N | 2.6 | 2.6 at N<=2, 2.9 at N>=3 | DRG-style pressure step; only if routes (14) are not enough. Not confident |

### 3.4 Scoring normalization

Target band after changes: every repeatable action lands at **~40-80 chaos per minute of one cat's effort**; noise and risk, not raw rate, differentiate them.

| # | Change | Current | Proposed | Rationale |
|---|---|---|---|---|
| 18 (R) | Swipe outcomes | fail = falls, 6 chaos, 20 noise, counts | see 2.6: hit 15 / 5 noise; edge hit "CRASH" 10 / 15 noise, counts; miss 0 / 3 noise, nothing falls, 3 s retry | fixes the complaint and removes the largest noise spike |
| 19 (R) | Far knockables | water, pens = 15 like the kitchen ones | **water 20, pens 20** (bedroom and office are 5-8 s away) | distance-weighted pay stops them being dead options |
| 20 (R) | Cabinet | solo 4 pins, speed 1.6, +25 %/pin; helper counted at start only | solo **3 pins**, speed 1.3, +15 %/pin; helper counted **at finish** (must still be within 2.5) and the helper gets +5 chaos personal | the 30-chaos objective should be ~50 % solo for a first-timer; the helper must actually help |
| 21 (R) | Rug cooldown | 20 s, repeatable | 25 s | still the honest solo staple (~50/min) after the zoomies change |
| 22 (O) | TP | 20 chaos, window 0.75-1.0 | 15 chaos, target 0.85 +/- 0.1 | currently the easiest 20 in the game; low priority |
| 23 (O) | Mouse | 40 chaos, 30 s respawn | 45 chaos, 20 s respawn; the mouse can be handed to a teammate (E on a teammate while carrying) | makes the one real errand worth the hallway crossing and gives 4-cat teams a relay |

### 3.5 Dominance layer

| # | Change | Current | Proposed | Rationale |
|---|---|---|---|---|
| 24 (R) | Shove | +6 / -2, 3 s per shover | **+3 / -1**, 3 s per shover **and 12 s per shover-victim pair** | kills the ping-pong, keeps the vent fight |
| 25 (R) | Separate dominance from chaos | vent and groom are the best chaos *and* dominance actions | after 1, 2 and 4 above the dominance leaders (vent 1/s, groom +12, stare +10, shove +3) are all chaos-cheap | bragging rights should never be the team-optimal line |

### 3.6 Minigames and input

| # | Change | Current | Proposed | Rationale |
|---|---|---|---|---|
| 26 (R) | Touch leniency (client-side, `hints.touch`) | same windows on phone and keyboard | multiply timing windows by **1.3** on touch: swipe zone 0.22 -> 0.29, pick zone +/-0.1 -> +/-0.13, rhythm +/-0.13 -> +/-0.17 s; balance drift 0.9 -> 0.7 | touch adds 60-100 ms latency; the host already trusts client results |
| 27 (R) | Swipe speed roll | 1.0 + rnd(0.6) | **0.9 + rnd(0.5)** | the 1.6 roll is a 137 ms window on keyboard, ~40 % on phones, and it is the first minigame most players meet |
| 28 (O) | Rhythm audio | visual only | a tick on each beat crossing | 130 ms visual-only is the hardest thing in the game on a phone; unsure about audio policy in a browser game |
| 29 (O) | Stare on touch | any pointerdown fails | ignore touches in the first 0.4 s (finger still on the PAW button) | accidental fails on phones |

### 3.7 Round length
Keep **240 s**. With the board refill (10), relief phase (7) and guaranteed wake-up (6), the round has a shape: board 1 (0-60 s), first peak, board 2, scheduled peak around 100-160 s, final board. Walking is 30-40 % for touring play and that is acceptable for a 4-minute round on a map whose longest trip is 8 s. Option: 270 s at N=1 only, if playtests show solo cannot finish two boards.

### 3.8 Expected effect (back of the envelope, competent 4-cat team)
Before: vent cat 480 + groom chain 600+ + whatever else = 1000-1500 with the meter at 0, or an honest team busting at ~55 s for ~150. After: vent ~30, groom ~100, two boards ~250-300, actions ~300-400, one or two sprays -40, i.e. roughly **600-750** with one or two real scares, and a solo cat lands around 300-350 with one scheduled scare. The honest line and the optimal line converge, which is the goal.

### What I am least sure about
- The exact sqrt(N) drain (5) vs a DRG-style step (1.2 / 1.2 / 1.7 / 2.0). Both beat the status quo; pick by feel at N=2.
- Whether "bust = hunt" (8) loses the drama of "THE HUMANS ARE AWAKE". Keeping the ending for a second bust preserves it.
- Vent muffling (1b) and secret goals (13) are ideas, not tuned numbers.
- All first-timer success rates in 2.9 are estimates from the window sizes, not telemetry; a one-line `console.log` of minigame results per kind would replace them in an evening.

### Sources
- Booth, "Replayable Cooperative Game Design: Left 4 Dead", GDC 2009 slides: https://cdn.fastly.steamstatic.com/apps/valve/2009/GDC2009_ReplayableCooperativeGameDesign_Left4Dead.pdf
- Phasmophobia sanity (Fextralife): https://phasmophobia.wiki.fextralife.com/Sanity
- Phasmophobia difficulties (Steam guide): https://steamcommunity.com/sharedfiles/filedetails/?id=3046189586
- Phasmophobia objectives per contract: https://www.fdaytalk.com/perfect-investigation-phasmophobia/ ; group-size discussion: https://steamcommunity.com/app/739630/discussions/0/5300214375028238777
- Overcooked deep dive (Game Developer): https://www.gamedeveloper.com/design/game-design-deep-dive-building-truly-cooperative-play-in-i-overcooked-i- ; analysis: https://medium.com/cores-of-game-design/overcooked-the-other-as-gameplay-5a9627df0203 ; solo thresholds (review, secondary): https://www.pressreader.com/australia/play-uk-1/20180828/281741270268624
- Deep Rock Galactic scaling tables: https://deeprockgalactic.wiki.gg/wiki/Difficulty_Scaling ; https://deeprockgalactic.wiki.gg/wiki/Creatures
- Vermintide 2 hordes / director: https://vermintide2.fandom.com/wiki/Hordes ; https://www.ludo.guide/guide/warhammer-vermintide-2/enemy-types-weaknesses/enemy-formations-spawns/enemy-spawns-director-system
- Among Us options and settings: https://among-us.fandom.com/wiki/Options ; https://www.pcgamesn.com/among-us/settings-best ; https://progameguides.com/among-us/best-settings-for-among-us/
- Co-op scaling overview: https://gamemechanicshoard.com/mechanic/co-op-scaling/ ; tabletop thread: https://boardgamegeek.com/thread/2219480/scaling-the-co-op-scenario-difficulty
- Dominant strategies and balance: https://book.leveldesignbook.com/process/combat/balance ; https://www.cs.cornell.edu/~ajul/zerosum/zerosum.pdf
- Scoring design: https://www.leagueofgamemakers.com/game-elements-scoring/ ; https://www.gamesprecipice.com/positional-balance/

Fandom pages were only available to me as search snippets (direct fetch returned 402); the Fextralife, wiki.gg, Steam, Game Developer and Valve PDF sources were read directly.
