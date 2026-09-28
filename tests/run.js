import assert from "node:assert";
import { lockOf, raiseOf } from "../bump.js";
import { step, close } from "../bumprun.js";
import { render } from "../app.js";

const base = {
  budget: 1,
  state: { holder: [], waiting: [], bumps: [], ledger: [], applied: [] },
  events: [{ id: 1, kind: "lock", task: "a", prio: 2 }],
  bad_task_code: "E_BAD_TASK", bad_prio_code: "E_BAD_PRIO",
  held_code: "E_HELD", not_held_code: "E_NOT_HELD",
  dup_wait_code: "E_DUP_WAIT", not_owner_code: "E_NOT_OWNER",
  event_error_code: "E_BAD_EVENT"
};

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("ok " + name); } catch (e) { failed += 1; console.log("FAIL " + name + " :: " + e.message); }
}

check("lockOf returns a list", () => {
  assert.ok(Array.isArray(lockOf([], "a", 1)));
});

check("raiseOf returns a holder", () => {
  assert.ok(Array.isArray(raiseOf([["a", 1, 1]], 3)));
});

check("step returns a state", () => {
  assert.strictEqual(typeof step(base).state, "object");
});

check("close returns a state", () => {
  assert.strictEqual(typeof close(base).state, "object");
});

check("render counts events", () => {
  assert.strictEqual(typeof render(base).count_events, "number");
});

console.log("5 cases, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
