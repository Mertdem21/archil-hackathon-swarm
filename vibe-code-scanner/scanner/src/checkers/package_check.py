"""Package checker. Runs inside the fork. Python standard library only.

Usage: python3 package_check.py [repo_dir]   (default /app)

Reads requirements.txt and every import in the repo, asks PyPI about each
package, and prints one JSON finding per line to stdout. Warnings go to stderr.
"""
import ast
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

REPO = sys.argv[1] if len(sys.argv) > 1 else "/app"
UA = "vibe-scanner-demo"
NEW_PACKAGE_DAYS = 30
SKIP_DIRS = {"__pycache__", ".git", ".venv", "venv", "node_modules", ".pytest_cache"}

_cache = {}


def warn(msg):
    print(f"WARN: {msg}", file=sys.stderr, flush=True)


def info(msg):
    print(msg, file=sys.stderr, flush=True)


def normalize(name):
    # PEP 503 name normalization.
    return re.sub(r"[-_.]+", "-", name).lower()


def pypi(name):
    """Return ("ok", data), ("missing", None) or ("error", None)."""
    key = normalize(name)
    if key in _cache:
        return _cache[key]
    url = f"https://pypi.org/pypi/{name}/json"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = ("ok", json.load(resp))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            result = ("missing", None)
        else:
            warn(f"PyPI returned HTTP {e.code} for {name}, skipping")
            result = ("error", None)
    except Exception as e:  # network problem, timeout, bad JSON
        warn(f"could not reach PyPI for {name}: {e}, skipping")
        result = ("error", None)
    _cache[key] = result
    return result


def first_release(data):
    times = []
    for files in (data.get("releases") or {}).values():
        for f in files:
            t = f.get("upload_time_iso_8601")
            if t:
                times.append(datetime.fromisoformat(t.replace("Z", "+00:00")))
    return min(times) if times else None


def emit(file, line, cls, reason, evidence):
    print(json.dumps({
        "checker": "package",
        "file": file,
        "line": line,
        "class": cls,
        "reason": reason,
        "evidence": evidence[:200],
    }), flush=True)


def read_requirements():
    """Return a list of (name, line_number, raw_line)."""
    path = os.path.join(REPO, "requirements.txt")
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8", errors="replace") as fh:
        for n, raw in enumerate(fh, 1):
            line = raw.split("#", 1)[0].strip()
            if not line or line.startswith("-"):
                continue
            m = re.match(r"([A-Za-z0-9][A-Za-z0-9._-]*)", line)
            if m:
                out.append((m.group(1), n, raw.strip()))
    return out


def py_files():
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith(".py"):
                yield os.path.join(root, f)


def local_modules():
    names = set()
    for entry in os.listdir(REPO):
        full = os.path.join(REPO, entry)
        if os.path.isdir(full):
            names.add(entry)
        elif entry.endswith(".py"):
            names.add(entry[:-3])
    return names


def collect_imports():
    """Return {top_level_name: (relative_file, line, source_line)} for the first use of each import."""
    found = {}
    for path in sorted(py_files()):
        rel = os.path.relpath(path, REPO)
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                src = fh.read()
            tree = ast.parse(src, filename=rel)
        except SyntaxError as e:
            warn(f"cannot parse {rel}: {e}")
            continue
        lines = src.splitlines()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level and node.level > 0:
                    continue  # relative import, always local
                names = [node.module] if node.module else []
            else:
                continue
            for name in names:
                top = name.split(".")[0]
                text = lines[node.lineno - 1].strip() if node.lineno <= len(lines) else name
                prev = found.get(top)
                if prev is None or (rel, node.lineno) < (prev[0], prev[1]):
                    found[top] = (rel, node.lineno, text)
    return found


def main():
    now = datetime.now(timezone.utc)

    # 1. Declared packages.
    reqs = read_requirements()
    info(f"checking {len(reqs)} declared packages")
    for name, line, raw in reqs:
        status, data = pypi(name)
        if status == "missing":
            emit("requirements.txt", line, "hallucinated-package",
                 f"'{name}' is declared in requirements.txt but does not exist on PyPI (404)", raw)
        elif status == "ok":
            first = first_release(data)
            if first and now - first < timedelta(days=NEW_PACKAGE_DAYS):
                emit("requirements.txt", line, "hallucinated-package",
                     f"suspicious: new package ('{name}' first released {first.date().isoformat()})", raw)
            else:
                info(f"  ok: {name}")

    # 2. Undeclared third-party imports.
    declared = {normalize(n) for n, _, _ in reqs}
    stdlib = set(sys.stdlib_module_names)
    local = local_modules()
    imports = collect_imports()
    third_party = {k: v for k, v in imports.items()
                   if k not in stdlib and k not in local and k != "__future__"}
    info(f"found {len(imports)} imported modules, {len(third_party)} third-party")
    for mod, (rel, line, text) in sorted(third_party.items()):
        if normalize(mod) in declared:
            info(f"  ok: import {mod} (declared)")
            continue
        candidates = list(dict.fromkeys([mod, mod.replace("_", "-")]))
        statuses = [pypi(c)[0] for c in candidates]
        if "ok" in statuses or "error" in statuses:
            # Exists on PyPI, or we could not tell. Not a finding.
            info(f"  skip: import {mod} (undeclared but not a 404)")
            continue
        emit(rel, line, "undeclared-import",
             f"'{mod}' is imported but not declared in requirements.txt and no such package exists on PyPI (404)",
             text)


if __name__ == "__main__":
    main()
