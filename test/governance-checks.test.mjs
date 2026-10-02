// Modified for the subagent-mcp Pi adapter fork.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Governance-check behaviour guard.
//
// scripts/check_package_keys.mjs and scripts/check_audit_target.mjs enforce
// rules that only matter when they actually FAIL. A check that always passes is
// indistinguishable from no check, so each script is exercised against both a
// conforming and a violating input here.
//
// The scripts are invoked as child processes with a temporary cwd, so these
// cases never touch the real repository.
//
// Output capture goes through temp FILES rather than piped stdio: under a
// confined sandbox a child's piped stdio can fail with EPERM, which would make
// these cases unrunnable in exactly the environments they are most useful in.

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name); console.error("        " + e.message); failed++; }
}

const REPO = process.cwd();

/** Run a script, capturing both streams to files, and return code + output. */
function run(script, { cwd, env = {}, outDir }) {
  const outPath = join(outDir, "captured-stdout.txt");
  const errPath = join(outDir, "captured-stderr.txt");
  const scriptPath = join(REPO, "scripts", script);
  // Redirect to FILES via the shell. Piped stdio can fail with EPERM under a
  // confined sandbox; file redirection is unaffected and lets the assertions
  // still read what the child printed.
  const cmd =
    `"${process.execPath}" "${scriptPath}" ` +
    `> "${outPath}" 2> "${errPath}"`;
  const r = spawnSync(cmd, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const read = (p) => {
    try { return readFileSync(p, "utf8"); } catch { return ""; }
  };
  return { code: r.status ?? 1, out: `${read(outPath)}${read(errPath)}` };
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "gov-check-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Read a value from git without piped stdio (which can EPERM in a sandbox). */
function gitOut(args, outDir) {
  const p = join(outDir, "git-out.txt");
  spawnSync(`git ${args.join(" ")} > "${p}" 2>&1`, {
    cwd: REPO, shell: true, stdio: ["ignore", "inherit", "inherit"],
  });
  return readFileSync(p, "utf8").trim();
}

test("pkg-keys: duplicate top-level key fails", () => {
  withTmp((dir) => {
    writeFileSync(join(dir, "package.json"), '{ "name":"a", "version":"1", "name":"b" }');
    const r = run("check_package_keys.mjs", { cwd: dir, outDir: dir });
    assert.equal(r.code, 1, `expected failure, got ${r.code}: ${r.out}`);
    assert.match(r.out, /duplicate key/i);
    assert.match(r.out, /\bname\b/, "must name the duplicated key");
  });
});

test("pkg-keys: duplicate nested key fails and reports its path", () => {
  withTmp((dir) => {
    writeFileSync(join(dir, "package.json"),
      '{ "name":"a", "scripts": { "build":"x", "test":"y", "build":"z" } }');
    const r = run("check_package_keys.mjs", { cwd: dir, outDir: dir });
    assert.equal(r.code, 1, `expected failure, got ${r.code}: ${r.out}`);
    assert.match(r.out, /scripts\.build/, "must report the nested path");
  });
});

test("pkg-keys: same key in sibling objects is NOT a duplicate", () => {
  withTmp((dir) => {
    // repository.url and bugs.url are distinct keys in distinct objects.
    writeFileSync(join(dir, "package.json"),
      '{ "repository":{"url":"u1"},"bugs":{"url":"u2"} }');
    const r = run("check_package_keys.mjs", { cwd: dir, outDir: dir });
    assert.equal(r.code, 0, `expected pass, got ${r.code}: ${r.out}`);
  });
});

test("pkg-keys: same key in separate array elements is NOT a duplicate", () => {
  withTmp((dir) => {
    writeFileSync(join(dir, "package.json"),
      '{ "plugins":[{"name":"x"},{"name":"y"}] }');
    const r = run("check_package_keys.mjs", { cwd: dir, outDir: dir });
    assert.equal(r.code, 0, `expected pass, got ${r.code}: ${r.out}`);
  });
});

test("audit-target: a resolvable full SHA passes", () => {
  withTmp((dir) => {
    const head = gitOut(["rev-parse", "HEAD"], dir);
    writeFileSync(join(dir, "probe_audit_report.md"), `AUDIT_TARGET_HEAD: ${head}\n`);
    const r = run("check_audit_target.mjs", { cwd: REPO, env: { AUDIT_REPORT_DIRS: dir }, outDir: dir });
    assert.equal(r.code, 0, `expected pass, got ${r.code}: ${r.out}`);
  });
});

test("audit-target: a short SHA fails", () => {
  withTmp((dir) => {
    writeFileSync(join(dir, "probe_audit_report.md"), "AUDIT_TARGET_HEAD: 92f8871\n");
    const r = run("check_audit_target.mjs", { cwd: REPO, env: { AUDIT_REPORT_DIRS: dir }, outDir: dir });
    assert.equal(r.code, 1, `expected failure, got ${r.code}: ${r.out}`);
    assert.match(r.out, /40-character/i);
  });
});

test("audit-target: an unresolvable full SHA fails", () => {
  withTmp((dir) => {
    writeFileSync(join(dir, "probe_audit_report.md"),
      `AUDIT_TARGET_HEAD: ${"0".repeat(40)}\n`);
    const r = run("check_audit_target.mjs", { cwd: REPO, env: { AUDIT_REPORT_DIRS: dir }, outDir: dir });
    assert.equal(r.code, 1, `expected failure, got ${r.code}: ${r.out}`);
    assert.match(r.out, /does not resolve/i);
  });
});

test("audit-target: a report with no declaration fails", () => {
  withTmp((dir) => {
    writeFileSync(join(dir, "probe_audit_report.md"), "# Review\n\nno declaration here\n");
    const r = run("check_audit_target.mjs", { cwd: REPO, env: { AUDIT_REPORT_DIRS: dir }, outDir: dir });
    assert.equal(r.code, 1, `expected failure, got ${r.code}: ${r.out}`);
    assert.match(r.out, /does not declare/i);
  });
});

test("audit-target: non-audit filenames are ignored", () => {
  withTmp((dir) => {
    // A file that is not named as an audit must not require the declaration.
    writeFileSync(join(dir, "release_notes.md"), "# Notes\n");
    const r = run("check_audit_target.mjs", { cwd: REPO, env: { AUDIT_REPORT_DIRS: dir }, outDir: dir });
    assert.equal(r.code, 0, `expected pass, got ${r.code}: ${r.out}`);
    assert.match(r.out, /no audit reports found/i);
  });
});

test("audit-target: a missing report directory is not an error", () => {
  withTmp((dir) => {
    const r = run("check_audit_target.mjs", {
      cwd: REPO,
      env: { AUDIT_REPORT_DIRS: join(dir, "does-not-exist") },
      outDir: dir,
    });
    assert.equal(r.code, 0, `expected pass, got ${r.code}: ${r.out}`);
  });
});

test("audit-target: nested audit reports are found recursively", () => {
  withTmp((dir) => {
    const nested = join(dir, "deep", "deeper");
    mkdirSync(nested, { recursive: true });
    // Only the nested file is non-conforming; a recursive walk must find it.
    writeFileSync(join(nested, "inner_verification.md"), "# no declaration\n");
    const r = run("check_audit_target.mjs", { cwd: REPO, env: { AUDIT_REPORT_DIRS: dir }, outDir: dir });
    assert.equal(r.code, 1, `expected failure, got ${r.code}: ${r.out}`);
    assert.match(r.out, /inner_verification\.md/);
  });
});

test("audit-target: a pre-rule report is exempt, not failed", () => {
  withTmp((dir) => {
    // This basename is on the exemption list; it must not fail the run.
    writeFileSync(join(dir, "pi_balanced_max_fix_dsh_verification_20260927.md"),
      "# Verification\n\nno declaration\n");
    const r = run("check_audit_target.mjs", { cwd: REPO, env: { AUDIT_REPORT_DIRS: dir }, outDir: dir });
    assert.equal(r.code, 0, `expected pass, got ${r.code}: ${r.out}`);
    assert.match(r.out, /exempt/i, "must report the exemption, not hide it");
  });
});

test("audit-target: an exempt report WITH a declaration is still validated", () => {
  withTmp((dir) => {
    // Exemption applies only while the declaration is absent. A back-filled
    // (or newly added) declaration must be checked like any other.
    writeFileSync(join(dir, "pi_balanced_max_fix_dsh_verification_20260927.md"),
      `AUDIT_TARGET_HEAD: ${"0".repeat(40)}\n`);
    const r = run("check_audit_target.mjs", { cwd: REPO, env: { AUDIT_REPORT_DIRS: dir }, outDir: dir });
    assert.equal(r.code, 1, `expected failure, got ${r.code}: ${r.out}`);
    assert.match(r.out, /does not resolve/i);
  });
});

test("audit-target: an exempt report with a MALFORMED declaration fails", () => {
  withTmp((dir) => {
    writeFileSync(join(dir, "pi_balanced_max_fix_dsh_verification_20260927.md"),
      "AUDIT_TARGET_HEAD: abc1234\n");
    const r = run("check_audit_target.mjs", { cwd: REPO, env: { AUDIT_REPORT_DIRS: dir }, outDir: dir });
    assert.equal(r.code, 1, `expected failure, got ${r.code}: ${r.out}`);
    assert.match(r.out, /40-character/i);
  });
});

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);