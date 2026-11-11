# Swarm Studio

A local agent workspace for launching QA swarms and watching their browsers test an app in parallel. The lead agent brings the findings back to chat.

## Run locally

Use Node.js 24.15+, pnpm 12, and Docker or a local PostgreSQL server.

```sh
pnpm install --filter . --filter '@swarm-studio/web...' --filter '@swarm-studio/api...' --filter '@swarm-studio/worker...'
pnpm dev
```

The launcher prints the web URL. It starts PostgreSQL in Docker when `DATABASE_URL` is unset.

Set these values in a local `.env` file.

| Setting | Value |
| --- | --- |
| `SWARM_STUDIO_LOCAL_DEMO` | `true` to open directly in chat on loopback |
| `ARCHIL_API_KEY` | Archil key for worker sandboxes and filesystems |
| `CLINE_API_KEY` | Cline key for chat and worker inference |
| `MODEL_BASE_URL` | `https://api.cline.bot/api/v1` for Cline |
| `MODEL_ID` | `z-ai/glm-5.3-flash` for the demo |
| `KEENABLE_API_KEY` | Keenable key for search-enabled swarms |
| `SANDBOX_PROVIDER` | `none` for the local QA demo |

Generate separate random values for `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, and `SCREEN_PROXY_SECRET` with `openssl rand -hex 32` for each value. `MODEL_API_KEY` also works for another OpenAI-compatible endpoint.

## Run the QA demo

1. Start a chat. Ask the agent to deploy a QA swarm to find duplicate payments in the sample checkout.
2. Confirm **Sample checkout selected**, then choose **Deploy swarm**.
3. Open **Watch screens** for the desktop, mobile, and concurrent-submit browsers.
4. Close the screen wall after the workers finish and read the combined report in chat.
5. Open **Swarm Studio** to reopen a run or save a preset with its own worker count, tools, roles, and filesystem mode.

The checkout is a local fixture in each worker sandbox. It simulates payments and has an intentional duplicate-charge bug.

Use an app URL reachable from Archil to test another app. Shared workspaces keep reports on the chat's Archil disk. Search-enabled swarms use Keenable.
