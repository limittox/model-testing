---
phase: 06-hud-audio-game-state-machine
plan: 03
subsystem: audio
tags: [web-audio, audiocontext, autoplay-policy, oscillator, white-noise-buffer, biquad, dynamics-compressor, gain-envelope, headless-harness]

# Dependency graph
requires:
  - phase: 05-enemy-ai-weapons-pickups
    provides: the Sound.play(name) recording hook and its preallocated ring, the ONE wired pickup call site, Weapons.fire/TABLE/lastDryFire, Enemies.spawnProjectile/hurt, Combat.damagePlayer
  - plan: 06-01
    provides: Sound.unlock() / Sound.unlockCalls as the AUD-03 gesture seam, Input.gestureHook, and Game.handleGesture calling unlock as the FIRST action of the single start gesture
  - plan: 06-02
    provides: the false-to-true Weapons.lastDryFire edge inside Weapons.update that the out-of-ammo message hangs on — the dry click now shares that ONE edge test
provides:
  - "CONFIG.SFX — seven synthesis recipes as data (pistol, shotgun, enemyAttack, enemyDeath, pickup, playerHurt, dryClick), one uniform record shape"
  - "CONFIG.SFX_EVENTS — the ten event-name strings, declared in script 1 so combat.js/enemies.js/weapons.js can reach them despite loading before sound.js"
  - "CONFIG.SFX_MASTER_GAIN / SFX_COMP_* / SFX_NOISE_SECONDS — the master bus tunables"
  - "The Web Audio engine in js/sound.js: the gesture-scoped context behind Sound.context(), the master gain -> compressor -> destination chain, the ONE shared white-noise buffer, and one generic synth(recipe) interpreter"
  - "Sound.RECIPE_FOR — the event-to-recipe table that lets four distinct pickup events share one recipe"
  - "Sound.isAvailable() / Sound.masterNode() / Sound.compressorNode() / Sound.noiseBufferRef() / Sound.lastError — observability with NO public context field"
  - "Five new Sound.play call sites: pistol fire, shotgun fire, the dry click, enemy attack, enemy death, player damage"
  - "tools/verify-audio.cjs — 114 control-paired assertions on a recording AudioContext stub, ALL_AUDIO_CONTRACTS_PASS"
affects: [phase-verification, milestone-close-out]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy constructor resolution as a STRUCTURAL guarantee: reading AudioContext off the global inside unlock() (never at module load) is simultaneously what makes 'no context before the gesture' true and what makes it testable — the harness can only install a stub post-boot if resolution is lazy"
    - "State held in a module-scope variable behind an accessor rather than a public field, specifically so a prior phase's negative assertion ('no ctx field exists') survives the plan that genuinely builds the thing"
    - "Recorder-before-effect: the observable bookkeeping runs and decides the return value BEFORE the fallible subsystem is touched, so a broken subsystem cannot make prior assertions vacuous"
    - "Effects as DATA interpreted by one generic function — no per-effect code path, so 'the six are distinct' is a field-by-field comparison of records rather than a reading of code"
    - "One shared immutable buffer replayed through cheap disposable sources; every source stopped at the end of its own envelope so the graph drains itself"
    - "Two effects on ONE edge test: the out-of-ammo message and the dry click read the same captured false-to-true transition, so they cannot disagree"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/tools/verify-audio.cjs"
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/sound.js"
    - "Doom/Claude Opus 4.8/GSD/js/config.js"
    - "Doom/Claude Opus 4.8/GSD/js/weapons.js"
    - "Doom/Claude Opus 4.8/GSD/js/enemies.js"
    - "Doom/Claude Opus 4.8/GSD/js/combat.js"

