# Archil Starter

Two small programs that you run before the hackathon. If both work, you are the person on the team who has Archil running in the first five minutes.

| File | What it does |
|---|---|
| `agent.ts` | An agent with an Archil disk as its workspace. It remembers notes across runs and writes an audit log. |
| `fork-race.ts` | Forks one sandbox three times, runs a different job in each fork, and keeps the fastest. |

## Run it

You need Node.js 20 or later, an Archil API key, and an Anthropic API key.

```bash
cd ~/hackathon-prep-nov-2026/03-frameworks-and-infra/archil-starter
npm install
export ARCHIL_API_KEY=key-...
export ARCHIL_REGION=aws-us-west-2
export ANTHROPIC_API_KEY=sk-ant-...
npm run agent -- "Make a file called hello.txt with today's date"
npm run agent -- "What did you do last time? Read NOTES.md"
npm run forks
```

If the model name fails, set `MODEL` to a model ID that your Anthropic account has, for example `MODEL=claude-sonnet-5`.

## Known gaps

The code passes a strict TypeScript type check against the installed `disk` and `ai` packages (November 9, 2026). On November 11, 2026, `agent.ts` ran against the live service two times and passed. The second run read the NOTES.md file that the first run wrote. Nobody ran `fork-race.ts` against the live service yet.

Each run of `fork-race.ts` uses sandbox time. The Free plan gives 1 sandbox-hour per month.
