import { describe, expect, it } from "vitest";
import { BUILTIN_AGENT_SKILLS } from "./builtin-skills.js";

describe("Swarm Studio skill", () => {
  it("includes the local QA tool without depending on hosted documentation", () => {
    const skill = BUILTIN_AGENT_SKILLS.find(({ name }) => name === "Swarm Studio");
    expect(skill?.content).toContain("deploy_swarm");
    expect(skill?.content).toContain("Watch screens");
    expect(skill?.content).not.toMatch(/https?:\/\//);
  });
});