key-decisions:
  - "The AudioContext lives in a module-scope variable behind Sound.context(), NOT in a Sound.ctx field — the single most load-bearing decision in the plan. verify-pickups 0d and verify-state 1g-i/1g-ii all assert that no context field exists on Sound at all; an accessor keeps three prior assertions green while the engine genuinely builds a context"
  - "The AudioContext constructor is resolved from the global INSIDE unlock(), at call time. boot.cjs has no AudioContext binding, so a harness can only install a stub AFTER boot — which means assertion 1b (one click => exactly one context) is unpassable against a module-load capture. The mechanism enforces AUD-03 rather than a convention doing it"
  - "The event NAME strings live in CONFIG.SFX_EVENTS (script 1), not in Sound.NAMES, because combat.js (12), enemies.js (13) and weapons.js (14) all load BEFORE sound.js (15) and cannot read Sound.NAMES at their own module-evaluation time. Sound.NAMES is derived from CONFIG.SFX_EVENTS, so the four Phase 5 pickup strings are byte-identical and there is still exactly one spelling of every name"
  - "An EVENT is not a RECIPE: Sound.RECIPE_FOR maps ten events onto seven recipes so the four pickup events stay four pairwise-distinct events at the call sites (which Phase 5 asserts) while sharing one synthesis recipe"
  - "The recorder runs first and unchanged, and the whole synthesis block sits below it inside try/catch. A dozen Phase 5 assertions measure Sound.count/last/ring; if the recorder ran only when audio was available, every one of them would go vacuous in exactly the sandbox the harnesses run in"
  - "The fire sound is played from Weapons.fire() OUTSIDE the pellet loop, beside the recoil and muzzle-flash timers — the one point at which the shot has definitely left the barrel. That is structurally why a seven-pellet shotgun blast is one report and a refused trigger is silent"
  - "The dry click shares 06-02's edge test rather than adding a second one. One captured transition, two effects (a message and a click); two edge tests could disagree"
  - "The player-damage sound hangs on the health ACTUALLY LOST (lost > 0), not on the call: a blocked, zero, non-finite or post-mortem hit is silent"
  - "The noise layer gets a small trim gain of its own so the balance between the tone and the noise is per-recipe data; the shape stays the per-sound bus's job"

patterns-established:
  - "Fault-switch stubs: the recording AudioContext stub carries four fault switches (throw on construct, reject resume, throw on a named factory, or no install at all) so 'it never throws' is falsifiable rather than merely unobserved — a stub that can only succeed proves nothing"
  - "Per-boot scenarios for idempotent seams: unlock() is idempotent by contract, so a context born running, a throwing constructor and a rejecting resume each get their OWN boot rather than being faked in one process"
  - "Graph claims are walked from the recorded connect() log, never read off a field the production code could set without connecting anything"
  - "Comment-stripped source scans with a live control AND a setup assertion that the RAW source really does contain the forbidden words in prose — which is what proves the stripping is why the scan is clean"

requirements-completed: [AUD-01, AUD-02, AUD-03]

