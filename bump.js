// bump.js：加锁与临时拔高（纯函数，不改入参）
// holder 形态：[任务名, 当前优先级, 本来优先级]；空表表示锁开着。
export function lockOf(holder, task, prio) {
  if (Array.isArray(holder) && holder.length) return holder.slice();
  return [task, prio, prio];
}

export function raiseOf(holder, prio) {
  if (!Array.isArray(holder) || !holder.length) return [];
  if (prio > holder[1]) return [holder[0], prio, holder[2]];
  return holder.slice();
}
