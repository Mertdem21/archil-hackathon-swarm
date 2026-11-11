#!/usr/bin/env python3
"""Terminal scoreboard for the judge view.

Reads every out/findings/*.jsonl file (one Finding per line) and the answer key
in answer-key/seeded-bugs.json, then prints which seeded bugs were caught and
which findings were false alarms. Standard library only.

Run:  python3 -I scorecard.py [--fast] [--replay] [--findings-dir DIR] [--key FILE]
  --replay        animate the three checker rows finishing (for the demo)
  --fast          skip the animation delays even with --replay
  --findings-dir  read findings from DIR instead of ../out/findings
  --key           read the answer key from FILE instead of ../../answer-key/seeded-bugs.json
  --json FILE     also write {caught, total, false_alarms, missed} to FILE
"""
import glob, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[1:]


def opt(name, default):
    if name in ARGS:
        i = ARGS.index(name)
        if i + 1 < len(ARGS):
            return ARGS[i + 1]
    return default


FAST = "--fast" in ARGS
REPLAY = "--replay" in ARGS
FINDINGS_DIR = opt("--findings-dir", os.path.join(HERE, "..", "out", "findings"))
KEY_FILE = opt("--key", os.path.join(HERE, "..", "..", "answer-key", "seeded-bugs.json"))
TTY = sys.stdout.isatty()


def c(code, s):
    return f"\033[{code}m{s}\033[0m" if TTY else s


GREEN, RED, YEL, DIM, BOLD, CYAN = "32", "31", "33", "2", "1", "36"
CHECKERS = ["security", "package", "test-cheat"]


def load_findings(d):
    out = []
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        with open(path) as fh:
            for n, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    f = json.loads(line)
                except json.JSONDecodeError:
                    print(c(DIM, f"  skipped bad line {os.path.basename(path)}:{n}"), file=sys.stderr)
                    continue
                if not f.get("checker"):
                    # Fall back to the file name, e.g. test-cheat.jsonl
                    f["checker"] = os.path.basename(path)[: -len(".jsonl")]
                out.append(f)
    return out


findings = load_findings(FINDINGS_DIR)
with open(KEY_FILE) as fh:
    key = json.load(fh)
bugs = key["seeded_bugs"]
decoys = key.get("decoys", [])


def k(x):
    return (str(x.get("file", "")).removeprefix("./"), x.get("class"))


# --- checker rows ---
FINISH_AT = {"package": 1.2, "security": 2.6, "test-cheat": 3.8}  # fake seconds for --replay
SPIN = "|/-\\"


def checker_rows(t):
    rows = []
    for ch in CHECKERS:
        mine = [f for f in findings if f.get("checker") == ch]
        done = t >= FINISH_AT[ch]
        n = len(mine) if done else int(len(mine) * t / FINISH_AT[ch])
        status = c(GREEN, "done     ") if done else c(YEL, f"running {SPIN[int(t * 8) % 4]}")
        rows.append(f"  fork:{ch:<11} {status}  {n} finding(s)")
    return rows


print(c(BOLD, "Vibe-code scanner :: 3 checkers on 3 Archil forks"))
if not findings:
    print(c(YEL, f"  no findings yet in {os.path.normpath(FINDINGS_DIR)}"))
if REPLAY and TTY and not FAST:
    t, step, end = 0.0, 0.125, max(FINISH_AT.values())
    while True:
        rows = checker_rows(t)
        print("\n".join(rows))
        if t >= end:
            break
        time.sleep(step)
        t += step
        sys.stdout.write(f"\033[{len(rows)}A")  # move the cursor up and redraw
else:
    print("\n".join(checker_rows(99)))

# --- scoring: a finding matches the nearest seeded bug or decoy with the same file and class,
# when its line is inside that target's line range plus or minus SLACK ---
SLACK = 3


def target_for(f):
    try:
        line = int(f.get("line", -1))
    except (TypeError, ValueError):
        line = -1
    best, best_d = None, None
    for t in bugs + decoys:
        if k(t) != k(f):
            continue
        lo, hi = t.get("lines", [t["line"], t["line"]])
        d = 0 if lo <= line <= hi else min(abs(line - lo), abs(line - hi))
        if d <= SLACK and (best_d is None or d < best_d):
            best, best_d = t, d
    return best


caught_by, false_alarms = {}, []
for f in findings:
    t = target_for(f)
    if t is not None and t in bugs:
        caught_by.setdefault(str(t["id"]), set()).add(f.get("checker", "?"))
    else:
        false_alarms.append((f, t["id"] if t is not None else None))

print()
print(c(BOLD, "Seeded bugs"))
caught = 0
for b in bugs:
    who = caught_by.get(str(b["id"]))
    if who:
        caught += 1
        mark = c(GREEN, "CAUGHT ") + c(DIM, f"by {', '.join(sorted(who))}")
    else:
        mark = c(RED, "MISSED ") + c(DIM, f"(owner: {b.get('checker', '?')})")
    loc = f"{b['file']}:{b['line']}"
    print(f"  {str(b['id']):>2}  {b['class']:<21} {loc:<24} {mark}")

# Several findings for one seeded bug count once and are never false alarms.
print()
print(c(BOLD, "False alarms"))
for f, did in false_alarms:
    tag = c(YEL, f"decoy {did}") if did else ""
    loc = f"{f.get('file')}:{f.get('line')}"
    print(f"  {f.get('checker', '?'):<11} {str(f.get('class')):<21} {loc:<24} {tag}")
if not false_alarms:
    print(c(DIM, "  none"))

total = len(bugs)
plural = "S" if len(false_alarms) != 1 else ""
print()
print(c(BOLD + ";" + CYAN, f"  CAUGHT {caught} OF {total} SEEDED BUGS, WITH {len(false_alarms)} FALSE ALARM{plural}  "))

JSON_OUT = opt("--json", None)
if JSON_OUT:
    missed = [str(b["id"]) for b in bugs if str(b["id"]) not in caught_by]
    with open(JSON_OUT, "w") as fh:
        json.dump({"caught": caught, "total": total, "false_alarms": len(false_alarms), "missed": missed}, fh)