coverage:
  - id: D1
    description: "Every sound effect is synthesized at runtime from oscillators, a shared white-noise buffer, gain envelopes and biquad filters — no audio file is fetched, decoded or referenced anywhere in the shipped surface"
    requirement: "AUD-01"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-audio.cjs\" # 1k-i..iii, 3a-i..iii, 3b, 3b-0, 3c, 3d-i..iii"
        status: pass
    human_judgment: false
  - id: D2
    description: "Six distinct effects fire from the real gameplay code paths at the right cardinality: one per shot (not per pellet), one per spawned projectile (not per attempt), one per death (not per overkill hit), one per landed hit (not per blocked one), and one per collection"
    requirement: "AUD-02"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-audio.cjs\" # 2a-0..iii, 2b-0..ii, 2c-0..ii, 2d-0..ii, 2e-0..iv, 2f-i..iv, 2g-i..iii"
        status: pass
    human_judgment: false
  - id: D3
    description: "The six resolve to six provably different recipes producing provably different node graphs, and the additions are proven inert with respect to ammo, kills and damage arithmetic"
    requirement: "AUD-02"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-audio.cjs\" # 2h-i..iv, 2i-0..iii, 2j-i..iv"
        status: pass
    human_judgment: false
  - id: D4
    description: "No AudioContext is constructed before the start-screen gesture — proven through a full pre-gesture frame run and gameplay burst — and the single gesture that starts play constructs exactly one, resumes it only when suspended, and is idempotent across further clicks"
    requirement: "AUD-03"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-audio.cjs\" # 1a-i..v, 1b-i..iv, 1c-i..iii, 1d-i..iii"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every sound routes through a per-sound gain into one master gain, then a compressor, then the destination, so overlapping effects cannot clip and nothing reaches the output directly"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-audio.cjs\" # 1e-i..v, 1f-i..iv"
        status: pass
    human_judgment: false
  - id: D6
    description: "Gain envelopes ramp to a small positive epsilon and never to exactly zero, and everything is scheduled against the context's own clock with every source stopped after it starts"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-audio.cjs\" # 1g-0..iv, 1h-0..iii, 4c-i/ii"
        status: pass
    human_judgment: false
  - id: D7
    description: "Sound.play never throws and never blocks gameplay across four broken-audio scenarios (no constructor, a throwing constructor, a rejecting resume, a throwing node factory), and the Phase 5 recorder semantics survive with no audio at all"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-audio.cjs\" # 1i-i..iv plus controls, 1j-i..iv"
        status: pass
    human_judgment: false
  - id: D8
    description: "Sustained combat allocates no new entities and reuses one noise buffer — 2000 frames leave every list length unchanged, the ring array identical by reference, and the buffer count at one against 123 buffer sources"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-audio.cjs\" # 4-0, 4a-i/ii, 4b-i/ii, 4c-i/ii"
        status: pass
    human_judgment: false
  - id: D9
    description: "The game SOUNDS right in a real browser from file:// and from a static server: no AudioContext warning before the click, audio live immediately after one click, six clearly different effects, no clipping when several overlap, normal play with audio muted or blocked, zero console errors and zero network requests"
    verification: []
    human_judgment: true
    rationale: "Timbre, distinguishability, perceived loudness balance, the absence of audible clipping, real autoplay-policy behaviour and the zero-network/zero-error claims cannot be established from the Node vm sandbox — there is no audio hardware, no compositor and no network stack. The node GRAPH and the SCHEDULING are fully proven headlessly; how it sounds is not. Delegated to the orchestrator."

# Metrics
duration: 41min
completed: 2026-07-25
status: complete
---

# Phase 6 Plan 03: Web Audio SFX Synthesis + the Five Missing Call Sites Summary

**The game gets its voice: one AudioContext built lazily inside the start-screen gesture and nowhere else, a master gain into a compressor into the destination, seven effects synthesized on demand from oscillators, one shared white-noise buffer, sweeping biquads and epsilon-floored gain envelopes — and the five silent gameplay events wired at exactly the branch that commits them. 114 new control-paired assertions, all 781 prior assertions untouched.**

## Performance

- **Duration:** ~41 min
- **Tasks:** 3 of 3
- **Files created:** 1
- **Files modified:** 5
- **Assertions:** 114 new (verify-audio); **895 total across twelve harnesses**

## Accomplishments

