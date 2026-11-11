# Agents Need Solid Ground: Security Swarms on Archil

**Archil Agent Hackathon · Nov 10, 2026**

Every app is built on hundreds of open-source packages plus its own code. One weak spot exposes the whole app,
and nobody has time to review it all. We built a security review for any app, run by agent swarms on **Archil**.

## Three parts

| Layer | What it checks | How | Result |
|---|---|---|---|
| **1. Dependency swarm** (root: `swarm.mjs`) | every open-source package an app depends on | 16 workers fan out in parallel on one shared Archil disk, then a lead agent writes a fix plan | 16 packages in ~25 s → 13 vulnerable, 73 known CVEs |
| **2. Vibe-code scanner** ([`vibe-code-scanner/`](vibe-code-scanner/)) | the app's own (AI-written) code | Claude agents with three roles (security, package, test-cheat), each in its own Archil sandbox fork, or sharing one Archil disk | caught 10 of 10 seeded bugs, 0 false alarms, in 3 recorded runs |
| **3. Swarm Studio** ([`swarm studio/`](swarm%20studio/)) | the running app, end to end | QA swarms whose agents test the app in parallel in browsers, each worker in an Archil sandbox; a lead agent brings the findings back to chat; Keenable for search-enabled swarms | local agent workspace to launch and watch QA swarms |

Layer 2's roles: **security** (SQL injection, XSS, hardcoded secrets, command injection), **package** (hallucinated
packages and undeclared imports that AI assistants invent), **test-cheat** (empty tests, special-cased logic).
It runs on a demo repo with 10 seeded bugs and 2 decoys; the scorer checks findings against an answer key the agents never see.

## Layer 1: result of a real run

**16 packages audited in ~25 s → 13 vulnerable, 73 known vulnerabilities. Upgrading the top 3 packages fixes 46 of them.**
Full output: [`report.md`](report.md) · raw data: [`results.json`](results.json) · video: [`demo-dependency-swarm.mp4`](demo-dependency-swarm.mp4)

## How we use Archil (layer 1)

```
          shared queue of packages
                    │
   ┌──────┬──────┬──┴───┬──────┐
 worker worker worker  …  worker      (16 in parallel)
   │      │      │         │
   └── serverless exec: one microVM per bash call, next to the data ──┐
                                                                      ▼
            ONE shared Archil disk (conditional mode, concurrent writes)
              /work/<pkg>/        downloaded package code
              /findings/<pkg>.json  each worker's result
              /report.md          lead agent's fix plan
                                                                      ▲
            lead agent ── reads ALL findings from the disk, writes the plan
```

- **No sandboxes.** Workers never hold a machine. Each bash call gets its own microVM via `workspace.exec()`,
  with the shared disk mounted. We only pay while a command runs (one run ≈ 34 serverless calls).
- **Shared state as the coordination layer.** Workers write findings to the disk; the lead agent reads them all back
  and decides what to fix first.
- **Conditional mode** lets all workers write to the same disk at the same time.

## Data sources

- **OSV.dev**: known vulnerabilities (CVE/GHSA) for the exact package version, plus the smallest stable fixed version.
- **Keenable**: live web search per package (advisory pages, write-ups) as evidence. Web mentions that only affect
  *other* versions are labeled as such.
- Code scan: install scripts, `eval`/`new Function`, `child_process`, `__proto__` usage.

## Run it

```bash
npm install
cp env.example .env          # add ARCHIL_API_KEY, ARCHIL_REGION, KEENABLE_API_KEY (optional ANTHROPIC_API_KEY)
npm start                    # demo list of 16 packages → dashboard on http://localhost:3000
npm start -- path/to/package.json   # audit any app's dependencies
```

With an `ANTHROPIC_API_KEY`, each worker becomes a Claude agent using the same Archil disk tools (`@archildata/ai-sdk`).
Results: live dashboard, `GET /api/results` (JSON, CORS on), `results.json`, and `/findings` + `/report.md` on the Archil disk.

## How we use Archil (layer 2)

- **Forked state:** the repo is uploaded once into a base sandbox, then forked per checker, so every agent starts from an identical copy in parallel.
- **Shared state:** in `disk` mode every command runs in a fresh VM with one Archil disk mounted `conditional`; agents read each other's
  findings and notes under `/swarm/findings/` and `/swarm/notes/` and avoid duplicate work.
- See [`vibe-code-scanner/README.md`](vibe-code-scanner/README.md) for modes (`isolated`, `shared`, `disk`) and the event contract.

## What's next

- Keep the disk persistent across runs so the swarm remembers past audits and only checks what changed.
- Fork the disk per pull request to audit a proposed upgrade before merging.
- Scale the dependency swarm to thousands of packages per org.
