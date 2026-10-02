#!/usr/bin/env node
// Modified for the subagent-mcp Pi adapter fork.
/**
 * Audit-target provenance check.
 *
 * WHY THIS EXISTS
 * A static audit's verdict is only meaningful relative to the exact revision it
 * examined. When the revision named in the request does not match the revision
 * actually on disk, every PASS/FAIL in the report may describe different code —
 * and nothing in the report looks wrong.
 *
 * The failure mode is a stale premise, not a code defect: a request is written
 * against HEAD at time T0, the audit runs at T1, and commits landed between.
 *
 * WHAT IT ENFORCES
 * Every audit report must declare its target revision in a machine-readable
 * header line:
 *
 *   AUDIT_TARGET_HEAD: <full 40-hex SHA>
 *
 * The SHA must resolve to a commit in the repository the audit examined. A
 * report that omits the line, gives a short SHA, or names a revision that does
 * not resolve fails.
 *
 * SCOPE
 * Header analysis only. This script does not compare the declared revision
 * against current HEAD and does not judge whether the audit was correct — it
 * checks that the report states a verifiable revision at all.
 *
 * CONFIG
 * Report locations are read from AUDIT_REPORT_DIRS (comma-separated, relative
 * to this repo). Defaults to "docs/history". Set AUDIT_REPORT_DIRS to audit a
 * different tree.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const root = process.cwd();

/** Files whose name marks them as an audit/review report. */
const AUDIT_NAME_RE = /(audit|review|verification|spotcheck)/i;

/** The declaration line, anchored at line start. */
const TARGET_RE = /^AUDIT_TARGET_HEAD:\s*([0-9a-f]{40})\s*$/m;

/** A full 40-hex SHA, as required (short SHAs are not accepted). */
const FULL_SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Reports produced before this rule existed, or whose subject is not a single
 * revision.
 *
 * These are exempt, not compliant. They were written and accepted when no
 * declaration was required, and several do not name a revision anywhere in
 * their text — back-filling one would mean INVENTING a target the report never
 * asserted, which is the exact failure this check exists to prevent. A
 * retroactive annotation is not evidence.
 *
 * Two kinds are listed:
 *   - PRE-RULE: written before this check existed and accepted without it.
 *   - NO-SINGLE-REVISION: the audit covers documents or an archive rather than
 *     one commit, so there is no single SHA that would be truthful.
 *
 * Matched against the file's basename. A file listed here is reported as
 * exempt rather than failed, so the check keeps a meaningful signal.
 */
const PRE_RULE_REPORTS = new Set([
  // PRE-RULE
  "CURRENT_ARCHITECTURE_MAINTENANCE_DSH_REVIEW_20260928.md",
  "pi_balanced_max_fix_dsh_verification_20260927.md",
  "subagent_mcp_pi_gap_closure_dsh_verification_20260927.md",
  // NO-SINGLE-REVISION (audits the document-governance output set, not a commit)
  "workspace_document_cleanup_dsh_spotcheck_20260928.md",
]);

const dirs = (process.env.AUDIT_REPORT_DIRS ?? "docs/history")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);

function fail(message) {
  console.error(`AUDIT-TARGET: FAIL ${message}`);
  process.exitCode = 1;
}

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

/** True when the SHA resolves to a commit object in this repository. */
function commitExists(sha) {
  if (!FULL_SHA_RE.test(sha)) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const candidates = [];
for (const dir of dirs) {
  // A configured dir may be absolute (auditing a tree outside this repo) or
  // relative to this repo. resolve() handles both.
  const abs = isAbsolute(dir) ? dir : resolve(root, dir);
  if (!statSync(abs, { throwIfNoEntry: false })) continue;
  for (const p of walk(abs)) {
    if (!AUDIT_NAME_RE.test(p.split(sep).pop() ?? "")) continue;
    const rel = relative(root, p);
    // Keep the display label repo-relative when inside the repo, else absolute.
    const label = rel.startsWith("..") || isAbsolute(rel) ? p : rel.split(sep).join("/");
    candidates.push({ path: p, label });
  }
}

if (candidates.length === 0) {
  console.log(`AUDIT-TARGET: PASS (no audit reports found in ${dirs.join(", ")})`);
  process.exit(0);
}

const missing = [];
const malformed = [];
const unknown = [];
const exempt = [];
let declared = 0;

for (const { path, label } of candidates) {
  const basename = path.split(sep).pop() ?? "";
  const text = readFileSync(path, "utf8");
  const match = text.match(TARGET_RE);
  const loose = text.match(/^AUDIT_TARGET_HEAD:.*$/m);

  // A malformed declaration always fails, exempt or not: writing one at all
  // means the report intends to declare a target, so a short or unparseable
  // value is an error rather than an absence.
  if (!match && loose) {
    malformed.push(`${label} -> ${loose[0].trim()}`);
    continue;
  }

  // A pre-rule report is exempt ONLY while it declares nothing at all. Once a
  // declaration is added (as was done where the report itself named its
  // revision), the declaration is validated like any other.
  if (!match) {
    if (PRE_RULE_REPORTS.has(basename)) {
      exempt.push(label);
      continue;
    }
    missing.push(label);
    continue;
  }

  const sha = match[1];
  if (!commitExists(sha)) unknown.push(`${label} -> ${sha}`);
  else declared++;
}

for (const rel of missing) {
  fail(`${rel} does not declare AUDIT_TARGET_HEAD`);
}
for (const entry of malformed) {
  fail(`${entry} (must be a full 40-character lowercase hex SHA)`);
}
for (const entry of unknown) {
  fail(`${entry} (SHA does not resolve to a commit in this repository)`);
}

if (process.exitCode) {
  console.error(
    "AUDIT-TARGET: add a line 'AUDIT_TARGET_HEAD: <full SHA>' near the top of each audit report."
  );
  process.exit();
}

console.log(
  `AUDIT-TARGET: PASS ${declared}/${candidates.length} audit report(s) declare a resolvable target revision` +
    (exempt.length > 0 ? `; ${exempt.length} exempt (pre-rule)` : "")
);