- **AUD-03 is structural, not conventional.** `Sound.unlock()` is the only place in the project where `new AudioContext()` appears, and the constructor is read off the global *inside that function*. Assertion 1a installs a working constructor on the global **before** the load handler, then drives 60 real frames **and** a full gameplay burst (a shot, a hit, a kill, a projectile, a collection, 30 steps — 6 recorded events) and asserts the constructor count is still **0** with **0** audio nodes. One click then takes it to exactly **1**; five more clicks leave it at 1 with the same instance by reference while `unlockCalls` still counts all five.
- **The context is held where it cannot break a prior assertion.** `verify-pickups` **0d** and `verify-state` **1g-i/1g-ii** all prove "no AudioContext" partly by asserting `!('ctx' in Sound)`. The engine keeps its context in a module-scope variable behind `Sound.context()`, so the plan that genuinely constructs a context leaves all three of those assertions **byte-identical and green** — 06-01's forward note followed exactly.
- **The master chain is proven by walking the graph, not by reading a field.** The gesture creates exactly one gain and one compressor; the recorded `connect()` log contains master→compressor and compressor→destination, and **does not** contain master→destination. One `Sound.play` then creates a fresh per-sound gain, connects that one node to the **master**, and connects **nothing** to `ctx.destination`.
- **Envelopes cannot throw.** Across all seven recipes, 26 scheduled gain values are **all strictly positive** (smallest `4.000e-4`), 14 of them below 0.01 — so the claim is about real decays, not a constant loud gain — and each recipe ends on exactly one exponential ramp whose target comes from **its own** CONFIG epsilon.
- **Everything is on the context's clock, and that is measured at three different clock readings.** The stub's `currentTime` is advanced to 0, 1.5 and 37.25 and 144 schedules are captured: every time is `>= currentTime at the moment of the call`, values past 37.25 exist (so 1h-i is not passing against a frozen zero), and all 30 sources start and stop with the stop strictly after the start.
- **Four broken-audio scenarios, each in its own boot.** No constructor at all; a constructor that throws; a `resume()` that rejects; a node factory that throws mid-recipe. In every case `Sound.play` returns without throwing, **the recorder still counted every event**, and 60 further frames ran. The rejecting-resume case additionally proves the graph stays usable (a policy refusal is not a broken context), and the throwing-factory case proves the noise-only recipes still build (one broken layer is not a global shutdown).
- **Six effects, six cardinalities, each with its control.** One pistol shot → exactly one report (and zero at empty ammo); one shotgun blast → **one** report while casting all 7 pellet rays; 120 frames of a held trigger at zero ammo → **exactly one** dry click across **120 refusals**, and the count goes to **two** after a real shot re-arms the edge; one spawned projectile → one attack sound, and **zero** when the pool is fully committed; a lethal hit → one death sound, **zero** on five further hits to the corpse and zero on a non-lethal hit; a hit that costs health → one thud, and **zero** for a zero/negative/non-finite/sub-one value or a hit on a dead player.
- **The six are provably different instruments.** All 15 pairs differ across all 14 defining parameters; the peak gains and decays are pairwise distinct; four different layer/filter shapes; exactly one recipe sweeps **upward** and it is the pickup. Played through the stub, the six produce pairwise different `(node-type sequence, first scheduled frequency)` signatures with six distinct starting frequencies.
- **The additions are proven inert, not proven absent.** 12 shots spend exactly 12 rounds; 5 deaths tally exactly 5 kills; `damagePlayer` returns what the locked armor formula independently predicts for six damage values — all measured **with the call sites live and 155+ events recorded during them**.
- **Nothing churns.** 2000 frames of sustained combat: `Entities.list`, the projectile pool, `Enemies.list` and `Pickups.list` all unchanged in length; `Sound.ring` the **same array by reference**; the white-noise buffer created **exactly once** for the whole process against **123** buffer sources; 711 audio nodes built and not one non-finite parameter value or time.

## Task Commits

1. **Task 1 (tdd): the gesture-scoped context, the master chain, the recipe interpreter (AUD-01/AUD-03)** — `cf92f03` (feat)
2. **Task 2 (tdd): the five missing call sites and six distinct effects (AUD-02)** — `2634d31` (feat)
3. **Task 3: self-containment gate, no-churn proof, the final phase regression** — `c71de80` (test)

## Files Created/Modified

**Created**
- `tools/verify-audio.cjs` — 114 assertions in four sections: the context/chain/interpreter (0a-0h, 1a-1k), the six call sites and the distinctness proofs (2a-2j), the self-containment gate (3a-3d), and the no-churn proof (4-0, 4a-4c). It defines a recording `AudioContext` stub (six node factories, `createBuffer`, a settable `state`, `resume()`, `currentTime`, a destination, and AudioParams that capture value + time + the clock at the moment of the call) with **four fault switches**, and installs it on `h.sandbox` **before** `fireLoad()` so the pre-gesture refusal is a refusal rather than an absence of opportunity.

