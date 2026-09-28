// bumprun.js：按处理预算处理 lock/want/unlock 事件，用尽预算的事件压账，收尾补做。
import { lockOf, raiseOf } from "./bump.js";

const codes = {
  badEvent: "E_BAD_EVENT",
  badTask: "E_BAD_TASK",
  badPrio: "E_BAD_PRIO",
  held: "E_HELD",
  notHeld: "E_NOT_HELD",
  dupWait: "E_DUP_WAIT",
  notOwner: "E_NOT_OWNER"
};

function fail(code, message) {
  const error = new Error(message || code);
  error.code = code;
  throw error;
}

function isPosInt(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

// 结构、任务名、优先级先校验（不合法直接报错，不耗预算、不改状态）。
function validate(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    fail(codes.badEvent);
  }
  const kind = event.kind;
  if (kind !== "lock" && kind !== "want" && kind !== "unlock") {
    fail(codes.badEvent);
  }
  if (typeof event.task !== "string" || event.task.length === 0) {
    fail(codes.badTask);
  }
  if (kind !== "unlock" && !isPosInt(event.prio)) {
    fail(codes.badPrio);
  }
}

// 压账条目：三元组 [kind, task, prio]，id 挂成不可枚举属性（重放去重用，JSON 看不到）。
function makeRow(kind, task, prio, id) {
  const row = [kind, task, prio === undefined ? null : prio];
  Object.defineProperty(row, "id", { value: id, enumerable: false, configurable: true, writable: true });
  return row;
}

function rowToEvent(row) {
  const event = { kind: row[0], task: row[1], prio: row[2] };
  if (Object.prototype.hasOwnProperty.call(row, "id")) event.id = row.id;
  return event;
}

function eventToRow(event) {
  return makeRow(event.kind, event.task, event.prio, event.id);
}

function cloneState(state) {
  state = state || {};
  const holder = Array.isArray(state.holder) && state.holder.length ? state.holder.slice() : [];
  const waiting = (Array.isArray(state.waiting) ? state.waiting : [])
    .map(function (row) { return [row[0], row[1]]; });
  waiting.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  const bumps = (Array.isArray(state.bumps) ? state.bumps : [])
    .map(function (row) { return [row[0], row[1]]; });
  const ledger = (Array.isArray(state.ledger) ? state.ledger : [])
    .map(function (row) { return makeRow(row[0], row[1], row[2], Object.prototype.hasOwnProperty.call(row, "id") ? row.id : undefined); });
  const applied = Array.isArray(state.applied) ? state.applied.slice() : [];
  return { holder: holder, waiting: waiting, bumps: bumps, ledger: ledger, applied: applied };
}

// 通过校验后，按当前持有者/等待表判业务规则；非法同样报错，不耗预算。
function applyEvent(state, event) {
  const kind = event.kind;
  if (kind === "lock") {
    if (state.holder.length) fail(codes.held);
    state.holder = lockOf(state.holder, event.task, event.prio);
    return;
  }
  if (kind === "want") {
    if (!state.holder.length) fail(codes.notHeld);
    for (const row of state.waiting) {
      if (row[0] === event.task) fail(codes.dupWait);
    }
    const beforePrio = state.holder[1];
    state.holder = raiseOf(state.holder, event.prio);
    if (state.holder[1] > beforePrio) {
      state.bumps.push([state.holder[0], state.holder[1]]);
    }
    state.waiting.push([event.task, event.prio]);
    state.waiting.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    return;
  }
  // unlock
  if (!state.holder.length || state.holder[0] !== event.task) fail(codes.notOwner);
  state.holder = [];
}

// 处理核心：先做旧账，再做新事件；每条花一次预算，用尽后连着压账。
function run(spec, withEvents) {
  const state = cloneState(spec.state);
  const budget = Number.isFinite(spec.budget) ? spec.budget : Infinity;
  const seen = new Set(state.applied);

  const queue = state.ledger
    .map(function (row) { return { event: rowToEvent(row), fromLedger: true }; });
  if (withEvents) {
    for (const event of (spec.events || [])) queue.push({ event: event, fromLedger: false });
  }

  let served = 0;
  let spent = 0;
  state.ledger = [];

  for (const item of queue) {
    const event = item.event;
    let id = null;
    if (event && typeof event === "object" && Object.prototype.hasOwnProperty.call(event, "id")) {
      id = event.id;
    }
    if (id !== null && seen.has(id)) continue; // 重放：已处理过的不做第二遍

    if (spent >= budget) {
      state.ledger.push(item.fromLedger ? rowToLedgerRow(event) : eventToRow(event));
      continue;
    }
    validate(event);
    applyEvent(state, event);
    spent += 1;
    served += 1;
    if (id !== null && !seen.has(id)) {
      seen.add(id);
      state.applied.push(id);
    }
  }

  return {
    state: state,
    served: served,
    ledger_before: state.ledger.length,
    ledger: state.ledger,
    judged: served + state.ledger.length,
    judged_bound: queue.length
  };
}

function rowToLedgerRow(event) {
  return makeRow(event.kind, event.task, event.prio,
    Object.prototype.hasOwnProperty.call(event, "id") ? event.id : undefined);
}

export function step(spec) {
  return run(spec || {}, true);
}

export function close(spec) {
  const full = run(Object.assign({}, spec, { budget: Infinity }), false);
  return { state: full.state, catchup: full.served };
}
