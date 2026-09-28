// bump.js：加锁与临时拔高（基线：一律原样返回）
export function lockOf(holder, task, prio) {
  return holder;
}

export function raiseOf(holder, prio) {
  return holder;
}