**Modified**
- `js/config.js` — the whole `PHASE 6 — SYNTHESIZED AUDIO` block: `SFX_EVENTS` (ten names), `SFX_MASTER_GAIN`, the five `SFX_COMP_*` compressor settings, `SFX_NOISE_SECONDS`, and `SFX` (seven uniform recipe records). **`js/sound.js` contains no bare frequency, duration, gain or filter literal.**
- `js/sound.js` — internals replaced, surface untouched. Lazy `resolveContextCtor()`, the module-scope `audioCtx`/`masterGain`/`compressor`/`noiseBuffer`/`audioReady` state, `buildMasterChain()`, `buildNoiseBuffer()`, the rewritten `unlock()`, five read-only accessors, `Sound.RECIPE_FOR`, one generic `synth(recipe)`, and `Sound.play` with its Phase 5 guard and recorder **first** and the synthesis below inside try/catch. `Sound.NAMES` gains the five new names and derives all ten from `CONFIG.SFX_EVENTS`.
- `js/weapons.js` — `sound` on each `TABLE` entry, a guarded `playSound()` helper, `playSound(w.sound)` beside the recoil/flash triggers (outside the pellet loop), and `playSound(CONFIG.SFX_EVENTS.DRY_FIRE)` on **06-02's existing** `lastDryFire` edge. No ammo, cooldown, spread or viewmodel behaviour changed.
- `js/enemies.js` — a guarded `playSound()` helper, the attack sound on the path that **activated** a pool entry (immediately before `return p`), and the death sound inside the **same lethal branch** as the kill tally.
- `js/combat.js` — a guarded `playSound()` helper and the damage sound gated on `lost > 0`.

`index.html` was **not** modified: the engine replaced `js/sound.js`'s internals in place, so the shipped list is still the same **19** classic scripts (asserted three ways in 3d). `node --check` is clean on all 19 files.

## Verification Results

**All twelve harnesses print their all-pass tokens in the two chained commands the plan specifies.**

| Harness | Baseline | Now | Δ |
|---|---|---|---|
| verify-phase02 | 38 | 38 | — |
| verify-input-view | 17 | 17 | — |
| verify-motion | 28 | 28 | — |
| verify-render | 66 | 66 | — |
| verify-sprites | 68 | 68 | — |
| verify-combat | 117 | 117 | — |
| verify-weapons | 90 | 90 | — |
| verify-pickups | 84 | 84 | — |
| verify-level | 65 | 65 | — |
| verify-state | 121 | 121 | — |
| verify-hud | 87 | 87 | — |
| verify-audio | — | **114** | new |
| **Total** | **781** | **895** | |

**Every prior count is byte-identical, and NO harness file other than the new one was edited at all in this plan.** No assertion was weakened, relabelled, removed or made vacuous anywhere. The nine Phase 1-5 harnesses total **573** (the plan's Task 3 text quotes the pre-06-01 figure of 571 with `verify-level` at 63; 06-01 deliberately added 10c/10d, which the executor's own regression gate correctly records as 65).

**The planner's flagged WATCH never triggered.** Adding a player-damage call site could in principle have perturbed `verify-pickups` 1h-iii / 1i, which assert exact `Sound.count` values. It did not: that harness's `scenario()` truncates `Enemies.list` in place and deactivates the projectile pool, so no fireball can land mid-proof — and if one could, those assertions already check `Combat.health`, so the hazard was already covered. `verify-pickups` is 84/84 untouched.

Selected measurements, all derived rather than asserted against literals:

- Pre-gesture: **0** constructors and **0** nodes across 60 frames + 6 gameplay events; **1** constructor on the click; **1** after five more clicks.
- Envelopes: **26** gain schedules, all `> 0`, smallest **4.000e-4**, **14** below 0.01, **7** exponential ramps.
- Scheduling: **144** schedules at **3** distinct context clock readings; **30/30** start/stop pairs.
- Distinctness: **15/15** recipe pairs differ across **14** fields; **6** distinct first frequencies; **1** upward sweep.
- Hot path: **2000** frames, **155** events, **711** nodes, **1** buffer, **123** buffer sources, **0** non-finite values.
- Self-containment: **14** forbidden network/media tokens, **0** hits in **19** stripped files, with a raw-source control proving the stripping is why.

