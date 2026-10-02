// Modified for the subagent-mcp Pi adapter fork.
import assert from "node:assert/strict";

// Effort three-path parity guard.
//
// The effort decision lives in THREE places that must stay mutually CONSISTENT
// (SSOT §10 SOP-3):
//   - src/effort.ts   resolveEffort()      runtime buildCommand path
//   - src/routing.ts  normalizeEffort()    auto / table candidate path
//   - src/ruleset.ts  effortAllowed()      ruleset candidate consumption
//
// The three paths are NOT identical by design: resolveEffort acts on DIRECT
// caller input and throws on invalid tiers, while normalizeEffort/effortAllowed
// act on TABLE/ruleset tiers that are normalized before buildCommand runs, so
// they clamp or skip instead of throwing. This matrix records the real,
// intended behavior of each path for one (provider, model, effort) input.
//
// The point of the guard: any change to ONE path that is not reflected in the
// other two turns this red, so silent drift (the ultracode case) cannot recur.
//
// Expected values:
//   resolveEffort    -> "THROWS" | the --effort/--thinking value | "none" | "settings"
//   normalizeEffort  -> the normalized tier | null (skip candidate)
//   effortAllowed    -> true | false

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name); console.error("        " + e.message); failed++; }
}

async function main() {
  const { resolveEffort } = await import("../dist/effort.js");
  const { normalizeEffort } = await import("../dist/routing.js");
  const ruleset = await import("../dist/ruleset.js");

  // [provider, model, effort, resolveEffort, normalizeEffort, effortAllowed]
  //
  // effortAllowed is keyed on MODEL ONLY (ruleset.ts effortAllowed): it reads
  // PI_EFFORTS / SONNET_EFFORTS / CODEX_EFFORTS / LAUNCH_EFFORTS by model name,
  // ignoring provider.
  //
  // Two deliberate asymmetries are encoded here:
  //   1. "low" is absent from LAUNCH_EFFORTS: resolveEffort throws, normalizeEffort
  //      returns null (not a table tier -> skip candidate). Both REJECT.
  //   2. "ultracode" on a non-Opus target: resolveEffort throws, normalizeEffort
  //      CLAMPS to xhigh (the table path must not throw at spawn time), and
  //      effortAllowed rejects. The clamp is intentional and pre-dates this guard.
  const MATRIX = [
    // --- pi: catalog thinkingLevelMap is low/high/max only -------------------
    ["pi", "pi-balanced", "low",       "THROWS", null,    false], // reject: throw vs skip
    ["pi", "pi-balanced", "medium",    "high",   "high",  false], // PI_EFFORTS=[high,max]; medium is not a table tier
    ["pi", "pi-balanced", "high",      "high",   "high",  true ],
    ["pi", "pi-balanced", "xhigh",     "max",    "max",   false], // xhigh already normalized to max
    ["pi", "pi-balanced", "max",       "max",    "max",   true ],
    // ultracode is Opus-4.8+ ONLY; on pi the table path clamps to max (via xhigh).
    ["pi", "pi-balanced", "ultracode", "THROWS", "max",   false],

    // --- codex: no max / ultracode ------------------------------------------
    ["codex", "gpt-5.6",  "low",       "THROWS", null,    false], // reject: throw vs skip
    ["codex", "gpt-5.6",  "medium",    "medium", "medium", true ],
    ["codex", "gpt-5.6",  "high",      "high",   "high",   true ],
    ["codex", "gpt-5.6",  "xhigh",     "xhigh",  "xhigh",  true ],
    ["codex", "gpt-5.6",  "max",       "THROWS", "xhigh",  false], // runtime throws; table clamps; ruleset rejects
    ["codex", "gpt-5.6",  "ultracode", "THROWS", "xhigh",  false],

    // --- claude opus-4-8: the one target that owns ultracode -----------------
    ["claude", "opus-4-8", "low",       "THROWS",   null,        false],
    ["claude", "opus-4-8", "medium",    "medium",   "medium",    true ],
    ["claude", "opus-4-8", "max",       "max",      "max",       true ],
    ["claude", "opus-4-8", "ultracode", "settings", "ultracode", true ],

    // --- claude sonnet: ultracode not in SONNET_EFFORTS ----------------------
    ["claude", "sonnet",   "low",       "THROWS", null,    false],
    ["claude", "sonnet",   "medium",    "medium", "medium", true ],
    ["claude", "sonnet",   "max",       "max",    "max",    true ],
    ["claude", "sonnet",   "ultracode", "THROWS", "xhigh", false],

    // --- claude haiku: effort ignored; sentinel "none" both sides ------------
    // haiku requires the HAIKU_EFFORT sentinel, so a literal "medium" is rejected.
    ["claude", "haiku",    "medium",    "none",   "none",   false],
  ];

  function resolveActual(provider, model, effort) {
    try {
      const r = resolveEffort(provider, model, effort);
      if (r.kind === "flag") return r.value;
      if (r.kind === "none") return "none";
      return "settings";
    } catch {
      return "THROWS";
    }
  }

  function normalizeActual(provider, model, effort) {
    try {
      return normalizeEffort(provider, model, effort);
    } catch {
      return "THROWS";
    }
  }

  // effortAllowed is exercised through the ruleset validator's candidate check.
  // validateRulesetOutput takes a BARE ARRAY of candidate objects.
  function allowedActual(provider, model, effort) {
    const res = ruleset.validateRulesetOutput([
      { provider, model, effort, rank: 1 },
    ]);
    return res.ok === true;
  }

  test("effort parity: matrix is non-empty", () => {
    assert.ok(MATRIX.length > 0, "matrix must not be empty");
  });

  for (const [provider, model, effort, expResolve, expNormalize, expAllowed] of MATRIX) {
    const label = `${provider}/${model}/${effort}`;

    test(`parity ${label}: resolveEffort -> ${expResolve}`, () => {
      assert.equal(resolveActual(provider, model, effort), expResolve);
    });

    test(`parity ${label}: normalizeEffort -> ${expNormalize}`, () => {
      assert.equal(normalizeActual(provider, model, effort), expNormalize);
    });

    test(`parity ${label}: effortAllowed -> ${expAllowed}`, () => {
      assert.equal(allowedActual(provider, model, effort), expAllowed);
    });
  }

  // The specific contract this guard pins: ultracode on pi is rejected at
  // runtime and rejected by the ruleset, while the table path clamps to max
  // (never xhigh — pi's catalog has no xhigh).
  test("ultracode on pi: runtime rejects, table clamps to max, ruleset rejects", () => {
    assert.equal(resolveActual("pi", "pi-balanced", "ultracode"), "THROWS");
    assert.equal(normalizeActual("pi", "pi-balanced", "ultracode"), "max");
    assert.equal(allowedActual("pi", "pi-balanced", "ultracode"), false);
  });

  // pi's FINAL normalized tier must never be xhigh (the catalog thinkingLevelMap
// has no xhigh entry). ultracode may pass through xhigh internally on its way
// to the pi branch, but the returned value must be a pi-legal tier.
  test("pi never RETURNS xhigh from normalizeEffort", () => {
    for (const eff of ["low", "medium", "high", "xhigh", "max", "ultracode"]) {
      assert.notEqual(normalizeActual("pi", "pi-balanced", eff), "xhigh",
        `pi/${eff} must never return xhigh`);
    }
  });

  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();