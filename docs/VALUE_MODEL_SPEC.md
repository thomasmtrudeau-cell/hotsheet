# Hotsheet value model, full spec

Written 2026-08-24 for an outside review. Everything here is read off `src/lib/value-model.ts`
(the engine), `src/lib/war.ts` (ingestion), and `src/components/TradeChecker.tsx` (the live layers).
Constants are the real ones in the code today.

League baseline throughout: **20 teams, 28 keepers (560-keeper pool), OBP scoring**, standard slots
(C1, 1B1, 2B1, 3B1, SS1, CI1, MI1, OF4, UTIL2, P9).

## Revised 2026-08-26 (fifth pass): Overall composition, and a regression

Gage Jump (23, 3.4 WAR, 3.75 ERA/20) tied Brandon Pfaadt (27, 2.3 WAR, 4.27 ERA/20) at Overall $5
despite beating him on 2yr, Keep and Upside. Two causes, one of them mine.

**The roster-spot line was charged every season and credited once.** Every season is netted against
the waiver line, because you could have held a free agent instead — that netting is what stops a
fringe player banking a long career of phantom surplus. But the line was added back a single time,
from THIS season only, and outside the normalization. For a player whose seasons are all alike the
two cancel exactly. For a young player with a weak present and a strong future they do not: he is
charged the line in every future season and credited it for none. 87% of Pfaadt's Overall was an
unnormalized credit for being rosterable today; Jump's market value this season is $2.

Credited on the same normalized, per-season basis it is charged on, the formula reduces to the
discounted average of his above-the-line season values. Both anchors the old form was built around
survive, and were checked numerically: eight flat seasons at V still read V, and a player sitting
exactly at the line still reads the line, so "receive a scrub" and "free a roster spot" stay
equivalent in the trade math. Below the line the roster-spot credit tapers out by half the line
rather than cutting off, because a hard gate put a $3.50 step between two nearly identical fringe
players.

**`fvPtFactor` had been dead since the legacy path was deleted.** It was only ever read there, so
the dock for "his keeper ceiling assumes an everyday role he does not have" stopped applying at all.
The walk-forward lens prices a part-timer's rate at a full slate in every future season, and the
opportunity blend can only raise a season toward his talent, never discount it for role risk — so a
29-year-old utility bat projected for half a slate read a full-time Keep. Jose Caballero's 55-steal
rate really is worth $22 at an everyday role; he was being credited with holding one for a decade.
Re-wired onto the season vector, and its projection-only half is now shared with the board through
`keeperRoleFromProjection`, because Overall is the board's default sort and it had been ranking every
part-timer as a future regular.

| | before | after |
|---|---|---|
| Gage Jump, Overall | $5 | **$7.30** |
| Brandon Pfaadt, Overall | $5 | **$4.60** |
| Jose Caballero, Keep | $19 | **$13.60** at a 0.66 role attainment |

**What was NOT the fix:** porting the category decomposition to pitchers. The arms tab has the same
shape (`mW, mSV, mERA, mWHIP, mSO, PTS, aPOS`), but the structure does not hold — R² 0.724 against
0.991 for hitters, and the zero-innings intercept is unidentified (true fit -10.27, the runtime
estimator that works for hitters gives -29.19). That swings a rookie's full-workload value between
$2.50 and $26, so it is unusable. The reason is structural: ERA and WHIP are ratio categories where
more innings from a bad arm make the contribution *worse*, and saves depend on role, so pitcher
category dollars are not linear in innings around a common intercept the way hitting dollars are in
plate appearances.

## Revised 2026-08-25 (fourth pass): Upside calibration and the Now anchor

**The reported symptom was half right.** Gavin Williams' actual market value is **$14.60**, not $24 —
so his $14 Upside was roughly correct and his **Now** was the anomaly. But the pitcher Upside slope
really was too flat, just at the other end of the scale: the market pays **$15.80** per unit of
(4.60 − era20) and the model was paying **$11.00**, so it was fine in the middle of the pool and
badly short at the top (Skubal, 2.59, read $23 against a $36.40 market).

Fitted 2026-08-25 against the export: starters at a full rotation share (n=75) and hitters with 90+
projected PA (n=178).

| | old | new | note |
|---|---|---|---|
| `UPSIDE_CEILING_PIT` | 1.00 | **1.65** | p85 of the market-to-production ratio |
| `UPSIDE_CEILING_HIT` | 0.68 | **0.92** | same, and the bats' *slope* was already right |
| `TALENT_LENS_PIT` | (shared) | **1.21** | through-origin mean, for the season engine |
| `TALENT_LENS_HIT` | (shared) | **0.71** | ditto |

**Upside and the talent lens are now two different numbers.** They used to be one, on the grounds
that the chip and the engine should "talk about the same ceiling". They should not. The chip means
his best case, so it is calibrated to the 85th percentile of the market-to-production ratio, which
is what makes `Upside >= Now` hold as an invariant rather than a coincidence — a conditional MEAN
can never do it, because half the population sits above its own mean by construction. The season
engine needs his EXPECTED value at full opportunity, because Keep and Overall are averages of those
seasons; feeding them a ceiling inflates every future year.

**Now is market-anchored on both paths.** The in-export branch was `1.0 * market + 0.18 * warPv` —
weights that sum to more than a market read by construction, so every in-export pitcher came out
above his own price (full-workload starters ran a median $2.70 high). WAR is now a confidence tick
on the market rather than an adder, which is exactly what the hitter rate path already did.
Pitchers also finally have a reps signal (`projectedSeasonIp / 140`, or 60 for a reliever), so the
confidence BOOST can be gated the way a hitter's is — an arm already projected for a full rotation
turn has no room to buy back.

**The out-of-export fallback was 46% rich.** `OUT_OF_EXPORT_CAL = 0.69`, fitted as the median ratio
of market-anchored to fallback value across 362 in-export players, so dropping out of the export is
no longer worth a raise.

**Trout was not a Path B failure.** He joins fine (id 10155, $24.40, 109 PA), and the confidence
buyback contributed about 2%. The real cause was the trade card's playing-time blend: `PA_PER_GAME`
had been derived from the p90 of the export's regulars, so a game-log read of "he plays every day"
produced a 90th-percentile workload, and the export was only ever trusted 66% even on the day it was
pulled. Both fixed: a second constant `PA_TYPICAL_EXPORT` (the median regular) drives the game-log
estimate, while the p90 stays the reference slate, and export trust now starts at 100% and decays to
zero over four weeks.

**The counting-stat escape moved into the model.** `currentWarProxy` keyed on WAR alone, so a
60-steal, 96-wRC+ speedster was docked as a job-security risk even though the steals are why he is
in the lineup. Scarce combined power and speed (45+ HR+SB per 600) now floors the proxy at the
everyday bar, matching the trade card's own layer.

### Results

| | before | after |
|---|---|---|
| Gavin Williams (3.44, 4.2 WAR) | Now $20.00, Upside $14 | **Now $14.50, Upside $22.00** (market $14.60) |
| Tarik Skubal (2.59, 6.3 WAR) | Upside $23.10 | **Upside $37.50** (market $36.40) |
| Mike Trout | Now up to $32, Upside $24.50 | **Now $25.30, Upside $29.50** (market $24.40) |
| Chandler Simpson | Now $7.50 on a $9.70 market | **Now $9.70** |
| in-export starters, Now vs market | median +$2.70 | **median $0.00** |
| `Upside >= Now`, near-full-time hitters | — | **95%** (98% of all in-export hitters) |
| `Upside >= Now`, full-workload starters | 64% | **87%** |

