---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-07-24T05:26:32.339Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 02 | unrun-verify | Doom/Claude Opus 4.8/GSD/index.html |  | Coverage D10: real-browser confirmation (file:// + static server, empty DevTools console) after adding js/level.js to the load order — delegated to the orchestrator's browser pass | open |  | 2026-07-24T00:58:40.386Z |  |
| 2 | 02 | unrun-verify | Doom/Claude Opus 4.8/GSD/index.html |  | 02-03: 8-step live browser confirmation (mouse-look feel, slide-vs-stick, Escape->arrow fallback, tab-switch survival, resize crispness, empty console/network) from file:// and static server — delegated to orchestrator browser pass | open |  | 2026-07-24T05:26:32.339Z |  |

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
  }
]
````
