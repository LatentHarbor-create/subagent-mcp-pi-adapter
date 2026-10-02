<!-- Modified for the subagent-mcp Pi adapter fork. -->
# Audit Target Provenance

An audit's verdict is meaningful only relative to the exact revision it
examined. This document defines the declaration that makes that revision
machine-checkable.

## The failure mode

A request to audit a repository is written against HEAD at time T0. The audit
runs at T1. Commits landed between T0 and T1.

The report that follows may describe code that no longer exists at either
revision -- and nothing in the report looks wrong. Every PASS and FAIL is
internally consistent; only the unstated premise is stale. A reader who trusts
the verdict is trusting a revision the report never names.

This is not a code defect and cannot be caught by reading the code. It is a
provenance gap, so it is closed at the report level.

## The declaration

Every audit report carries this line:

```
AUDIT_TARGET_HEAD: <full 40-character lowercase hex SHA>
```

Place it near the top of the report, before any findings.

Requirements:

- The SHA is the **full 40 characters**. A short SHA is refused: abbreviations
  are ambiguous to compare by eye, which is the exact comparison that fails.
- The SHA must **resolve to a commit** in the repository the audit examined.
  A revision that cannot be resolved cannot be verified by a reader.
- The line is **anchored at the start of its own line**, so it is parseable
  without reading surrounding prose.

## Resolving a mismatch

When the revision named in the request differs from the revision on disk:

1. Stop before producing findings.
2. Report both revisions: the requested target and the actual HEAD.
3. Ask which revision the audit should cover.
4. Record the answer as `AUDIT_TARGET_HEAD`.

An audit that proceeds against a revision it was not asked to examine produces
a verdict that answers a question nobody asked. Reporting the mismatch is
cheaper than a verdict built on a wrong premise.

## Enforcement

`scripts/check_audit_target.mjs` scans audit report files, requires the
declaration, and verifies the SHA resolves.

```bash
npm run check:audit-target
```

Report locations come from `AUDIT_REPORT_DIRS` (comma-separated, relative to
this repo; absolute paths are accepted). The default is `docs/history`, so the
check is inert in a checkout that has no such directory and can be pointed at
an external report tree:

```bash
AUDIT_REPORT_DIRS=../docs/history npm run check:audit-target
```

A file counts as an audit report when its name contains `audit`, `review`,
`verification`, or `spotcheck`.

## Scope

The check reads report headers only. It does not compare the declared revision
against current HEAD, because a report describing an older revision is
legitimate -- it is a record of what was examined then. The check enforces that
a verifiable revision is stated, not that it is current.