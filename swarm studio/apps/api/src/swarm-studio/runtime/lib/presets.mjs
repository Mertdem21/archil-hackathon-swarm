export const presets = [
  {
    id: "qa", name: "QA", icon: "⌖", summary: "Find bugs and leave a reproducible test.",
    instructions: "Test the supplied app in the live browser. Reproduce failures, state what you observed, and leave a runnable test for confirmed defects.",
    roles: ["Desktop happy path", "Mobile and form validation", "Repeat-submit stress", "Keyboard navigation", "Independent reproduction", "Regression coverage"],
    workers: 3, runtime: "sandbox", filesystem: "shared", search: false, browser: true,
  },
  {
    id: "fix", name: "Bug fix", icon: "⌘", summary: "Reproduce issues, patch them, and run tests.",
    instructions: "Work on the supplied repository. Reproduce the issue, create a focused patch, and run the relevant tests. Report a reviewable diff and evidence.",
    roles: ["Investigate and reproduce", "Implement and verify a patch"],
    workers: 2, runtime: "sandbox", filesystem: "shared", search: false,
  },
  {
    id: "greenfield", name: "Greenfield", icon: "◇", summary: "Turn a product idea into a working first pass.",
    instructions: "Build a minimal working version of the idea. Keep your changes in your own directory and record how to run and verify them.",
    roles: ["Build the core workflow", "Prototype the user-facing experience", "Write acceptance checks"],
    workers: 2, runtime: "sandbox", filesystem: "shared", search: false,
  },
  {
    id: "gtm", name: "Go to market", icon: "↗", summary: "Research buyers and draft a sourced campaign.",
    instructions: "Use Keenable to ground the work in public sources. Produce a concise deliverable with URLs and outreach or creative drafts where useful.",
    roles: ["Research buyers and qualified prospects", "Research positioning and draft creative angles", "Find comparable launches"],
    workers: 2, runtime: "serverless", filesystem: "shared", search: true,
  },
];

export function normalizeSpec(value) {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  const instructions = typeof value?.instructions === "string" ? value.instructions.trim() : "";
  const workers = Number(value?.workers);
  if (!name || name.length > 80 || !instructions || instructions.length > 4_000) {
    throw new Error("Enter a swarm name and instructions.");
  }
  if (!Number.isInteger(workers) || workers < 1 || workers > 6) {
    throw new Error("Choose between 1 and 6 workers.");
  }
  if (!["sandbox", "serverless"].includes(value.runtime) ||
      !["shared", "private"].includes(value.filesystem)) {
    throw new Error("Choose a valid runtime and filesystem.");
  }
  const preset = presets.find(({ id }) => id === value.presetId);
  return {
    name, instructions, workers, runtime: value.runtime, filesystem: value.filesystem,
    search: value.search === true,
    browser: value.runtime === "sandbox" && (value.browser === true || (value.browser === undefined && preset?.id === "qa")),
    roles: Array.isArray(value.roles)
      ? value.roles.slice(0, 6).map((role) => typeof role === "string" ? role.trim().slice(0, 100) : "")
      : preset?.roles ?? [],
  };
}