## Decisions Made

1. **The context is a module-scope variable behind `Sound.context()`, not `Sound.ctx`.** This is the decision the whole plan hinged on. Three prior assertions (`verify-pickups` 0d, `verify-state` 1g-i and 1g-ii) prove "no AudioContext" partly by asserting no context field exists on `Sound`. Adding the field would have broken all three, and the only permitted fix for a moved prior assertion is correcting production code. The accessor costs nothing and makes the claim *unbreakable* in the harness sandbox rather than merely unbroken.
2. **Lazy constructor resolution, and it is the mechanism rather than a convention.** `boot.cjs` has no `AudioContext` binding, so a stub can only be installed post-boot; a module-load capture would capture `undefined` and 1b could never pass. The property and its proof are the same thing.
3. **Event names live in `CONFIG.SFX_EVENTS`, not `Sound.NAMES`.** `combat.js` (12), `enemies.js` (13) and `weapons.js` (14) all load before `sound.js` (15), so they cannot read `Sound.NAMES` while being evaluated. Putting the strings in script 1 and *deriving* `Sound.NAMES` from them keeps exactly one spelling of every name and keeps the four Phase 5 pickup strings byte-identical.
4. **An event is not a recipe.** Ten events, seven recipes, one table (`Sound.RECIPE_FOR`). The four pickup events stay four pairwise-distinct events at the call sites — which Phase 5 asserts — while sharing the pickup recipe.
5. **The recorder runs first, unchanged, and decides the return value before any audio.** Otherwise a missing audio stack (the state every Phase 1-5 harness runs in) would silently make a dozen prior assertions vacuous. Assertion 1i pairs each broken-audio scenario with a proof that the count still advanced.
6. **The fire sound is played outside the pellet loop**, at the same point as the recoil and muzzle-flash timers. One report per blast rather than one per pellet is then structural, not a matter of care.
7. **The dry click reuses 06-02's edge test rather than adding a second one.** One captured `false → true` transition of `Weapons.lastDryFire`, two effects. Two independent edge tests could drift apart; one cannot.
8. **The player-damage sound is gated on the health actually lost.** Every path that costs nothing is silent, including the reachable `lost === 0` case (a hit arriving with health already floored).
9. **`Sound.reset()` still does not touch the audio graph.** The recorder and the engine are separate concerns; tearing the context down on a restart would cost the player their audio on the click that says "play again".
10. **A separate trim gain for the noise layer.** The balance between the tone and the noise is per-recipe data on its own node; the envelope shape stays the per-sound bus's job. It also makes the recorded node signatures more distinct, which 2i exploits.
11. **The recipes are tuned to differ structurally, not just numerically** — noise-only (shotgun, dry click), tone-only (enemy attack, pickup), both (pistol, enemy death, player hurt); lowpass, bandpass, highpass and none; decays from 0.05s to 0.55s; and exactly one upward sweep.

## Deviations from Plan

### 1. [Rule 3 - Blocking] Event-name strings were placed in `CONFIG.SFX_EVENTS` rather than typed into `Sound.NAMES` alone

- **Found during:** Task 2, at the first line of the weapon-table edit.
- **Issue:** The plan's action step 2 asks that each `Weapons.TABLE` entry "name its own sound event name" while action step 1 puts the names in `Sound.NAMES`. `Weapons.TABLE` is built at `js/weapons.js` module-evaluation time — script **14** — and `js/sound.js` is script **15**. `Sound` does not exist at that line, so `sound: Sound.NAMES.PISTOL` would throw during boot and take the whole page down. The same problem applies to `js/enemies.js` (13) and `js/combat.js` (12) at *call* time only, which a `typeof` guard handles — but the table is evaluated at load, where a guard cannot help.
- **Fix:** The ten name strings are declared in `CONFIG.SFX_EVENTS` (`js/config.js`, script 1, which every file can read), `Sound.NAMES` is **derived** from them, and the weapon table reads `CONFIG.SFX_EVENTS.PISTOL` / `.SHOTGUN`. Both of the plan's intents are preserved — the entry names its own sound, and the names are data shared by call sites and proofs rather than re-typed literals — and the four Phase 5 pickup strings are byte-identical, so `verify-pickups` reads exactly the same values.
- **Verification:** `verify-pickups` 84/84 (its `Sound.NAMES` reads are unchanged); `verify-audio` 0g asserts the four Phase 5 names explicitly; 2a-0 asserts the table's `sound` fields equal `CONFIG.SFX_EVENTS` entries.
- **Committed in:** `cf92f03` (the CONFIG block) and `2634d31` (the table edit).

