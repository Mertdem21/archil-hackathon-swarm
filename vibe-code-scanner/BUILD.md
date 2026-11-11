# Build spec: vibe-code scanner demo

This spec closes the map in `wayfinder/map.md`. Every decision behind it is in a closed ticket under `wayfinder/tickets/`.

## What it does

`npm run scan` in `scanner/` uploads `demo-repo/` into one Archil sandbox, forks it three times, and runs one checker in each fork in parallel. Each checker writes findings. `npm run score` compares the findings with `answer-key/seeded-bugs.json` and prints the scoreboard: caught X of 10 seeded bugs, with Y false alarms.

## Layout

| Path | Owner | Content |
|---|---|---|
| `demo-repo/` | done | ShopLite, the target repo with 10 seeded bugs and 2 decoys |
| `answer-key/seeded-bugs.json` | done | The answer key. Checkers never read it. |
| `scanner/src/types.ts` | done | The contract: `Finding`, `BUG_CLASSES`, `Checker`, `REPO_DIR` |
| `scanner/src/llm.ts` | done | Host-side Claude calls (`ask`, `parseJsonArray`) |
| `scanner/src/sandbox.ts` | done | `createRepoSandbox`, `destroy` |
| `scanner/src/orchestrator.ts` | agent A | Base sandbox, 3 forks, run checkers, write outputs |
| `scanner/src/checkers/package.ts`, `package_check.py` | agent A | Package checker |
| `scanner/src/checkers/security.ts` | agent B | Security checker |
| `scanner/src/checkers/testcheat.ts` | agent C | Test-cheat checker |
| `scanner/src/scorecard.py` | agent C | Scoreboard on real data |
| `scanner/out/findings/<checker>.jsonl` | runtime | One `Finding` per line |
| `scanner/out/logs/<checker>.log` | runtime | Progress lines, for tmux panes |

## Contract

- Every checker module exports `run: Checker` from `types.ts`. It gets its own fork and a `log` function, and it returns `Finding[]`.
- `class` must be one of `BUG_CLASSES`. An unknown class counts as a false alarm.
- `file` is relative to the repo root, for example `app/db.py`.
- Claude runs on the host through `llm.ts`. The API key never goes into a sandbox.
- Each checker has a 2-minute limit. The orchestrator writes an empty findings file for a checker that fails or times out, and the scan goes on.

## Checkers

- Security: `pip install bandit`, run `bandit -r /app -f json` in the fork, then one Claude call triages the results and the flagged code. It keeps real problems, drops decoys, and adds XSS that bandit misses.
- Package: `package_check.py` (standard library only) runs in the fork. It parses `requirements.txt` and every `import` in the repo. It calls `https://pypi.org/pypi/<name>/json`. A 404 for a declared package is `hallucinated-package`. An import that is neither standard library, a local module, nor declared, and that returns 404, is `undeclared-import`. No LLM. Download counts are skipped, because the sandbox cannot reach pypistats.org.
- Test-cheat: the checker reads every `.py` file from the fork with `cat`, then one Claude call looks for `special-casing`, `empty-test` and `duplicated-code`.

## Scoring

Each seeded bug and decoy in the answer key has a line range. A finding matches the nearest target with the same file and class when its line is within that range, plus or minus 3 lines. A seeded bug is caught when at least one finding matches it. Several findings for one bug count once and are not false alarms. A false alarm is a finding that matches a decoy (labeled with the decoy id) or matches nothing. File-and-class matching alone was dropped, because it let decoy hits count as catches and let one package finding catch two bugs.

## Timeline

| Minutes | Work |
|---|---|
| 0 to 10 | Setup: keys, `npm install`, read the map |
| 10 to 60 | Agents A, B and C build their parts |
| 60 to 80 | Join and run one full scan |
| 80 to 100 | Fix misses, rehearse twice |
| 100 to 120 | Buffer. Confirm again that the fake package names return 404. |

## Cut order

1. The tmux panes.
2. The LLM triage in the security checker. Map bandit test ids straight to classes.
3. The forks. Run all checkers in one sandbox, one after the other.

The scoreboard is never cut.

## Status (2026-11-10)

All parts are built and `npx tsc` passes. One live `npm run scan` caught 10 of 10 seeded bugs with 0 false alarms in 48.7 s. Most of that time is the base sandbox upload, which sends files one at a time. The tmux panes must tail `out/logs/test-cheat.log` (not `testcheat`). To test one checker, run `npx tsx --env-file-if-exists=.env src/dev/run-one.ts <security|package|testcheat>`.
