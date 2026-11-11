// Security checker: run bandit in the fork, then one Claude call triages the results.
import { ask, parseJsonArray } from "../llm.ts";
import { REPO_DIR, type Checker, type Finding } from "../types.ts";

const CLASSES = ["sql-injection", "xss", "hardcoded-secret", "command-injection"] as const;
type SecClass = (typeof CLASSES)[number];

// Used only when the Claude call fails.
const BANDIT_MAP: Record<string, SecClass> = {
  B608: "sql-injection",
  B602: "command-injection",
  B604: "command-injection",
  B605: "command-injection",
  B105: "hardcoded-secret",
  B106: "hardcoded-secret",
  B107: "hardcoded-secret",
  B703: "xss",
  B704: "xss",
};

interface BanditHit {
  test_id: string;
  file: string;
  line: number;
  issue_text: string;
  code: string;
}

const rel = (p: string) => p.replace(new RegExp(`^${REPO_DIR}/`), "");

const SYSTEM = `You triage security findings for a small Python web application.
You get raw output from the bandit static analyzer and the source of the app.
Decide which findings are real, exploitable vulnerabilities, and add real ones the tool missed.

Return ONLY a JSON array. Each element is an object:
{"file": "<path relative to repo root, e.g. app/db.py>", "line": <int>, "class": "<class>", "reason": "<one sentence>", "evidence": "<the offending line of code, short>"}

"class" must be exactly one of: "sql-injection", "xss", "hardcoded-secret", "command-injection".
Report nothing outside these four classes.

Rules:
- Drop false positives. Examples: SQL that uses ? or %s placeholders with a separate parameter tuple is safe. subprocess called with a list of arguments, no shell, and constant or non-user input is safe. A bare "import subprocess" is not a finding. Drop low-value noise such as assert usage, random for non-crypto use, or try/except/pass.
- A hardcoded-secret is a real credential, key, or password literal in code, not a placeholder read from the environment or an empty default.
- Add issues the tool missed. Examples: user input concatenated or formatted into render_template_string or into HTML returned without escaping is xss; Markup() on user input is xss; user input in an f-string SQL query is sql-injection; user input passed to os.system, os.popen, or subprocess with shell=True is command-injection.
- One finding per real issue. Do not report the same issue twice.
- Use the line number where the dangerous call or literal is.
- If nothing is real, return [].`;

export const run: Checker = async ({ sandbox, log }) => {
  const t0 = Date.now();
  log("security: installing bandit");
  const pip = await sandbox.exec("pip install -q --disable-pip-version-check bandit", { cwd: "/", timeoutSeconds: 60 });
  if (pip.exitCode !== 0) log(`security: pip install exit ${pip.exitCode}: ${pip.stderr.slice(0, 300)}`);

  log("security: running bandit");
  // Exit code 1 means bandit found issues, which is normal.
  const b = await sandbox.exec(`bandit -r ${REPO_DIR} -f json -q`, { cwd: "/", timeoutSeconds: 45 });
  let hits: BanditHit[] = [];
  try {
    const parsed = JSON.parse(b.stdout.slice(b.stdout.indexOf("{"))) as {
      results?: { test_id: string; filename: string; line_number: number; issue_text: string; code: string }[];
    };
    // B101 (assert used) is pure noise in tests, so skip it.
    hits = (parsed.results ?? []).filter((r) => r.test_id !== "B101").map((r) => ({
      test_id: r.test_id,
      file: rel(r.filename),
      line: r.line_number,
      issue_text: r.issue_text,
      code: r.code.trim().slice(0, 400),
    }));
  } catch {
    log(`security: could not parse bandit output (exit ${b.exitCode}): ${(b.stderr || b.stdout).slice(0, 300)}`);
  }
  log(`security: bandit reported ${hits.length} results in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const h of hits) log(`  ${h.test_id} ${h.file}:${h.line} ${h.issue_text}`);

  // The repo is small, so send every app source file and template, with line numbers.
  const src = await sandbox.exec(
    `find . -type f \\( -name '*.py' -o -name '*.html' -o -name '*.jinja*' \\) -not -path './tests/*' -not -path '*/__pycache__/*' | sort | while read f; do echo "===== FILE: \${f#./}"; cat -n "$f"; done`,
    { cwd: REPO_DIR, timeoutSeconds: 30 },
  );
  const source = src.stdout.slice(0, 120_000);
  log(`security: collected ${source.length} chars of source`);

  const prompt = `Bandit results (JSON):\n${JSON.stringify(hits, null, 1)}\n\nApplication source (line numbers on the left):\n${source}`;

  let findings: Finding[] = [];
  try {
    log("security: asking Claude to triage");
    const t1 = Date.now();
    const reply = await ask(SYSTEM, prompt, 90_000);
    const raw = parseJsonArray<Partial<Finding>>(reply);
    findings = raw
      .filter((f) => typeof f.class === "string" && (CLASSES as readonly string[]).includes(f.class) && typeof f.file === "string")
      .map((f) => ({
        checker: "security" as const,
        file: rel(String(f.file)),
        line: Number(f.line) || 0,
        class: f.class as SecClass,
        reason: String(f.reason ?? ""),
        evidence: String(f.evidence ?? "").slice(0, 300),
      }));
    log(`security: Claude kept ${findings.length} of ${raw.length} in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  } catch (e) {
    log(`security: Claude call failed (${(e as Error).message}), falling back to bandit id mapping`);
    findings = hits
      .filter((h) => BANDIT_MAP[h.test_id])
      .map((h) => ({
        checker: "security" as const,
        file: h.file,
        line: h.line,
        class: BANDIT_MAP[h.test_id],
        reason: `bandit ${h.test_id}: ${h.issue_text}`,
        evidence: h.code.slice(0, 300),
      }));
  }

  for (const f of findings) log(`  ${f.class} ${f.file}:${f.line} ${f.reason}`);
  log(`security: done, ${findings.length} findings in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return findings;
};