### 2. [Rule 1 - Bug] Four of my own section-1 assertions counted events across a frame run that now legitimately makes sounds

- **Found during:** Task 2, immediately after the five call sites landed. `verify-audio` went 58 → 54.
- **Issue:** Assertion 1i's four broken-audio scenarios each played N explicit events and then drove 60 real frames to prove gameplay continues, asserting `Sound.count === N` **afterwards**. Before Task 2 the only wired call site was the pickup, so 60 frames of a live level made no sound. After Task 2 they correctly make several (an enemy attack, a fireball landing). The production code was right; the harness was measuring the level rather than the recorder.
- **Fix:** the count is now captured immediately after the explicit plays and **before** the frame run, with the reason commented at the helper. The frame run still happens and is still asserted (`Game.time > 0`) — and it is now *stronger*, because it drives all five new call sites through the broken audio stack.
- **Verification:** `verify-audio` back to 58/58 at Task 2, 98/98 with section 2, 114/114 with sections 3-4. No assertion was removed or weakened; only the measurement point moved, inside a file this plan created.
- **Committed in:** `2634d31`.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug). **No Phase 1-5 or earlier-Phase-6 harness file was edited at all in this plan** — the W3 contingency never fired, and no scenario-setup line was added to any prior harness.
**Impact on plan:** No scope creep. Deviation 1 was a load-order impossibility in the plan text; deviation 2 was a measurement point in this plan's own new harness.

## Issues Encountered

None beyond deviation 2. Sections 2, 3 and 4 each passed on their first run (40, 10 and 6 new assertions respectively).

One thing worth recording because it *looks* like a discrepancy and is not: `grep -c 'script src' index.html` reports **20**, because `index.html`'s load-order contract comment contains the prose phrase `<script src>`. `boot.cjs`'s deliberately narrow tag regex — and therefore assertions 3d-i and 3d-iii — correctly see **19** real tags, matched name-for-name against the 19 files in `js/`.

## Known Stubs

**None.** Every branch this plan owns is implemented and measured. The `Sound.unlock()` and `Sound.play()` seams that 06-01 and 06-02 both listed as the phase's last open stubs are now filled, and no new seam was created.

## User Setup Required

None — no external service configuration. Zero dependencies, no build step, no audio assets.

## Delegated to the Orchestrator (in-browser audio play-test)

Everything automatable was automated: the node graph, the routing, the scheduling, the cardinality of all six events, the four broken-audio paths and the no-churn proof are all measured headlessly. What a Node vm cannot establish is what it **sounds like**. From a real browser, from `file://` **and** from a static server:

1. Load the page and open the console: **no AudioContext warning of any kind before you click** (the classic autoplay-policy log).
2. Click once: play starts, the cursor is captured, and audio is **immediately live** — the first pistol shot makes a sound with no second click needed.
3. Fire the pistol; pick up and select the shotgun and fire it. Two clearly **different** reports, the shotgun heavier and longer.
4. Run a weapon dry with the trigger **held**: one short click, not a machine-gun of clicks.
5. Let an enemy shoot at you, take a hit, and kill an enemy: three more clearly different sounds, the incoming fireball unmistakable from your own gun.
6. Collect each of the four item types: a bright rising blip, the same one each time.
7. Trigger several at once (fire into a group while taking a hit): **no clipping, crackle or distortion** — the compressor's job.
8. Confirm the game plays **normally with audio blocked** (mute the tab, or start the browser muted): no errors, no stalls, no missed frames.
9. Zero console errors and **zero network requests** from both origins — the network panel must show only the page, the stylesheet and the nineteen scripts.

