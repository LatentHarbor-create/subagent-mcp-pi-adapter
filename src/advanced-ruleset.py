#!/usr/bin/env python3
# Modified for the subagent-mcp Pi adapter fork.
"""advanced-ruleset.py — final-authority model-routing override hook for subagent-mcp.

(a) PERFORMANCE WARNING: this script runs synchronously inside EVERY launch_agent
    call. Slow rules slow every agent launch. Keep rules lean and low-latency —
    no network calls, no heavy imports at module top. This is YOUR responsibility;
    you have been warned.

(b) OUTPUT CONTRACT (routing mode): print to stdout ONE JSON array — the modified
    candidate list (reorder / filter / replace allowed). Template:
    [
      {"provider": "claude", "model": "sonnet",  "effort": "high",  "rank": 1},
      {"provider": "codex",  "model": "gpt-5.5", "effort": "xhigh", "rank": 2}
    ]
    Valid providers: claude, codex, api, pi. Valid models: haiku, sonnet, opus, opus-4-8, fable (claude);
    gpt-5.5, gpt-5.6 (codex), pi-cheap|pi-balanced (pi), any non-empty model (api).
    Valid efforts: haiku -> "none" only; sonnet/fable -> medium|high|xhigh|max;
    opus/opus-4-8 -> those plus ultracode; gpt-5.5/gpt-5.6 -> medium|high|xhigh; pi -> high|max; api -> medium.
    "rank" on output is ignored. An EMPTY array vetoes the launch. Anything else
    invalid fails the launch hard — the server validates strictly.

(c) INPUT CONTRACT (routing mode, invoked as: <python> advanced-ruleset.py route):
    stdin receives one JSON object:
    { "candidates": [ {"provider","model","effort","rank"} ... ],   # rank 1..N best->worst
      "context": { "task_category": str, "cwd": str,
                   "selection_mode": "auto"|"provider"|"provider_model"|"explicit",
                   "provider": str|None, "model": str|None, "effort": str|None } }
    OS environment variables are visible natively (os.environ).

ENV-CHECK MODE (no arguments): prints {"ready": true|false, "load-rules": true|false}.
Runs once per MCP server process. load-rules false => ruleset silently disabled
for the rest of the process. Set LOAD_RULES = True below to activate.
"""
import json
import os
import sys

# Pi-only MCP routing; native Codex delegation uses its independent channel.
LOAD_RULES = True

# --- Requirements stub (scaffold itself is stdlib-only) ----------------------
# List third-party distributions your rules import, e.g.:
# REQUIREMENTS = ["requests", "pyyaml"]
# Install with:  <python> -m pip install <name> ...
REQUIREMENTS = []
BLOCKED_ROOTS_ENV = "SUBAGENT_PI_BLOCKED_ROOTS"
PI_PREFERRED = {"provider": "pi", "model": "pi-balanced", "effort": "max"}

def missing_requirements():
    """pip-check helper: returns the REQUIREMENTS entries not importable here."""
    import importlib.util
    return [r for r in REQUIREMENTS
            if importlib.util.find_spec(r.replace("-", "_")) is None]

def env_check():
    blocked_roots()
    missing = missing_requirements()
    json.dump({"ready": not missing, "load-rules": bool(LOAD_RULES)}, sys.stdout)

def existing_dir(path):
    if not isinstance(path, str) or not path.strip():
        return None
    try:
        resolved = os.path.realpath(path)
    except (OSError, ValueError):
        return None
    if not os.path.isdir(resolved):
        return None
    return resolved

def policy_path(path):
    raw = str(path).strip()
    if raw.startswith("\\\\?\\"):
        raw = raw[4:]
    return os.path.normcase(os.path.normpath(raw)).rstrip("\\/")

def same_or_descendant(path, root):
    child = policy_path(path)
    parent = policy_path(root)
    return child == parent or child.startswith(parent + os.sep)

def blocked_roots():
    raw = os.environ.get(BLOCKED_ROOTS_ENV, "[]")
    values = json.loads(raw)
    if not isinstance(values, list) or any(not isinstance(p, str) or not p.strip() for p in values):
        raise ValueError("SUBAGENT_PI_BLOCKED_ROOTS must be a JSON array of absolute directory paths")
    roots = []
    for path in values:
        if not os.path.isabs(path):
            raise ValueError("Blocked directory must be absolute")
        roots.append(existing_dir(path) or os.path.realpath(path))
    return roots

def audit_cwd(cwd):
    if cwd is None:
        return False
    return any(same_or_descendant(cwd, root) for root in blocked_roots())

def apply_rules(candidates, context):
    """Route only pi/pi-balanced/max; blocked or unclassifiable directories veto launches."""
    cwd = existing_dir(context.get("cwd"))
    if cwd is None or audit_cwd(cwd):
        return []
    mode = context.get("selection_mode")
    provider = context.get("provider")
    model = context.get("model")
    effort = context.get("effort")
    if provider not in (None, "pi"):
        return []
    if mode == "auto" and provider is None:
        return [dict(PI_PREFERRED)]
    if mode == "provider" and provider == "pi":
        return [dict(PI_PREFERRED)]
    if mode == "provider_model" and provider == "pi" and model == "pi-balanced":
        return [dict(PI_PREFERRED)]
    if mode == "explicit" and provider == "pi" and model == "pi-balanced" and effort == "max":
        for candidate in candidates:
            if all(candidate.get(key) == value for key, value in PI_PREFERRED.items()):
                return [candidate]
    return []

def route():
    payload = json.load(sys.stdin)
    out = apply_rules(payload.get("candidates", []), payload.get("context", {}))
    json.dump(out, sys.stdout)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "route":
        route()
    else:
        env_check()
