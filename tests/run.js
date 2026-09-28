import assert from "node:assert";
import fs from "node:fs";
import { lockOf, raiseOf } from "../bump.js";
import { step, close } from "../bumprun.js";
import { render } from "../app.js";

const codes = {
  bad_task_code: "E_BAD_TASK", bad_prio_code: "E_BAD_PRIO",
  held_code: "E_HELD", not_held_code: "E_NOT_HELD",
  dup_wait_code: "E_DUP_WAIT", not_owner_code: "E_NOT_OWNER",
  event_error_code: "E_BAD_EVENT"
};

const empty = { holder: [], waiting: [], bumps: [], ledger: [], applied: [] };

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("ok " + name); } catch (e) { failed += 1; console.log("FAIL " + name + " :: " + (e && e.message)); }
}

function expectCode(fn, want) {
  try { fn(); } catch (e) { assert.strictEqual(e.code, want, "want " + want + " got " + (e && e.code)); return; }
  throw new Error("expected error " + want + " but none thrown");
}

check("1 lockOf and raiseOf semantics", () => {
  assert.deepStrictEqual(lockOf([], "a", 2), ["a", 2, 2]);
  assert.deepStrictEqual(lockOf(["a", 5, 2], "b", 9), ["a", 5, 2]);
  assert.deepStrictEqual(raiseOf(["a", 2, 2], 5), ["a", 5, 2]);
  assert.deepStrictEqual(raiseOf(["a", 5, 2], 5), ["a", 5, 2]);
  assert.deepStrictEqual(raiseOf(["a", 5, 2], 1), ["a", 5, 2]);
});

check("2 step honors budget, raises holder, defers rest to ledger", () => {
  const spec = Object.assign({}, codes, JSON.parse(fs.readFileSync("sample/locks.json", "utf8")));
  const r = step(spec);
  assert.strictEqual(r.served, 2);
  assert.deepStrictEqual(r.state.holder, ["a", 5, 2]);
  assert.deepStrictEqual(r.state.waiting, [["b", 5]]);
  assert.deepStrictEqual(r.state.bumps, [["a", 5]]);
  assert.strictEqual(r.ledger_before, 3);
  assert.deepStrictEqual(r.ledger, [["unlock", "a", null], ["lock", "b", 1], ["want", "c", 3]]);
  assert.ok(r.judged <= r.judged_bound);
});

check("3 close drains ledger and reaches final state", () => {
  const spec = Object.assign({}, codes, JSON.parse(fs.readFileSync("sample/locks.json", "utf8")));
  const first = step(spec);
  const done = close(Object.assign({}, spec, { state: first.state }));
  assert.strictEqual(done.catchup, 3);
  assert.deepStrictEqual(done.state.holder, ["b", 3, 1]);
  assert.deepStrictEqual(done.state.waiting, [["b", 5], ["c", 3]]);
  assert.deepStrictEqual(done.state.bumps, [["a", 5], ["b", 3]]);
  assert.strictEqual(done.state.ledger.length, 0);
});

check("4 error codes: validation first, then held/wait/owner state rules", () => {
  expectCode(() => step(Object.assign({}, codes, { budget: 1, state: empty,
    events: [{ id: 1, kind: "peek", task: "a" }] })), "E_BAD_EVENT");
  expectCode(() => step(Object.assign({}, codes, { budget: 1, state: empty,
    events: [{ id: 1, kind: "lock", task: "", prio: 1 }] })), "E_BAD_TASK");
  expectCode(() => step(Object.assign({}, codes, { budget: 1, state: empty,
    events: [{ id: 1, kind: "lock", task: "a", prio: 0 }] })), "E_BAD_PRIO");
  expectCode(() => step(Object.assign({}, codes, { budget: 1, state: empty,
    events: [{ id: 1, kind: "lock", task: "a", prio: 2.5 }] })), "E_BAD_PRIO");
  expectCode(() => step(Object.assign({}, codes, { budget: 1,
    state: { holder: ["a", 2, 2], waiting: [], bumps: [], ledger: [], applied: [] },
    events: [{ id: 1, kind: "lock", task: "b", prio: 9 }] })), "E_HELD");
  expectCode(() => step(Object.assign({}, codes, { budget: 1, state: empty,
    events: [{ id: 1, kind: "want", task: "b", prio: 9 }] })), "E_NOT_HELD");
  expectCode(() => step(Object.assign({}, codes, { budget: 2,
    state: { holder: ["a", 2, 2], waiting: [["b", 5]], bumps: [], ledger: [], applied: [] },
    events: [{ id: 1, kind: "want", task: "b", prio: 1 }] })), "E_DUP_WAIT");
  expectCode(() => step(Object.assign({}, codes, { budget: 1, state: empty,
    events: [{ id: 1, kind: "unlock", task: "a" }] })), "E_NOT_OWNER");
});

check("5 render keeps the eighteen-key contract and seven assertions", () => {
  const spec = Object.assign({}, codes, JSON.parse(fs.readFileSync("sample/locks.json", "utf8")));
  const view = render(spec);
  const keys = Object.keys(view);
  assert.strictEqual(keys.length, 18);
  assert.deepStrictEqual(keys.slice(0, 3), ["holder", "waiting", "bumps"]);
  assert.strictEqual(keys[keys.length - 1], "full_diff");
  assert.deepStrictEqual(view.holder, ["b", 3, 1]);
  assert.deepStrictEqual(view.waiting, [["b", 5], ["c", 3]]);
  assert.deepStrictEqual(view.bumps, [["a", 5], ["b", 3]]);
  assert.strictEqual(view.served_first, 2);
  assert.strictEqual(view.served_wide, 4);
  assert.strictEqual(view.pair_differs, true);
  assert.strictEqual(view.ledger_before, 3);
  assert.strictEqual(view.catchup, 3);
  assert.strictEqual(view.ledger_after, 0);
  assert.strictEqual(view.mid_differs, true);
  assert.strictEqual(view.closed_equal, true);
  assert.strictEqual(view.replay_new, 0);
  assert.strictEqual(view.judged <= view.judged_bound, true);
  assert.strictEqual(view.full_diff, 0);
});

console.log("5 cases, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
