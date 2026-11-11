# Vibe-code scanner (Archil hackathon, 2026-11-10)

Three checker agents scan a small vibe-coded repo with 10 seeded bugs. Each checker runs in its own Archil sandbox fork. The output is "caught X of 10 seeded bugs, with Y false alarms".

The plan is in `wayfinder/map.md`. Terms are in `GLOSSARY.md`. The Archil starter kit is in `archil-starter copy/`.

## Who builds what

Three people work in three lanes. They share one contract: the event file described below. The visual map is at https://claude.ai/artifact/BDrpyJPi3nYCfPXyj7MJHf.

| Lane | Owns |
|---|---|
| Lead | The demo repo in `demo-repo/` with 10 seeded bugs and 2 decoys, `answer-key.json`, the scorer, and the pitch. |
| UI | The swarm view: three forks start, run, and report findings, then the score. Builds against `sample/events.jsonl` until real runs exist. |
| Engine | The live fork test, one checker runner with three prompts (security, package, test-cheat), and the fork runner. |

The engine uses one checker program with three prompts, not three programs.

## Contract: `runs/<run-id>/events.jsonl`

The engine appends one JSON object per line. The UI reads the file and shows each event. Every event has `ts` (ISO time), `type`, and, for fork events, `checker`.

| `type` | Extra fields |
|---|---|
| `run_started` | `run_id`, `repo`, `checkers` |
| `fork_started` | `checker`, `sandbox_id`, `fork_ms` |
| `log` | `checker`, `text` |
| `finding` | `checker`, `file`, `line`, `class`, `reason`, `evidence` |
| `fork_done` | `checker`, `exit_code`, `duration_ms` |
| `score` | `caught`, `total`, `false_alarms`, `missed` (list of answer-key IDs) |

The scorer matches a finding to the answer key on `file` and `class`. Checkers never read the answer key.

### Optional events for the swarm dashboard

The engine already writes `tool_call` events and a `run_started.agents` list. The dashboard uses them. These extra events are optional. If the engine does not write them, the dashboard leaves that panel empty.

| `type` | Extra fields | What the dashboard shows |
|---|---|---|
| `tool_call` | `checker`, `tool`, `input`, `ms`, `ok` | The current action of the agent. A file path or glob in `input` counts as a read of that file. |
| `file_read` | `checker`, `file` | A read of one file. Use it when `tool_call` input does not name the file. |
| `disk_write` | `checker`, `path`, `bytes`, `op` (`write`, `append`, `mkdir`, or `delete`) | The disk writes panel, grouped by fork. |
| `fleet_spawned` | `fleet`, `parent`, `reason`, `trigger` (`checker`, `file`, `line`, `class`), `agents` (same shape as `run_started.agents`) | A notification and a new fleet group. |

A `fork_started` event can carry `fleet` to put the agent in a fleet. Without it, the agent is in the initial sweep.

Progress for one agent is the number of its files read, divided by the number of files in its `agents[].files` list. It stays at 95% or less until `fork_done`, then it goes to 100%.

## Swarm dashboard

Run `node ui/server.mjs` from the repo root, then open http://localhost:4317. The server has no dependencies.

- Live: the page reads `runs/<run-id>/events.jsonl` every 0.7 seconds and shows new events.
- Replay: the page plays a finished run with its real timing at 1x, 3x, or 8x. Use `?run=<id>&replay=3` to start a replay from a link.
- Still frame: `?run=<id>&at=22.5` stops the replay at second 22.5. Use it for screenshots.

The run `sample-swarm` shows every panel. It is the real run `test-isolated-3` plus made-up disk writes and two made-up fleets. To make it again, run `python3 -I ui/make_swarm_sample.py`.

### Swarm runs

`npm run swarm -- --agents N --mode isolated|shared|disk` in `scanner/` writes the same file, with these additions. Each agent has an id such as `security-2`, and every event puts that id in `checker`.

| Mode | Compute | Shared state |
|---|---|---|
| `isolated` | One sandbox fork per agent | None |
| `shared` | One sandbox (1 vCPU) for all agents | `/swarm` in that sandbox |
| `disk` | A new VM (2 vCPU, 4 GiB) for every command | One Archil disk, mounted `conditional` in every VM |

In `shared` and `disk` mode, agents read each other's work under `/swarm/findings/` and `/swarm/notes/`. Every finding and note is a new file. On a `conditional` disk mount, appends from parallel VMs to one file overwrite each other. In a test, 13 findings were reported and 5 lines reached the disk.

| `type` | Change |
|---|---|
| `run_started` | Adds `mode` and `agents`, a list of `{id, roles, files}`. |
| `fork_started` | Adds `role` and `shared`. In shared mode every agent has the same `sandbox_id` and `fork_ms` is 0. |
| `tool_call` | New. `checker`, `tool` (`bash` or `report_finding`), `input`, `ms`, `ok`. |
| `finding` | Adds `role`. |
| `fork_done` | Adds `findings`, `steps`, and `error` if the agent failed. |

Three recorded runs are in `runs/test-isolated-3/` (72 s), `runs/test-shared-5/` (60 s) and `runs/test-disk-5/` (33 s). All three caught 10 of 10 with 0 false alarms.

## Timeline

| Time | Lead | UI | Engine |
|---|---|---|---|
| 0:00 to 0:20 | Push demo repo and answer key | Static view from the sample | Live fork test (ticket 01) |
| 0:20 to 1:20 | Scorer, tested on the sample | Replay with timing, score panel | Checker runner with three prompts |
| 1:20 to 1:40 | Score the first real run | Read the real file while it grows | First full run on forks |
| 1:40 to 2:00 | Pitch, drive the demo | Polish, record a backup run | Tune prompts for false alarms |

Gates: at 0:20 the demo repo is on `main` and the fork test has a verdict. At 1:20 one real `events.jsonl` exists. At 1:40 a full run works from start to score, and the code is frozen.

If the live fork test fails at 0:20, the engine uses the fallback: three `agent.ts` runs on one shared disk. The event file stays the same. If time runs short, cut in this order: live UI updates (replay a recorded run), real forks, the test-cheat checker, the decoys.

## Setup

1. Clone the repo and run `npm install` in `archil-starter copy/`.
2. Create `archil-starter copy/.env` with `ARCHIL_API_KEY`, `ARCHIL_REGION`, and `ANTHROPIC_API_KEY`. Git ignores this file.
3. Work on a branch named `lead`, `ui`, or `engine`, and merge to `main` often.
