---
schema_version: 1
open_count: 7
waived_count: 0
fixed_count: 0
total_count: 7
last_updated: 2026-07-25T06:45:23.952Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 02 | unrun-verify | Doom/Claude Opus 4.8/GSD/index.html |  | Coverage D10: real-browser confirmation (file:// + static server, empty DevTools console) after adding js/level.js to the load order — delegated to the orchestrator's browser pass | open |  | 2026-07-24T00:58:40.386Z |  |
| 2 | 02 | unrun-verify | Doom/Claude Opus 4.8/GSD/index.html |  | 02-03: 8-step live browser confirmation (mouse-look feel, slide-vs-stick, Escape->arrow fallback, tab-switch survival, resize crispness, empty console/network) from file:// and static server — delegated to orchestrator browser pass | open |  | 2026-07-24T05:26:32.339Z |  |
| 3 | 05 | deviation | Doom/Claude Opus 4.8/GSD/js/enemies.js |  | ENEM-04/ENEM-05 gap: hurt() sets the death state but the pain reaction, death animation, corpse and kill count are plan 05-03; an enemy in the death state falls through the state switch | open |  | 2026-07-25T03:36:47.001Z |  |
| 4 | 05 | stub | Doom/Claude Opus 4.8/GSD/js/sound.js |  | Sound.play(name) is a RECORDING HOOK, not audio: it records the event and returns, creating no AudioContext. Intentional per the 05-CONTEXT phase boundary (audio is Phase 6 AUD-01/02/03, which replaces the body with Web Audio synthesis and adds the firing/enemy-death/player-damage call sites). Only the PICK-05 pickup call site is wired. | open |  | 2026-07-25T05:20:52.542Z |  |
| 5 | 05 | unrun-verify | Doom/Claude Opus 4.8/GSD/index.html |  | 05-04: real-browser play-test of the full combat loop (walk the populated level, fight, take damage, collect health/armor/ammo/shotgun, watch the message appear and fade, confirm collected items vanish and cannot be retaken) from file:// and a static server with zero console/network errors — delegated to the orchestrator's browser pass; a headless proxy driving Game.step(0.016)+render+present is green | open |  | 2026-07-25T05:20:53.232Z |  |
| 6 | 06 | stub | Doom/Claude Opus 4.8/GSD/js/hud.js |  | HUD.render draws nothing in the playing state — 06-02 fills the status bar/crosshair/minimap/damage flash branch | open |  | 2026-07-25T06:45:23.371Z |  |
| 7 | 06 | stub | Doom/Claude Opus 4.8/GSD/js/sound.js |  | Sound.unlock() only counts the call and returns false — 06-03 replaces the body with the AudioContext construction and resume | open |  | 2026-07-25T06:45:23.952Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "02",
    "file": "Doom/Claude Opus 4.8/GSD/index.html",
    "line": null,
    "description": "Coverage D10: real-browser confirmation (file:// + static server, empty DevTools console) after adding js/level.js to the load order — delegated to the orchestrator's browser pass",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-24T00:58:40.386Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "unrun-verify",
    "phase": "02",
    "file": "Doom/Claude Opus 4.8/GSD/index.html",
    "line": null,
    "description": "02-03: 8-step live browser confirmation (mouse-look feel, slide-vs-stick, Escape->arrow fallback, tab-switch survival, resize crispness, empty console/network) from file:// and static server — delegated to orchestrator browser pass",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-24T05:26:32.339Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "05",
    "file": "Doom/Claude Opus 4.8/GSD/js/enemies.js",
    "line": null,
    "description": "ENEM-04/ENEM-05 gap: hurt() sets the death state but the pain reaction, death animation, corpse and kill count are plan 05-03; an enemy in the death state falls through the state switch",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-25T03:36:47.001Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "stub",
    "phase": "05",
    "file": "Doom/Claude Opus 4.8/GSD/js/sound.js",
    "line": null,
    "description": "Sound.play(name) is a RECORDING HOOK, not audio: it records the event and returns, creating no AudioContext. Intentional per the 05-CONTEXT phase boundary (audio is Phase 6 AUD-01/02/03, which replaces the body with Web Audio synthesis and adds the firing/enemy-death/player-damage call sites). Only the PICK-05 pickup call site is wired.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-25T05:20:52.542Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "unrun-verify",
    "phase": "05",
    "file": "Doom/Claude Opus 4.8/GSD/index.html",
    "line": null,
    "description": "05-04: real-browser play-test of the full combat loop (walk the populated level, fight, take damage, collect health/armor/ammo/shotgun, watch the message appear and fade, confirm collected items vanish and cannot be retaken) from file:// and a static server with zero console/network errors — delegated to the orchestrator's browser pass; a headless proxy driving Game.step(0.016)+render+present is green",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-25T05:20:53.232Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "stub",
    "phase": "06",
    "file": "Doom/Claude Opus 4.8/GSD/js/hud.js",
    "line": null,
    "description": "HUD.render draws nothing in the playing state — 06-02 fills the status bar/crosshair/minimap/damage flash branch",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-25T06:45:23.371Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "stub",
    "phase": "06",
    "file": "Doom/Claude Opus 4.8/GSD/js/sound.js",
    "line": null,
    "description": "Sound.unlock() only counts the call and returns false — 06-03 replaces the body with the AudioContext construction and resume",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-25T06:45:23.952Z",
    "resolved_at": null
  }
]
````
