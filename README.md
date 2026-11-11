# Swarm Audit

A swarm of AI agents that audits open-source npm packages for security risks in parallel.
Each agent audits one package: it downloads the code onto a shared **Archil** disk, inspects it with
serverless bash (every call runs in its own microVM next to the data), looks up known vulnerabilities
with **Keenable** web search, and writes its findings back to the shared disk. A live dashboard shows
the swarm working.

## Run

```bash
npm install
cp .env.example .env   # then paste your keys into .env
npm start              # open http://localhost:3000
```

Keys: Archil (console.archil.com → API keys), Anthropic (console.anthropic.com), Keenable (artifacts.keenable.ai/archil, code N1WEB).

Change `PACKAGES` in `swarm.mjs` to audit other packages, and `CONCURRENCY` in `.env` to run more agents at once.
