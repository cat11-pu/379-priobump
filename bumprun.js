// bumprun.js：按处理预算处理事件，用尽连着压账，收尾把账做完
import { lockOf, raiseOf } from "./bump.js";

const DEFAULTS = {
  bad_task_code: "E_BAD_TASK",
  bad_prio_code: "E_BAD_PRIO",
  held_code: "E_HELD",
  not_held_code: "E_NOT_HELD",
  dup_wait_code: "E_DUP_WAIT",
  not_owner_code: "E_NOT_OWNER",
  event_error_code: "E_BAD_EVENT"
};

function code(spec, name, fallback) {
  const value = spec ? spec[name] : undefined;
  return typeof value === "string" && value.length ? value : fallback;
}

function fail(spec, name, fallback, message) {
  const err = new Error(message || fallback);
  err.code = code(spec, name, fallback);
  throw err;
}

function isPosInt(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// 结构与字段校验（先于任何状态判断）：不通过直接抛错，返回规范化的三元组。
function normalize(ev, spec) {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) {
    fail(spec, "event_error_code", DEFAULTS.event_error_code, "bad event");
  }
  const kind = ev.kind;
  if (kind !== "lock" && kind !== "want" && kind !== "unlock") {
    fail(spec, "event_error_code", DEFAULTS.event_error_code, "bad event kind");
  }
  if (typeof ev.task !== "string" || ev.task.length === 0) {
    fail(spec, "bad_task_code", DEFAULTS.bad_task_code, "empty task name");
  }
  if (kind === "unlock") return [kind, ev.task, null];
  if (!isPosInt(ev.prio)) {
    fail(spec, "bad_prio_code", DEFAULTS.bad_prio_code, "prio must be positive integer");
  }
  return [kind, ev.task, ev.prio];
}

function cloneState(src) {
  const state = src || {};
  return {
    holder: Array.isArray(state.holder) ? state.holder.slice() : [],
    waiting: (Array.isArray(state.waiting) ? state.waiting : [])
      .map(function (row) { return [row[0], row[1]]; }),
    bumps: (Array.isArray(state.bumps) ? state.bumps : [])
      .map(function (row) { return [row[0], row[1]]; }),
    ledger: Array.isArray(state.ledger) ? state.ledger.slice() : [],
    applied: Array.isArray(state.applied) ? state.applied.slice() : []
  };
}

// 状态语义判断（按当前持有者与等待表，随预算可能撞不上这些错）。
function applyOne(state, item, spec) {
  const kind = item[0];
  const task = item[1];
  const prio = item[2];
  if (kind === "lock") {
    if (state.holder.length) fail(spec, "held_code", DEFAULTS.held_code, "lock is held");
    state.holder = lockOf(state.holder, task, prio);
  } else if (kind === "want") {
    if (!state.holder.length) fail(spec, "not_held_code", DEFAULTS.not_held_code, "lock is open");
    if (state.waiting.some(function (row) { return row[0] === task; })) {
      fail(spec, "dup_wait_code", DEFAULTS.dup_wait_code, "duplicate waiting task");
    }
    if (task !== state.holder[0] && prio > state.holder[1]) {
      state.bumps.push([state.holder[0], prio]);
      state.holder = raiseOf(state.holder, prio);
    }
    state.waiting.push([task, prio]);
    state.waiting.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  } else {
    if (!state.holder.length || state.holder[0] !== task) {
      fail(spec, "not_owner_code", DEFAULTS.not_owner_code, "not the holder");
    }
    state.holder = [];
  }
}

function run(spec, state, queue, limit) {
  let served = 0;
  while (queue.length && (limit === Infinity || served < limit)) {
    const item = queue.shift();
    applyOne(state, item, spec);
    state.applied.push(item);
    served += 1;
  }
  return served;
}

export function step(spec) {
  const input = spec || {};
  const state = cloneState(input.state);

  // 入队前先做结构校验：任一事件不合法直接抛错，状态保持原样。
  const incoming = (Array.isArray(input.events) ? input.events : []).map(function (ev) {
    return normalize(ev, input);
  });

  // 重放不新增：已在 applied 里的请求直接跳过，不花预算。
  const fresh = incoming.filter(function (item) {
    return !state.applied.some(function (done) {
      return done[0] === item[0] && done[1] === item[1] && done[2] === item[2];
    });
  });

  // 先还旧账，再处理新请求；用尽后没处理的连着载压账。
  const queue = state.ledger.concat(fresh);
  state.ledger = [];

  let budget = Number(input.budget);
  if (!Number.isFinite(budget) || budget < 0) budget = 0;
  budget = Math.floor(budget);

  const served = run(input, state, queue, budget);
  state.ledger = queue;

  const judgedBound = queue.length + served;
  return {
    state: state,
    served: served,
    ledger_before: state.ledger.length,
    ledger: state.ledger,
    judged: served,
    judged_bound: judgedBound
  };
}

export function close(spec) {
  const input = spec || {};
  const state = cloneState(input.state);
  const queue = state.ledger;
  state.ledger = [];
  const catchup = run(input, state, queue, Infinity);
  state.ledger = queue;
  return { state: state, catchup: catchup };
}
