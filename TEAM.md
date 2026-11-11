# Security Swarm: how to plug it in

**What it is:** a swarm of workers that security-audits every npm dependency of an app in parallel.
Each worker gets its own Archil serverless microVM, downloads its package onto one shared Archil disk
(conditional mode, concurrent writes), scans the code, checks OSV.dev for known CVEs of that exact
version, pulls web context from Keenable, and writes its finding to `/findings/<pkg>.json` on the disk.

## Run it

```bash
npm install
npm start                                  # demo list of 16 packages
npm start -- /path/to/your-app/package.json   # audit any app's dependencies
```

Keys go in `.env` (ARCHIL_API_KEY, ARCHIL_REGION, KEENABLE_API_KEY, optional ANTHROPIC_API_KEY).
Without ANTHROPIC_API_KEY it runs as a deterministic scanner swarm; with it, each worker is a Claude agent.

## Use the results

- **Live dashboard:** http://localhost:3000 (from another laptop on the same Wi-Fi: http://<this-laptop-ip>:3000)
- **JSON API:** `GET /api/results` (CORS enabled), e.g.
  ```js
  const r = await (await fetch("http://<ip>:3000/api/results")).json();
  r.packages // [{ name, version, status, risk: high|medium|low|none, summary, issues: [...] }]
  ```
- **File:** `results.json` in this folder, updated after every package.
- **On the Archil disk:** `/findings/<package>.json` (shared state any other swarm can read).