**On the $26-32 target for a 3.30-3.50 ERA/20 ace:** the market does not support it. At that skill
level, comparable full-workload arms price between $14.60 (Williams) and $23.50 (Gilbert), fitted
mean $16.80, p85 ceiling $22.80. The $26-32 band corresponds to era20 around 2.6-2.9 — Sale,
Skubal, Misiorowski. Reaching $26-32 at 3.4 would need a scale near 2.0-2.3, which puts Skubal's
ceiling at $45-52, above any price that exists in this league. The calibration above follows the
data instead; if the target is a deliberate override rather than an estimate, it is one constant.

**On strikeout and WHIP credit:** measured rather than assumed. Adding K% to the fit lifts R² from
0.845 to 0.851, and K% plus BB% to 0.858 — small, because era20 is already a skill-ERA built from
K, BB, BABIP and home runs. It is worth about $4.80 of spread between a 30% and a 20% strikeout arm
at the same era20, so it is not nothing; it needs a new ingestion column and a snapshot bump, which
is why it is offered rather than taken.

## Revised 2026-08-25 (third pass): injured players

An IL'd Riley Greene read $20 against a $15.90 market projection. The cause was not the
playing-time buyback (that contributes nothing when the share is already 1.0) and not `earnBump`
(already gated on injury status since it was written). It was `estRosPA` **discarding** an injured
player's projected reps and substituting a full everyday slate, on the theory that a flat 10%
severity dock would price the absence. For Greene that meant pricing 125 reps for a player
projected for 95: about $11 of production he cannot deliver, against $2 of dock.

Three changes:

1. **An injured player's projected reps are now trusted, not replaced.** The substitution existed
   because the old engine read his rate as dollars-divided-by-PA, so a short PA dragged the rate
   down with it. The decomposition removed that, so a short PA now correctly means "fewer reps at
   his own elite rate" and nothing else. Same "trust the projection" reasoning that already decides
   whether a 60-day stint is season-ending.
2. **No rep buyback for calendar loss.** `jobSecurityConfidence` takes an `allowBuyback` flag; on
   the IL the boost side is capped at neutral. The dock side still applies, because a player can
   lose his job while he is out.
3. **The severity dock is replaced, not stacked.** Once his share prices the games he will miss,
   docking him again charges the same absence twice. What survives is an explicit
   `IL_RETURN_PREMIUM` of 8% at full talent confidence, which is what makes an injured star worth
   more than a healthy replacement-level regular at the same remaining dollars.

Greene: **$24.60 to $16.60** against a $15.90 market, a tick above rather than a re-base. The
ordering Tom asked for holds: at equal remaining dollars, injured star $16.60 > healthy full-time
regular $15.90. A healthy but part-time 4-WAR bat reads $16.90, higher than either, because his
shortfall is a role rather than a calendar and the buyback is exactly the buy-low signal it is
there to price. A fringe 1.2-WAR bat on the IL gets no premium at all and still takes the
confidence dock.

