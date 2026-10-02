import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripDirectiveModificationNotice } from "../dist/orchestration/directive-text.js";
import { readDirective } from "../dist/orchestration/hook-core.js";

const notice = "<!-- Modified for the subagent-mcp Pi adapter fork. -->";

test("the exact leading file notice is omitted with either line ending", () => {
  for (const eol of ["\n", "\r\n"]) {
    assert.equal(stripDirectiveModificationNotice(notice + eol + "body" + eol), "body" + eol);
  }
});

test("other comments and notices inside a directive remain intact", () => {
  for (const body of ["<!-- instructions -->\nbody", "body\n" + notice + "\n", notice]) {
    assert.equal(stripDirectiveModificationNotice(body), body);
  }
});

test("the shipped directive keeps its notice on disk and injects only its body", () => {
  const raw = readFileSync(new URL("../directives/orchestration-codex.md", import.meta.url), "utf8");
  assert.ok(raw.startsWith(notice + "\n") || raw.startsWith(notice + "\r\n"));
  assert.equal(readDirective({}, "orchestration-codex.md"), stripDirectiveModificationNotice(raw));
  assert.ok(!readDirective({}, "orchestration-codex.md").includes(notice));
});