**rAF-throttle caveat:** on a non-composited pane the loop does not tick — drive frames manually with `Game.step(0.016)` + `Game.view.render()` + `Framebuffer.present()` + `HUD.render()`.

## Next Phase Readiness

**This completes plan 3 of 3 in phase 6, which is the final phase of the v1.0 milestone.** The core value is now true end to end and audible: open the page, read the controls on the title screen, click once to start (which captures the mouse and unlocks audio in the same gesture), fight through the level with a live HUD and synthesized sound, and reach the exit or die — then click to play again.

Notes for the phase verifier and the milestone audit:

- **The full regression is 895 assertions across twelve harnesses**, in two chained commands (see Verification Results). The nine Phase 1-5 harnesses are at **573** (38, 17, 28, 66, 68, 117, 90, 84, 65) — the 571 quoted in some plan text predates 06-01's deliberate `verify-level` 10c/10d addition.
- **The exact Sound event set and its call sites** (`CONFIG.SFX_EVENTS` name → file):
  - `pistolFire` / `shotgunFire` → `js/weapons.js`, `Weapons.fire()`, after the pellet loop, from `w.sound`
  - `dryClick` → `js/weapons.js`, `Weapons.update()`, on the `lastDryFire` false→true edge (shared with 06-02's message)
  - `enemyAttack` → `js/enemies.js`, `Enemies.spawnProjectile()`, on the path that activated a pool entry
  - `enemyDeath` → `js/enemies.js`, `Enemies.hurt()`, inside the lethal branch beside `Game.kills += 1`
  - `playerHurt` → `js/combat.js`, `Combat.damagePlayer()`, gated on `lost > 0`
  - `pickupHealth` / `pickupArmor` / `pickupAmmo` / `pickupWeapon` → `js/pickups.js`, `Pickups.collect()` (Phase 5, **untouched**)
- **The one place an AudioContext can be constructed** is `Sound.unlock()` in `js/sound.js`, called only by `Game.handleGesture` from `Input.onClick`. There is no other `new AudioContext` anywhere, and the constructor is resolved lazily from the global at call time.
- **The four broken-audio scenarios covered by 1i:** no constructor on the global at all; a constructor that throws; a `resume()` that returns a rejected promise; a node factory that throws mid-recipe. Each in its own boot, each paired with a proof that the recorder still advanced.
- **No Phase 1-5 harness setup was adjusted in this plan.** The only such adjustment anywhere in phase 6 remains 06-01's `Game.setState('playing')` line (one per harness, plus one inside `verify-combat`'s `scenario()` helper), documented in 06-01-SUMMARY deviation 2.
- **The only outstanding work in the milestone is human judgment**: the in-browser play-tests delegated by 06-01 (the arcade loop), 06-02 (the HUD) and this plan (audio). All three lists are in their respective summaries.

No blockers.

## Self-Check: PASSED

- `Doom/Claude Opus 4.8/GSD/tools/verify-audio.cjs` — FOUND
- `Doom/Claude Opus 4.8/GSD/js/sound.js` / `js/config.js` / `js/weapons.js` / `js/enemies.js` / `js/combat.js` — FOUND
- `.planning/phases/06-hud-audio-game-state-machine/06-03-SUMMARY.md` — FOUND
- Commits `cf92f03`, `2634d31`, `c71de80` — all FOUND in git log
- Twelve all-pass tokens re-verified in the plan's two chained commands after the final task commit
- `node --check` clean on all 19 shipped JS files; `index.html` unmodified by this plan (19 real `<script src>` tags)
- `!('ctx' in Sound) && !('audioContext' in Sound)` re-verified live in the harness (assertion 0b)

---
*Phase: 06-hud-audio-game-state-machine*
*Completed: 2026-07-25*