The board never had this bug (it always used the export's PA), so the trade card and the board now
agree on an injured player to within $0.30, where they used to differ by nearly $8.

## Revised 2026-08-25 (second pass)

Auction export refreshed 2026-08-25 (both tabs), so `AUCTION_AS_OF` and every derived
constant moved with it. Four further changes:

1. **The category-dollar decomposition.** Now reads a real per-PA rate instead of dividing
   bottom-line dollars by playing time. This was item 8 below, and it was the root cause of
   several other problems. Verified: `Dollars = PTS + aPOS + $1.00` (sd $0.05 across 603
   hitters) and `PTS = B + rate x PA` at R2 = 0.991. At a player's own projected share the
   new formula returns his auction dollars **exactly**.
2. **Now carries no positional term on either path.** Path B used to apply half the scarcity
   multiplier while the rate path applied none, so dropping out of the export moved a player's
   Now for a reason that had nothing to do with him.
3. **The left-handed corner-bat platoon charge is billed once.** The anticipated charge and the
   observed `platoonDock` are the same risk seen at two moments; the model now takes the more
   severe rather than multiplying them.
4. **The workload penalty is gated on a readable sample.** Below 40% of a rotation share the
   pro-rated season figure carries no durability information, so no penalty applies.

## Revised 2026-08-25 (first pass)

What changed:

1. **Positional scarcity is derived from the pool, and it is connected again.** The static prior
   table is gone; the multiplier now reads the Nth best eligible bat at each position, where N is
   teams times per-team demand. More importantly, scarcity had gone **inert**: it was only ever
   applied inside `computeValue`'s keeper term and the WAR/market present path, and the season
   engine replaced the former on 2026-08-07. From that day until now, position affected Keep and
   Overall for nobody. It is now applied once, to the season vector.
2. **Catcher volume reaches the ceiling.** The 15% haircut applies to Upside and to the talent lens,
   it slides continuously with projected wRC+, and it caps at 90% of a regular's workload.
3. **Now can go negative**, and lands exactly on the player's own auction dollars when it does.
4. **One playing-time denominator**, calibrated: `PA_PER_GAME` 4.15 to 4.4, full time defined as
   remaining games times that, shared by the engine, the board and the trade card.
5. **The under-26 talent immunity is a ramp**, and it is gated on how many reps there are to read.
6. **Pitcher attrition applies at every age** (6%/yr floor), arm injuries echo forward as standing
   hazard, and a starter projected under 140 innings takes a workload penalty.
7. **Deferral and the year discount scale with keepers per team.**
8. **The legacy age-unknown valuation machine is deleted**, along with `growthPremium`,
   `warDurability`, `keeperAgeFactor`, `overallValue` and the baked `futureValue`.

Three items from the same request were **not** implemented, for reasons given in section 8.

---

## 0. What the five chips are supposed to mean

| Chip | Question it answers | Time window |
|---|---|---|
| **Now** | What is he worth to my lineup this season | this season only |
| **2yr** | What is he worth per year over the next two seasons | seasons +1, +2 |
| **Keep** | What is he worth per year going forward, near years counting most | seasons +1 to +7 (shifted for the young) |
| **Upside** | What is his best season worth if he plays every day and it all works | one hypothetical season |
| **Overall** | What is the whole asset worth in a trade, quality times quantity | entire remaining career |

Design rule since 2026-08-07: **one per-season projection feeds all of them.** Before that, Keep ran
on separate slot-economics machinery and could disagree with the walk-forward chips about the same
player (a 34-year-old Trout reading "next year 5.9" and "Keep 3.7" at the same time).

### The scale

Everything internal is in "value-model units". The UI converts once, at the end:

```
$displayed = FA_LINE[role] * depthFactor + value * AUCTION_DIV
FA_LINE     = { HIT: 3, SP: 1, RP: 3 }        // the freely-available-on-the-wire line
AUCTION_DIV = 5                               // dollars per 1.0 of internal value
depthFactor = sqrt(560 / (teams * keepers))   // 1.00 at the 20x28 baseline
```

So internal 0 shows as **$3** for a hitter, and internal 3.8 shows as **$22**. Every chip shares this
one scale, which is why Overall is deliberately normalized to a per-season reference card (below):
so that Now, Keep, 2yr, Upside and Overall are all comparable dollars.

**Now is no longer floored at 0.** A genuinely negative asset reads as the dead weight it is, and
lands exactly on his own auction dollars: the market says -$17.20, the chip says -$17.20. Overall
still floors at 0, because Overall is an asset value and nobody is obliged to keep rostering a
negative player. The downside of owning him is bounded by releasing him.

---

## 1. Inputs

### 1a. Talent inputs, from the StS / Oopsy projection sheet (per-600 rates)

| Field | Source column | Notes |
|---|---|---|
| `war` | `WAR` (hitters), `WAR (20 TBFG)` (pitchers) | **peak** WAR, a true-talent age-26/27 ceiling, not this year |
| `war` (pure RP) | `RP WAR` | relievers with IP/G < 2.01 take the role-priced figure, roughly 0.55 to 0.6x the 20-TBFG number |
| `peakWrcPlus` | `wRC+` | peak rate |
| `curWrcPlus` | `wRC+` on the `2025 hitting raw` tab | current-year projection, the "what is he actually doing" rate |
| `era20`, `curEra20` | `era 20 tbf/g` variants | pitcher equivalents |
| `hr`, `sb` | `HR`, `SB/600` | peak counting rates |
| `defRuns` | `DEF` | fielding runs **including the positional adjustment** |
| `age` | `max age` | |
| `level` | `highest level` | MLB / AAA / AA / A+ / A / Rk |
| `ipg` | `IP/G` | pitcher role detector, < 2.01 = reliever |

### 1b. Market inputs, from the Oopsy rest-of-season auction export

| Field | Notes |
|---|---|
| `auctionRaw` | the dollar value itself, unfloored, can be negative |
| `pa` / `ip` | the export's own rest-of-season playing time projection |
| `marketBaseline` | `max(0, $ - FA_LINE[role]) / 5`, the floored version |
| `pos` | first-listed eligibility |
| `cnt` | `mHR + mSB`, the dollarized power+speed slice |

The join is by the projection sheet's own `id`. This is where the Lara bug lived: 70 recently
promoted bats were keyed only under their minor-league FanGraphs id, missed the join, and fell to the
market-free fallback path. Fixed 2026-08-24 by keying every export row under the union of its
FanGraphs, MLBAM and projection-sheet ids.

### 1c. League settings

`teams`, `keepers`, `format` (obp / points / avg), `slots`, `rebuilder` (turns off the time-to-peak
discount entirely).

### 1d. Live layers, trade card only

The Value Board passes only `isMLB` plus rest-of-season rates, so a healthy everyday neutral-park
player reads identically in both places. Anything that differs between board and trade card is a real
live adjustment, not code drift.

| Layer | What it is | Neutral |
|---|---|---|
| `ptCredit` | share of full-time reps from the live game log plus injury feed | 1 |
| `rosWrc` / `rosEra` | live rest-of-season rate, preferred over the sheet's current-year figure | undefined |
| `injuryMult` | present injury severity dock | 1 |
| `armPvMult` / `armFvMult` | arm-injury nick now (0.93) versus forward-looking fade | 1 |
| `ptDockEff` | named playing-time threat (IL returnee, AAA pusher, roster crowd), neutralized by the player's own current ability | 1 |
| `jobSecurity` | `ptFragility`, position-aware, with bat and counting-stat escapes | 1 |
| `earnBump` | prime-age high-WAR part-timer nudge, +3% to +12% | 1 |
| `platoonDock` | 0.83 (LHB) or 0.87 (RHB) base, scaled off by bat and glove | 1 |
| `homePark` | home run environment | 1 |
| `savesPremium` | closer value, only when the market has not already priced it | 0 |
| `fvPtFactor` | keeper-horizon role attainment | 1 |
| `catcherShare` | fraction of games actually spent behind the plate | undefined |
| `ilStint` | on the IL now and expected back: the missing reps are calendar, not role. Never set for a season-ending case | false |

---

## 2. Shared machinery

These functions are used by more than one chip. They are where most of the arguable judgment lives.

### 2a. Fantasy WAR, `fantasyWar()`

Raw WAR is not fantasy value. Two corrections:

```
offWar = war - (defRuns / 9.774) * (1 - defKeep)
catchers: offWar *= catcherVolume(position, peakWrcPlus, catcherSeverity)

catcherVolume: vol = 0.85 + clamp((peakWrc - 100)/40, 0, 1) * (0.90 - 0.85)
               return 1 - (1 - vol) * catcherSeverity
   a 100-wRC+ everyday catcher -> 0.85, a 140-wRC+ bat -> 0.90 (the hard ceiling),
   a C who catches half the time -> 0.925
```

The buy-back exists because managers find plate appearances for a catcher who hits: he DHs on his
off days and starts the day game after a night game anyway. The ceiling exists because no catcher,
however good the bat, plays a full slate.

`defKeep` is the **insurance share of defense that is retained**, on the theory that a glove produces
no stats but does hold the everyday job and extend the career:

- **Present:** `defKeep = 0.30`. Strip 70% of DEF.
- **Keeper:** `defKeep = 0.70 * sbAgeFactor(age)`. Retain 70% at age 26 or younger, about 56% at 30,
  about 46% at 33, because range erodes on the same curve as speed.

The 0.70 young-age anchor rather than 1.0 is the guardrail that stops a no-bat glove wizard from
out-keeping a real bat.

### 2b. Keeper WAR also strips the negative positional adjustments

```
NEG_POS_ADJ = { LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5 }   // runs per season
fWarKeeper = fantasyWar(war - negPosRuns/9.774, pos, cSev, defRuns - negPosRuns, 0.7 * sbAgeFactor)
```

Deliberately **asymmetric**: negative adjustments come out (they are real-baseball replacement
accounting, and fantasy already prices position through the roster-slot scarcity model, so charging
both hammers a corner bat twice), while positive adjustments for C, SS and CF stay in (scarce
eligibility is genuine fantasy value). This asymmetry is one of the main things up for debate in
section 5.

Worked difference for a DH with DEF = -17.5 runs:
- **Now** uses `fWar`: `war - (-17.5/9.774)*(1-0.30) = war + 1.25`
- **Keep** uses `fWarKeeper`: full `war + 1.79`, and the leftover fielding term is then zero

So a DH gets 70% of his positional penalty refunded in Now and 100% of it refunded in Keep.

### 2c. Age curves

```
presentMaturity(age) = clamp(1 - 0.06 * max(0, 26 - age), 0.5, 1)
   21 -> 0.70   22 -> 0.76   24 -> 0.88   25 -> 0.94   26+ -> 1.00

ageRetention(a, isPitcher) = clamp(1.05 - max(0, a - onset) * slope, 0, 1)
   hitters:  onset 30, slope 0.06
   pitchers: onset 31, slope 0.05

futureSeasonShape(a) = ageRetention(a) * presentMaturity(a)   // ramp up, then decline
```

`presentMaturity` is used **only for present value**. Keeper value banks the full ceiling.

### 2d. Career survival, `survivalCurve()`

Expected value must include the odds the player even has each future season, and that cannot be a
blanket age curve. Per-year hazard rises with age and falls with the **margin** of decayed keeper WAR
over the position's bar:

```
hazard(a) = clamp(0.075 * (a - 34) - 0.21 * margin + hazardAdd, floor + hazardAdd, 0.85)
floor  = 0.06 for ALL pitchers at every age, 0.01 for hitters
margin = fWarKeeper * ageRetention(a) - bar_at_the_20x28_baseline

hazardAdd (pitchers only):
  + 0.03 standing, if he has a live ARM injury
  + 0.07 * (140 - projectedSeasonIp)/140 * clamp((age - 22)/4, 0.3, 1), for a starter under 140 IP
    ONLY IF his ROS innings are at least 40% of a full rotation share (1.1 IP per team game)
  projectedSeasonIp = export ROS innings * 162 / remaining games at the export date
```

The readability gate is a GATE, not a taper. A taper was the obvious first move and it was wrong:
sample size and workload shortfall are driven by the same number in opposite directions, so
multiplying them cancelled the penalty everywhere (an 18-IP starter, a genuine 108-inning arm,
lost 0.2% of his Keep). With the gate the meaningful band survives: a 72-to-140-inning starter is
charged, and a two-start September call-up is not. The cost is a step at the threshold, about $1.30
of Keep for the pitcher who sits either side of it.

The universal 6% floor replaced a 31-and-older-only 5.5% floor, which had let a 24-year-old ace ride
a 1%/yr hazard for seven straight seasons. It costs a young ace about 15% of his Keep. The workload
term is tempered for young arms on purpose: a 21-year-old projected for 70 innings is usually on a
development plan, while a 28-year-old projected for 70 is telling you about his elbow.

Anchors: a 36-year-old star (margin +0.7) holds P = 0.9 / 0.7 / 0.45 for ages 37 / 38 / 39. An
ordinary 36-year-old keeper (margin -0.8) gets 0.6 / 0.3 / 0.11. The bar is pinned to the 20x28
baseline on purpose, because career length is not a league setting.

### 2e. Prospect discounts, `keeperDeferral()`

```
proximityMultiplier(level) = MLB 1.00, AAA 0.92, AA 0.82, A+ 0.72, A 0.62, else 0.50
maturityFactor(age, level) = 1 - max(0, 25 - age) * 0.07 * deferralByLevel(level)
   deferralByLevel: MLB 0 (arrived, no time discount), AAA 0.75, AA 0.9, A/A+/Rk 1.0
   pitchers take half the discount, floor 0.45
w = 0.6 * deferralSeverity(s)
keeperDeferral = max(0.3, 1 - (1 - maturityFactor)*w - (1 - proximity)*w)

deferralSeverity(s) = clamp((28/keepers)^0.3, 0.85, 1.6)            // 8 keepers -> 1.46, 40 -> 0.90
yearDiscount(s)     = clamp(0.72 * (keepers/28)^0.15, 0.55, 0.80)   // 8 -> 0.597, 40 -> 0.760
```

Both scale with keepers per team as of 2026-08-25: at 28 slots you can carry a season of development,
at 8 you cannot, because every slot has to produce now. A 19-year-old A-ball shortstop reads Keep
$14.20 at 28 keepers, $14.80 at 40, and $13.80 at 8.

Both factors key on level, so multiplying them would double-count "young and far". They are combined
additively at 60% each instead. **MLB players are unaffected**: both factors are 1.0.

### 2f. Bars and replacement levels

```
keeperBar(s)          = clamp(2.0 * sqrt(560 / (teams*keepers)), 0.8, 5.0)   // 2.0 at baseline
keeperBarFor(s, pos)  = pitchers: bar * 0.8
                        1B / DH:  bar * 1.0
                        all other hitters: bar * 1.2
replacementWar(s)     = clamp(1.0 * teams / 20, 0.4, 2.0)                    // present-value floor
OV_REPL               = 0.7 * sqrt(560 / (teams*keepers))                    // Overall's waiver line
```

Reasoning in the code: hitters outside 1B/DH carry defensive WAR that does not score, so their real
keep line is about 2.4. 1B/DH keep the base 2.0 bar but are judged on their **stripped** keeper WAR.
Pitchers sit at 1.6 because pitcher WAR runs compressed and there are 9 P slots per team.

### 2g. Positional scarcity, `scarcityMult()`

Derived from the pool rather than from priors, as of 2026-08-25:

```
demand(pos)  = own slots + flex share    // CI feeds 1B/3B, MI feeds 2B/SS, UTIL counts for DH only
N            = teams * demand(pos)
repl(pos)    = the Nth best ROS $ among everyone ELIGIBLE at pos, in value units
ref          = slot-weighted average of repl() across all hitter slots
mult         = clamp(1 + 0.15 * (ref - repl(pos)) + ofSubposTilt, 0.80, 1.30)
```

The comparison is against the average rather than against outfield, so the multipliers redistribute
around 1.0 instead of inflating the board. The export cannot resolve outfield subpositions, so small
residual tilts survive inside the OF bucket (CF +0.04, LF/RF -0.02).

What it produces at the 20-team baseline, against the priors it replaced:

| Position | new | old prior |
|---|---|---|
| C | 1.134 | 1.120 |
| 3B | 1.113 | 1.020 |
| SS | 1.074 | 1.060 |
| 2B | 1.047 | 1.050 |
| 1B | 1.002 | 0.940 |
| CF | 0.964 | 1.040 |
| OF | 0.924 | 1.000 |
| DH | 0.846 | 0.900 |

Third base comes out far scarcer than the prior knew (the 3B-eligible pool is thin once every team
fills two corner slots) and outfield far deeper (4 slots x 20 teams). In a two-catcher league C goes
to 1.300; in a 10-team league it falls to 1.106, which the static prior could never see.

**Where it applies:** once, to the season vector, so Keep, 2yr, Upside and Overall all carry it.
**Now carries no positional term on either path** as of the second 2026-08-25 pass. The rate path
never did, and the WAR/market path used to apply half, which meant a player dropping out of the
export took a silent step change in his Now for a reason that had nothing to do with him. One
philosophy now: Now is the market-anchored chip and the auction calculator already carries its own
positional adjustment (aPOS, which sits inside `fixed` on the rate path), so a second tilt would
price position twice. This resolves argument 7 in favour of "position belongs to the future".

### 2h. Format weights

```
obp:    warW 0.18, mktW 0.62, wrcFan 1.00, hrFan 0.80, sbFan 1.20
points: warW 0.34, mktW 0.46, wrcFan 0.90, hrFan 1.15, sbFan 0.60
avg:    warW 0.18, mktW 0.60, wrcFan 0.82, hrFan 0.78, sbFan 1.17
```

SB outweighs HR about 1.5 to 1 in category formats for two stacked reasons: category scarcity (z-score
studies put 1 SB at 1.3 to 1.7 HR), and orthogonality (wRC+ already contains power, so an equal HR
weight double-counts it). `sbFan` is further multiplied by `sbAgeFactor(age) = clamp(1 - 0.05*(age-26), 0.5, 1)`.

### 2i. WAR as playing-time confidence, not as value

This is the model's central premise, and it is worth putting in front of Gemini explicitly:

> Empirically, playing time is the number one driver of fantasy value (corr(auction $, PA) about 0.95)
> and WAR is the weakest of the big three (about 0.72, below wRC+'s 0.75). So WAR's job is not to be
> the value. It tells us how confident we are the reps show up now and persist over the keeper horizon.
> Net effect by design: high WAR nudges present value a little and lifts keeper value a lot.

The three implementations:

```
ptFragility(war, pos)    // present dock for low WAR, caps at 1.0, never a boost
   no dock at 2.5 WAR; dock begins below 1.0 WAR (1.5 for corners)
   floor: premium (C/SS/2B/CF) 0.82, corners (1B/DH) 0.62, everyone else 0.70

earningPtBump(war, age, ptRate)   // prime-age 24-29 only, +3% to +12%
   a 2.5+ WAR bat with under 80% of a full role gets some of the dock back

warDurability(war, pos)  // keeper tilt, centered on the 2.0 WAR everyday pivot
   above pivot: +0.09/WAR premium, +0.075 normal, +0.06 corner
   below pivot: -0.11/WAR premium, -0.14 normal, -0.17 corner
   clamp floor: 0.72 premium, 0.68 normal, 0.60 corner; ceiling 1.18
```

Note `warDurability` currently only reaches the **age-unknown legacy path**. The season engine
supplanted it for everyone with a known age.

### 2j. Talent confidence, the blend knob

```
talentConfidence(war) = clamp((war - 2.0)/3, 0, 1)   hitters
                        clamp((war - 1.5)/2.5, 0, 1) pitchers
```

Full deference at about 5+ WAR bats and 4+ WAR arms: past that a player essentially cannot lose his
job, so the model prices his skills rather than his circumstances.

```
currentWarProxy(inp)   // which WAR figure drives the confidence read
   pitchers: peak WAR directly (stuff and command translate fast, a 21-year-old's
             skill ERA is already close to his 26-year-old projection)
   hitters:  peak WAR * clamp((curWrc - 90)/(peakWrc - 90), 0, 1.3)
             falling back to peak WAR * presentMaturity(age) when either rate is missing
```

This is the function that keeps a 21-year-old's peak WAR from being read as current standing. Lara:
peak 114 wRC+, current 85, so the ratio is negative and clamps to 0, so his current WAR proxy is 0
despite a 3.5 peak WAR.

### 2k. The category-only ceiling, `fantasyRate()` and `upsideValueScale()`

```
hitters:  f = wrcFan * max(0, (peakWrc - 90)/12) + hrFan * hr/12 + sbFan * sb/12
pitchers: f = max(0, (4.6 - era20) * 2.2)

Upside chip  = f * catcherVolume * (hitters 0.92 | pitchers 1.65)   // his CEILING, p85
talent lens  = f * catcherVolume * (hitters 0.71 | pitchers 1.21)   // EXPECTED at full opportunity
```

No playing time, no market, no WAR, no park, no age. This single number is both the **Upside chip**
and the anchor of the talent lens in the season engine, on purpose, so that "how much of his ceiling
does he get" and the displayed ceiling are always the same number.

---

## 3. Now, step by step

Now has two code paths. Which one runs is decided by whether the player has a real auction sample.

### Path A, the rate decomposition. In-export hitters with pa >= 15

This is the path that should cover almost every relevant bat.

```
rate     = (pts - PTS_AT_ZERO_PA) / pa          // his TRUE per-PA category rate
fixed    = auctionRaw - rate * pa               // the part that does not scale with reps
fullTime = PA_FULLTIME_EXPORT                   // p90 of the export's own regulars, 125 PA
share    = live ptCredit, else pa / fullTime
conf     = jobSecurityConfidence(currentWarProxy, share)

present  = (fixed + rate * fullTime * clamp(share * conf, 0, 1.15) - FA_LINE[HIT] * depthFactor) / 5
present *= injuryMult * armPvMult * ptDockEff * jobSecurity * earnBump * platoonDock * homePark
```

One formula, no special cases, and it satisfies an exact identity: at his own projected share
with neutral confidence it returns his auction dollars. Verified to the cent on real players.

On the IL (`ilStint`), two substitutions: `conf` cannot exceed 1 (talent does not recover games
already gone), and the severity dock is replaced by `1 + 0.08 * talentConfidence`, because his
share already prices the absence and docking it again bills the same games twice.

**Why the old form was wrong.** The auction calculator scores counting stats in ABSOLUTE terms:
a player's `mHR` is (his projected home runs minus a replacement's) times a price. So a
part-timer carries a fixed "he isn't accumulating" deficit that does **not** shrink with his
playing time, and dividing the bottom line by 25 PA made an ordinary hitter read at -$4 per PA.
The structure is exactly linear and was verified against the export:

```
Dollars = PTS + aPOS + $1.00     sd $0.05 across 603 hitters, pure rounding
PTS     = B + rate * PA          R2 = 0.991 fitting B plus per-PA terms in wRC+, HR/600, SB/600
B       = -33.0                  the category value of a player who accumulates nothing
```

`B` is re-fitted from the export on load rather than hardcoded, because it shrinks as the season
empties. It is fitted on the low-PA third, where the talent-to-playing-time correlation that
biases a naive fit is weakest: that recovers -33.05 against a true -33.00.

**What it fixed, concretely.** Maikel Garcia, a 26-year-old everyday 3B with -$2.30 of remaining
value over 113 PA, had **zero** keeper value under the old reading, because -2.30/113 is a
negative rate and the walk-forward lens floors at zero. His true rate is +$0.154 per PA, and his
Keep is $17.

`PA_FULLTIME_EXPORT` is also now read off the export (the 90th percentile among hitters projected
for at least half the top PA figure) rather than assumed from a PA-per-game constant. A hardcoded
4.4 had to absorb the error in the 183-day season model as well as the real rate: calibrated
against one export it implied 4.38, against the next 4.67. `PA_PER_GAME` is now derived from the
empirical figure rather than the other way round.

`PA_PER_GAME` is calibrated, not assumed: among hitters projected for 100+ remaining PA, p90 is 149
PA against 34 remaining games, which is 4.38 PA/game. The old 4.15 described a p75 part-timer, so
every playing-time credit derived from it ran a few percent high. One function now serves the engine,
the board and the trade card, so "share of full time" means the same thing everywhere.

**The negative branch is deliberately asymmetric.** The machinery above re-applies a per-PA rate over
a full-time pool because the upside case is "he might earn more reps than he has today". Nobody earns
extra reps at being bad: the manager takes them away. Run through the symmetric machinery, a -$17 bat
projected for 23 PA came out at -$28, worse than the market's own verdict on him, because his badness
was extrapolated over a full-time pool and then only scaled back to the 0.3 playing-time floor. Over
his own reps, with no confidence tick, he lands on exactly his auction dollars.

`jobSecurityConfidence` is deliberately a tick, not a re-rating:

```
raw = 1 + 0.08 * (warProxy - 2.0)        // hitters; pitchers pivot at 1.3
if raw > 1: shrink the boost by the room left, (1 - paFrac)
else:       clamp to [0.8, 1.2], ungated
```

The boost is gated on there actually being suppressed playing time. An established full-PT star's
elite WAR is already inside his PA-implied credit, and before this gate a $30 player was reading $36.
The **dock** side is not gated, because job-security risk exists whether he is playing a lot today or
not (the "$15 Jake Burger at 1.5 WAR" case).

**Why this shape.** The old model blended the sheet's dollar figure with a separate WAR and production
layer, which double-counted for anyone already near full playing time (Rafaela: $16 sheet, $24 shown,
with no playing-time story behind the gap). Decomposing the market's own dollars into a per-PA rate and
re-applying it at a confidence-adjusted share of full time keeps Now anchored to the market while still
letting talent and live role move it.

**Worked example, Luis Lara, after the join fix.** rate = -9.3/43 = -$0.216 per PA. Surplus at full
time = -0.216 * 158 - 3 = -$37. Floored at 0. Now = $3, the wire line. Before the fix his market
signal was missing entirely and he ran on path B, reading $22.

### Path B, the WAR and market blend. Pitchers, and hitters absent from the export

```
fWar        = fantasyWar(war, pos, cSev, defRuns, 0.30)
warPv       = max(0, fWar - replacementWar) * 1.8 * presentLevelFactor * presentMaturity * (RP: 0.55)
mkt         = max(0, auctionRaw - FA_LINE*depthFactor) / 5
scarPresent = 1 + (scarcityMult - 1) * 0.5
conf        = jobSecurityConfidence(currentWarProxy)

in export:      base = (0.18 * warPv + 1.00 * mkt) * scarPresent * conf
not in export:  base = (0.60 * warPv + 0)          * scarPresent * conf

ptHaircut = MLB hitters: 0.6 + 0.4 * ptCredit, else 1
prodTerm  = not in export ? 0.7 * fantasyProd(...) : 0
present   = (base * ptHaircut + prodTerm + savesPremium) * injuryMult * pvMults
```

`presentLevelFactor` = MLB 1.0, AAA 0.30, everything else 0.10.

The in-export market weight is 1.00 rather than the format's 0.62 because the 0.62 was calibrated back
when a separate production layer contributed on top. Without that layer this path has to trust the
market nearly fully or it silently underprices every in-export pitcher.

`fantasyProd` is the current-form production layer, majors only:

```
hitters:  max(rateProd + sbBonus, countingProd) * ptCredit * presentMaturity
   rateProd     = max(0, (rosWrc - 90)/12)
   countingProd = (hr + sb)/18
   sbBonus      = only when there is NO market anchor, sbFan * sbAgeFactor * sb/18
pitchers: max(0, (4.6 - rosEra)*1.2) * presentMaturity
```

The `sbBonus` gate exists because wRC+ carries zero stolen-base value, so `max(rate, counting)` erased
a speedster's steals whenever his rate won. Market-anchored paths are excluded because the auction
dollars already price the category.

A **talent floor** protects proven bats whose reps dip: `ptCredit` is floored toward
`0.55 * talentConfidence(war)`, but only when the raw credit is above 0.15, so a season-ending IL case
or a player buried in the minors is not rescued.

---

## 4. The season engine, and Keep, 2yr, Upside, Overall

Everything past Now runs off one vector of future seasons.

```
shift   = max(0, 26 - (age + 1))                       // cover-the-peak, see below
horizon = max(7 + shift, min(25, 43 - age))            // long enough for the cumulative Overall
```

### 4a. Lens 1, walk-forward. What his observed value becomes

MLB players only. His **current** healthy value walked relatively along the aging curve. Not
re-imposed from peak: a 34-year-old producing 8.9 is already at his age-34 level, so decline applies
at the curve's rate from where he is.

```
hitters with a real rate:
   rateAtI = rate * futureSeasonShape(age + i + 1) / futureSeasonShape(age)
   season  = presentFromRateAndPa(rateAtI, paFrac = 1) * surv[i] * parkFade(i)
everyone else:
   annual  = (base.present * ptHaircut + savesPremium) * pvMults / futureSeasonShape(age)
   season  = annual * futureSeasonShape(age + i + 1) * surv[i] * parkFade(i)
parkFade(i) = 1 + (homePark - 1) * 0.75^(i+1)          // roughly 25% of players change teams per year
```

Injured players get their zeroed reps undone in the anchor (0 PA on the IL is a this-season artifact,
not a role), and the market half of the anchor is re-derived WAR-led because an injured player's
auction dollars price his depleted remaining reps.

No production top-up here, at any export status. Adding it back reintroduced the double count: a young
player with big current counting stats but a low maturity shape got that credit divided by his small
current shape and re-inflated across future seasons, blowing past his own category-only ceiling
(Keep exceeding Upside, which should be structurally impossible).

### 4b. Lens 2, full opportunity. What his talent is worth if he plays

For everyone, not just prospects. His circumstances are facts about his team, not about him.

```
season = upsideValueScale * futureSeasonShape(age + i + 1) * keeperDeferral * surv[i]
         + closerTrajectoryBonus * surv[i]
```

Prospects get no survival multiplier, because `keeperDeferral` already carries the risk.

`closerTrajectoryBonus` is a skill-only proxy, up to 1.8, for elite non-closer relievers who convert
to the role at a far higher rate than middle relief. It never touches Now (he has not got the job) and
zeroes out once he has real saves value.

### 4c. Blending the two lenses

```
prePeakFloor = clamp((26 - age)/5, 0, 1)        // 21 -> 1.0, 23 -> 0.6, 25 -> 0.2, 26+ -> 0
repsFrac     = hitters: his share of full-time PA
               pitchers: projectedSeasonIp / 140, or / 60 for a pure reliever
evidence     = clamp((repsFrac - 0.15)/0.45, 0, 1)
oppW         = 1 if not MLB, else max(talentConfidence, prePeakFloor, 1 - evidence)
used[i]      = min(talent[i], walk[i] + oppW * max(0, talent[i] - walk[i]))
```

The blend can only ever lift a season toward the talent lens, never lower it, and it is hard-capped
at the talent lens, because the ceiling should be structurally unbeatable.

The blanket under-26 immunity became a ramp on 2026-08-25, and the `evidence` term went in at the
same time, because removing the immunity exposed what it had been hiding. The observed lens reads a
player's auction dollars divided by his PA, and that is only a RATE for a player with real playing
time: the auction calculator scores counting stats in absolute terms, so a part-timer carries a fixed
"he is not accumulating" deficit that does not shrink with PA. Divide it by 25 PA and you get a
violently negative rate for a player nobody thinks is bad. Blending toward that number wiped out real
keepers (Anthony Volpe, 25, a starting shortstop: Keep $18 to $3 off a 25-PA read). So the observed
lens only earns weight once there are enough reps to believe it, and a genuine everyday player's
observed season now counts for almost everything by his mid-twenties, which is what the change was
for.

### 4d. Keep

```
Keep = sum over k in [shift, shift+7) of 0.72^(k+1) * seasons[k]
       divided by the same weights
```

A discounted **average**, not a sum, so it lands on the Now scale and reads as "he is worth about this
much per year to you going forward".

**Cover-the-peak.** For a pre-peak player the window slides forward to start at age 26. Without this a
21-year-old with the same peak as a 24-year-old read a *lower* Keep purely because his peak sits
later, which double-charges a wait that the maturity ramp and `keeperDeferral` already price. Equal
peaks now give equal Keeps. Age 25+ untouched.

### 4e. 2yr and Upside

```
2yr    = (seasons[0] + seasons[1]) / 2
Upside = upsideValueScale, standalone
```

Upside is the only chip with no aging, no survival, no deferral, no market and no playing time in it.

### 4f. Overall, the trade value

```
ovWeight(0) = 1, ovWeight(1) = 0.70, ovWeight(k) = 0.70 * 0.85^(k-1)
OV_NORM     = sum of the first 8 weights = 4.171
ovRepl      = 0.7 * sqrt(560 / (teams*keepers))

surplus = max(0, Now - ovRepl) + sum over k of ovWeight(k+1) * max(0, seasons[k] - ovRepl)
Overall = min(Now, ovRepl) + surplus / OV_NORM
```

Cumulative discounted surplus over the waiver line across the whole career, so longevity pays and a
33-year-old simply runs out of seasons to sum. Normalized to an **8-season reference card**: a player
with exactly 8 flat seasons at value V reads V, more relevant years push him above his per-season
value, fewer pull him below. The `min(Now, ovRepl)` term is the roster-spot baseline, so a rostered
scrub is still worth his sub-replacement Now while a prospect contributes nothing this season and
starts from zero.

The waiver line scales with league depth: in a 10-team league the freely-available player is about
twice as good, which is what stopped Akil Baddoo from out-ranking Trea Turner.

### 4g. The legacy path

If age is unknown (rare) the engine falls back to the pre-2026-08-07 machinery: a durability-tilted
ceiling floored by sustained production, with `Overall = (Now + 2.31*Keep) / 3.31`. This is the only
place `warDurability` and `growthPremium` still bite.

---

## 5. The catcher, first base and DH debate

### 5a. Where position currently enters, all seven places

| # | Mechanism | C | 1B / DH | Premium (SS/2B/CF) |
|---|---|---|---|---|
| 1 | `fantasyWar` DEF strip | framing deflates his WAR, so stripping DEF **helps** him | negative positional adj partly refunded (70% in Now) | roughly neutral |
| 2 | Catcher volume, now on the ceiling too | 0.85 to 0.90 by wRC+, times severity | n/a | n/a |
| 3 | Negative positional adj removed from **keeper** WAR only | n/a, his adj is positive and stays | full refund: 1B +1.28 WAR, DH +1.79 WAR | positive adj stays in |
| 4 | `keeperBarFor` | bar x1.2 | bar x1.0 (the lowest hitter bar) | bar x1.2 |
| 5 | `scarcityMult`, now pool-derived | x1.134 | x1.002 / x0.846 | x1.047 to x1.074 |
| 6 | `ptFragility` floor | 0.82, gentlest | 0.62, harshest, and needs 1.5 WAR before the dock eases | 0.82 |
| 7 | `warDurability` | deleted 2026-08-25 | deleted | deleted |
| 8 | `growthPremium` decay onset | 30 | **28**, slope 0.20 instead of 0.15 | 30 |
| 9 | Trade card `jobSecurity` override | none | keyed on wRC+ instead of WAR: 105+ locks at 1.0, then 0.95 / 0.85 / 0.75, and **0.90 / 0.76 / 0.64 for a left-handed bat** | none |

So a catcher gets: a WAR haircut and a PA haircut, offset by a scarcity premium, a gentler fragility
floor, and a higher keeper bar. A 1B/DH gets: a WAR refund and the lowest keeper bar, offset by a
scarcity discount, the harshest fragility floor, the earliest aging decay, and a bat-keyed job-security
escape hatch.

### 5b. What the market itself says

Two empirical readings off Tom's own Oopsy export, both new to this document.

**Reading 1. The calculator's own positional adjustment is nearly flat.**

| POS | n (PA >= 100) | mean aPOS | mean $ |
|---|---|---|---|
| C | 19 | 13.20 | 11.14 |
| OF | 75 | 13.10 | 15.31 |
| SS | 21 | 13.00 | 18.06 |
| 2B | 39 | 12.61 | 10.78 |
| 1B | 43 | 11.68 | 13.73 |
| 3B | 23 | 11.60 | 10.53 |

The whole catcher-over-first-base premium inside the market number is about **$1.50**. Hotsheet then
layers its own position machinery (items 1 through 9 above) on top of that number.

**Reading 2. Actual eligibility scarcity in a 20-team league is enormous.**

Rest-of-season dollars of the Nth best bat at each position, counting every eligibility:

| POS | pool | #5 | #10 | #20 | #30 | #40 | #60 |
|---|---|---|---|---|---|---|---|
| C | 90 | 18.1 | 10.4 | **0.5** | -5.4 | -8.9 | -13.8 |
| SS | 112 | 25.2 | 19.6 | 12.9 | 8.1 | 2.5 | -8.9 |
| 2B | 144 | 17.5 | 15.5 | 12.4 | 7.4 | 3.4 | -6.3 |
| 3B | 136 | 20.5 | 16.2 | 9.6 | 3.2 | 1.2 | -6.6 |
| 1B | 103 | 27.3 | 22.7 | 14.8 | 8.5 | 4.9 | -7.7 |
| OF | 274 | 31.6 | 25.2 | 20.0 | 17.4 | 16.0 | 11.0 |
| DH | 139 | 27.3 | 20.8 | 17.6 | 14.2 | 10.1 | 1.6 |

In a 20-team league with one catcher slot you need 20 starting catchers. The 20th costs **$0.5**. The
20th first baseman costs **$14.8**. That is a $14 replacement-cost gap that the flat aPOS does not
contain and that a 12% scarcity multiplier does not come close to reproducing.

### 5c. The debate, positions worth arguing

**Argument 1. The scarcity premium is far too small, or it is in the wrong place. PARTLY ADDRESSED.**

As of 2026-08-25 the multiplier is derived from the pool rather than from priors, and it was also
found to be **inert**: it had not reached Keep or Overall for anyone since 2026-08-07. It now applies
once, to the season vector. The magnitude question below is still open, because a multiplier is the
wrong SHAPE for a replacement-cost gap however it is calibrated.

For: the table above. Replacement cost at catcher in this league is a cliff, not a 12% tilt. A model
that prices a catcher at 1.12x an equivalent bat is not describing the same league the auction is.

Against: Hotsheet's chips are meant to be **asset values, not roster-construction advice**. What a
replacement at your position costs you is a function of your roster, not of the player. Two teams
should not see different Now values for the same catcher. The counter-counter: the auction dollars the
model is anchored to are themselves league-configured, so the model is already league-relative, just
league-relative to *someone else's* league config.

Middle path worth considering: keep player value position-blind, and surface the replacement-cost gap
as a separate roster-context number rather than baking it into the chip.

**Argument 2. The 1B/DH treatment may be a triple credit.**

A DH currently gets his positional penalty refunded in keeper WAR (+1.79), keeps the lowest keeper bar
of any hitter (2.0 instead of 2.4), and gets a wRC+-keyed job-security escape on the trade card. The
offsets (a -0.10 scarcity prior, a 0.62 fragility floor, earlier aging) are multiplicative tilts of
10 to 20 percent, while the WAR refund is an additive 1.79 on a bar of 2.0. In margin-over-bar terms
the refund can be worth more than every offset combined.

For the current design: the WAR refund is correcting a real accounting artifact, and a mashing corner
bat genuinely is kept on the bat. The per-season netting cuts him off quickly once the decayed bat
crosses the bar, which is the intended thin margin for error.

Against: two different mechanisms (the bar, and the refund) are both trying to express "judge him on
the bat", and neither knows about the other.

**Argument 3. Catcher Upside is priced at full-time playing time. RESOLVED 2026-08-25.**

`upsideValueScale` runs on per-600 rates with no catcher volume adjustment. The 15% catcher PA haircut
lives in `fantasyWar`, which Upside never touches. So a catcher's Upside chip, and the talent lens that
feeds Keep and Overall for every catcher, both assume he takes a full complement of plate appearances.
This was a genuine gap rather than a judgment call, and it is now fixed: `catcherVolume` applies to
the ceiling and therefore to the talent lens that feeds Keep and Overall. It costs a 115+ wRC+ catcher
about $2 of Upside, which the scarcity premium now reaching Keep roughly offsets.

**Argument 4. Framing retention at 70% may be too generous for catchers specifically.**

`defKeep = 0.70 * sbAgeFactor` retains most of DEF into keeper value on a playing-time-insurance
theory. For a catcher, DEF is overwhelmingly framing, which is the single most job-securing skill in
baseball, so the theory arguably applies *more* strongly. But framing also decays and is coach and
pitcher dependent, and the erosion curve borrowed from speed (`sbAgeFactor`) has no particular reason
to describe framing. A catcher-specific retention curve, or an explicit "framing does not age like
range" carve-out, is a live option.

**Argument 5. Catcher aging is not modeled at all.**

Catchers age worse than other hitters in real life: the squat is cumulative. The model gives them the
standard hitter curve (`ageRetention` onset 30, slope 0.06) while simultaneously classifying them as a
**premium** position for durability purposes, which makes them *more* durable than a corner bat. Those
two facts pull in opposite directions and neither is calibrated against catcher-specific aging data.

**Argument 6. DH eligibility is a trap the -0.10 prior may understate.**

A DH-only bat can only fill UTIL. In the baseline slots there are 2 UTIL spots per team, so 40 league
wide, against a DH-eligible pool of 139. But the same slots can be filled by any bat, so a DH-only
player's true marginal value is the gap over the best *unrostered* bat of any position, which the OF
row shows is around $11 at #60. That is a much steeper penalty than -10%.

**Argument 7. Should position enter Now at all?**

Currently Now takes half the scarcity multiplier, on the "a run is a run today" theory, and takes
`ptFragility` at full strength through the `jobSecurity` layer. An alternative view: Now is explicitly
the market-anchored chip, the market already contains the aPOS adjustment, and layering a second
positional tilt on it is double-counting by construction. The cleanest version of this argument says
position should touch **Keep and Overall only**, since those are about holding a roster spot for years,
and Now should be purely rate times reps.

### 5d. Three coherent alternatives to put to Gemini

**Option A. Position-blind value plus an explicit replacement curve.**
Delete `scarcityMult`, the split `keeperBarFor`, and the positional pieces of `ptFragility` and
`warDurability`. Replace all of it with one derived quantity per position: the value of the Nth best
eligible player, where N = teams x slots for that position, computed live off the export (the table in
5b is exactly this). Value becomes surplus over the position's own replacement. One knob, empirically
grounded, recomputed as the pool changes.
Cost: it makes chips league-config dependent in a much more visible way, and shallow-pool positions get
volatile when a single injury moves the Nth player.

**Option B. Keep the multiplier stack, recalibrate the priors from the market.**
Regress auction dollars on position dummies at equal projected production, and set `SCARCITY_PRIOR`
from the residuals rather than from priors. Cheap, low risk, keeps every existing behavior.
Cost: it inherits whatever league the export was configured for, and the aPOS flatness suggests that
league is not a 20-team, one-catcher league.

**Option C. Split the two questions apart.**
Price the bat position-blind (production, playing time, age, survival). Then apply exactly one
positional term, derived from the user's own slot configuration, and apply it only to Keep and Overall.
Now stays pure market rate times reps. This is close to what the code is reaching for already: the
half-weight scarcity in Now is a compromise between "position matters" and "not today it doesn't".

---

## 6. Open calibration questions unrelated to position

Status after the 2026-08-25 pass.

1. ~~Now floors at 0~~ **FIXED.** Now goes negative, landing on his own auction dollars. Overall
   still floors at 0 on purpose: an asset you can release is worth no less than nothing.
2. ~~`PA_CEILING` is the highest remaining PA in the export~~ **FIXED.** Full time is now
   `remainingGames x 4.4`, calibrated to the p90 of real regulars.
3. ~~Two different playing-time normalizations~~ **FIXED.** One function, shared by the engine, the
   board and the trade card.
4. ~~The age under 26 full-talent gate~~ **FIXED**, and replaced by a ramp plus an evidence gate.
5. **Upside ignores WAR entirely.** Still true. A glove-first, low-category bat has a low Upside by
   construction, even when his WAR says he will hold a job for a decade.
5b. **And it ignores runs and RBI**, which are two of the five hitting categories the market prices.
   That is the main structural cause of the residual `Now > Upside` cases: Kyle Schwarber's market
   value is $32.80 against a $25.50 ceiling, because a middle-of-the-order bat's run and RBI totals
   are worth real dollars that `fantasyRate` cannot see. Shohei Ohtani is the other kind of
   exception — at $48.30 he is simply outside the 85th percentile the ceiling is fitted to.
6. **Keep can hugely exceed Now** for prospects. Still true, and still correct by design.
7. ~~`growthPremium` and `warDurability` are dead code~~ **DELETED**, along with the whole legacy
   age-unknown path, `keeperSeasons`, `keeperAgeFactor`, `overallValue` and the baked `futureValue`.
   An ageless player is now assumed to be 26 and runs through the same engine as everyone else.

### Found during the 2026-08-25 passes

8. ~~**The observed lens is not really a rate.**~~ **FIXED in the second pass** by the category-dollar
   decomposition above. The `evidence` gate stays, because "how many reps is this read based on" is a
   real question even once the rate is unbiased.
9. **Positional scarcity was inert for 18 days** (2026-08-07 to 2026-08-25) and nothing caught it,
   because no test asserts that two identical bats at different positions price differently. Still
   worth a handful of invariant tests: Keep <= Upside, a scarce position out-Keeps a deep one at
   equal production, Now returns his auction dollars at his own share. That last one is now an exact
   identity, so it is trivially assertable.
10. ~~**Does Now belong in the position business at all?**~~ **RESOLVED** in the second pass: no, on
    either path.
11. **The two Now paths still disagree by a lot, just not about position.** The same player priced
    in-export reads $14.10 and priced as if absent from the export reads $21.90, because the
    market-anchored path and the WAR-led fallback are different philosophies rather than different
    calibrations. Dropping out of the export is worth +55% of Now. The fallback could be calibrated
    against the anchored path for the players who have both, which is a measurable exercise.
12. **A season-ending IL case reads near the wire line by accident.** `estRosPA` returns 0 reps and
    the severity dock is 0.02, so his deeply negative fixed component gets multiplied to about
    nothing and he lands near $2.60. That happens to be a sane number, but it is arithmetic
    coincidence rather than reasoning: a 0-rep player's honest value on this scale is the full
    accumulation deficit, about -$19. Worth deciding deliberately which one it should be.
13. **The confidence tick keys on WAR alone.** `currentWarProxy` ignores the counting profile, so a
    slap-hitting 60-steal speedster with a 96 wRC+ gets docked as a job-security risk even though the
    steals are exactly why he is in the lineup (Chandler Simpson: market $9.70, Now about $7.50). The
    trade card's `jobSecurity` layer has a counting-stat escape for precisely this case; the model's
    internal `conf` does not. They should probably share one definition.

---

## 8. Requested changes that were NOT made, and why

Three items from the 2026-08-25 request were deliberately left alone.

**Pro-rating `FA_LINE` by the share of season remaining.** The reasoning behind the request is right
in general: subtracting a full-season wire line from a shrinking pool overstates the deduction. But
in this model every chip is already denominated in remaining-season dollars, because the per-PA rate
comes from a rest-of-season export and is re-applied over a rest-of-season pool. `FA_LINE = 3` was
itself calibrated against that same August export, so it is already an ROS-space number and
pro-rating it again would double-apply the shrinkage. Doing this properly means recalibrating
`FA_LINE` as a full-season figure and pro-rating consistently through the display conversion, which
moves every displayed number on every chip. Worth doing deliberately, not as a side effect.

**Anchoring `OV_REPL` to the marginal kept player.** Conceptually right, but circular: a player's
Overall would depend on the Keep values of the whole player universe, which depend on the waiver line
being computed. The only non-circular proxy available is the export's rest-of-season dollars, and
that measures the wrong quantity: the 560th best ROS dollar value in a 560-keeper league is **-$2.70**,
because half the real keepers are prospects with negative ROS value. Anchoring there would inflate
every Overall. A two-pass computation would work on the board, which holds the whole universe, but
not in the trade card, which loads a handful of players, so Overall would depend on what you happened
to have open.

**Echoing `injuryMult` forward into the survival vector.** Done for the arm signal, declined for the
generic one. `injuryMult` is this-season severity: a hamstring strain or an oblique should not
permanently shorten a career, and echoing it forward would make every day-to-day injury a career
event. The arm signal is different in kind, so a live arm injury now adds standing hazard of 3%/yr.

Two smaller judgment calls, flagged rather than silently taken:

- **The 140-inning workload bar** cannot be read off a full-season projection, because none exists in
  the data: the export carries rest-of-season innings only. It is pro-rated (`ROS ip x 162 /
  remaining games`), which is sound for an established starter and noisy for an August call-up, so
  the penalty is scaled down for young arms.
- ~~**The left-handed corner-bat dock** overlaps with `platoonDock`~~ **FIXED in the second pass.**
  The anticipated charge now lives in its own multiplier (0.95 / 0.89 / 0.85 by wRC+ tier) rather
  than inside the job-security floor, and the layer applied is `min(anticipated, observed)`. A
  left-handed 1B with a visible timeshare went from a 0.653 combined multiplier to 0.731; the same
  bat with a full role is unchanged at 0.756, so the anticipation still bites when there is nothing
  observed yet. An elite bat (105+ wRC+) is untouched either way.

---

## 7. Reference, the constants in one place

```
YEAR_DISCOUNT     0.72     Keep's per-year decay
KEEPER_HORIZON    7        seasons in the Keep window
KEEPER_NORM       2.76     normalizer, prime-age lands about 1.15
OV_DISCOUNT       0.85     Overall long-tail decay
OV_NEAR_DISCOUNT  0.70     Overall year-1 step
OV_NORM           4.171    the 8-season reference career
OV_REPL           0.70     Overall waiver line, before depth scaling
DYN_W             0.70     weight of the production layer, non-export path only
AUCTION_DIV       5        dollars per unit
FA_LINE           HIT 3, SP 1, RP 3
PA_PER_GAME       4.4      calibrated to p90 of hitters with 100+ ROS PA
full time         remainingGames(asOf) * PA_PER_GAME  (150 PA at the 08-18 export date)
UPSIDE_SCALE      0.68 hitters, 1.0 pitchers
defKeep           0.30 present, 0.70 * sbAgeFactor keeper
catcher volume    0.85 base, 0.90 ceiling, buy-back over 40 wRC+ points
SCARCITY_K        0.15 per value-unit of replacement gap, band [0.80, 1.30]
pitcher hazard    0.06 floor at every age; +0.03 arm injury; +0.07 max workload
prePeakFloor      clamp((26 - age)/5, 0, 1)
evidence          clamp((repsFrac - 0.15)/0.45, 0, 1)
NEG_POS_ADJ       LF/RF -7.5, 1B -12.5, DH -17.5 runs
runs per win      9.774
```
