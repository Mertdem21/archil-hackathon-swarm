// Role specialists and how the orchestrator spreads N agents over them.
// Each role owns some bug classes. Agents that share a role split that role's files.
import type { BugClass, CheckerName } from "../types.ts";
import type { AgentPlan } from "./events.ts";

export interface Role {
  name: CheckerName;
  classes: readonly BugClass[];
  /** Which repo files this role is responsible for (paths relative to the repo root). */
  owns: (file: string) => boolean;
  playbook: string;
}

const isPy = (f: string) => f.endsWith(".py");
const isTest = (f: string) => /(^|\/)tests?\/|(^|\/)test_[^/]*\.py$|_test\.py$/.test(f);

export const ROLES: Role[] = [
  {
    name: "security",
    classes: ["sql-injection", "xss", "hardcoded-secret", "command-injection"],
    owns: (f) => !isTest(f) && /\.(py|html|jinja2?|cfg|ini|toml|env|ya?ml|json)$/.test(f),
    playbook: `You hunt exploitable security bugs.
- bandit is installed. A good first step: bandit -f json -q <your files>. Treat its output as leads, not answers.
- Read the flagged code and its callers with nl -ba to confirm that user input really reaches the sink.
- Drop false positives: SQL with ? or %s placeholders and a separate parameter tuple is safe. subprocess with an argument list, no shell, and constant input is safe. A bare import is not a finding. Ignore assert, non-crypto random, try/except/pass.
- hardcoded-secret means a real credential literal in code, not a value read from the environment or an empty default.
- bandit misses XSS: user input formatted into render_template_string, returned as HTML without escaping, or wrapped in Markup() is xss. Check whether the value is escaped earlier before you report it.`,
  },
  {
    name: "package",
    classes: ["hallucinated-package", "undeclared-import"],
    owns: (f) => /(^|\/)requirements[^/]*\.txt$|(^|\/)pyproject\.toml$|(^|\/)setup\.(py|cfg)$/.test(f) || (isPy(f) && !isTest(f)),
    playbook: `You hunt dependency problems that AI assistants create.
- /opt/tools/package_check.py parses requirements.txt and every import, and queries PyPI. Run: python3 /opt/tools/package_check.py /app. It prints one JSON finding per line. Treat them as leads.
- Confirm a package by hand: curl -s -o /dev/null -w '%{http_code}' https://pypi.org/pypi/<name>/json (404 means it does not exist).
- hallucinated-package: a declared dependency that does not exist on PyPI. Report it at its line in the requirements file.
- undeclared-import: an import that is not standard library, not a local module, and not declared, and that does not exist on PyPI. Report it at the import line.
- A real package with a different import name (for example PyYAML imported as yaml) is not a finding.`,
  },
  {
    name: "test-cheat",
    classes: ["special-casing", "empty-test", "duplicated-code"],
    owns: isPy,
    playbook: `You hunt cheating and sloppiness that AI assistants leave in code and tests.
- special-casing: code returns hard-coded outputs for specific inputs (often the exact inputs the tests use) instead of computing the result. Compare tests with the code they test.
- empty-test: a test that cannot fail, such as assert True, asserting that a mock exists, or no assertion on real behavior.
- duplicated-code: a function copied into another module instead of imported, maybe drifted. Report the copy (the second location), not the original. You will need to read files outside your list to find originals; that is fine.
- Ignore style, security and missing features.`,
  },
];

/**
 * Spread n agents over the roles. With n >= roles, agent i takes role i % roles and agents with
 * the same role split its files round-robin. With n < roles, each agent takes several roles.
 */
export function planSwarm(n: number, files: string[]): AgentPlan[] {
  const holders: number[][] = ROLES.map(() => []); // role index -> agent indexes
  if (n >= ROLES.length) for (let i = 0; i < n; i++) holders[i % ROLES.length].push(i);
  else ROLES.forEach((_, r) => holders[r].push(r % n));

  const plans: AgentPlan[] = Array.from({ length: n }, () => ({ id: "", roles: [], files: {} }));
  ROLES.forEach((role, r) => {
    const owned = files.filter(role.owns).sort();
    holders[r].forEach((a, k) => {
      plans[a].roles.push(role.name);
      plans[a].files[role.name] = owned.filter((_, i) => i % holders[r].length === k);
    });
  });

  const seen: Record<string, number> = {};
  for (const p of plans) {
    const base = p.roles.join("+");
    seen[base] = (seen[base] ?? 0) + 1;
    p.id = `${base}-${seen[base]}`;
  }
  return plans;
}

export const roleByName = (name: string) => ROLES.find((r) => r.name === name)!;
