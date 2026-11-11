import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  external: ["electron", "electron-updater", "koffi"],
  // Only the release workflow's builds report errors; local and agent builds never do.
  define: {
    "process.env.SWARM_STUDIO_DESKTOP_RELEASE": JSON.stringify(process.env.SWARM_STUDIO_DESKTOP_RELEASE ?? ""),
    // Self-hosted builds associated with their own passkey domain (see src/passkeys.ts).
    "process.env.SWARM_STUDIO_PASSKEY_RP_ID": JSON.stringify(process.env.SWARM_STUDIO_PASSKEY_RP_ID ?? ""),
  },
});
