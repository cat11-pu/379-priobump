// bump.js：加锁与临时拔高
export function lockOf(holder, task, prio) {
  if (holder && holder.length) return holder.slice();
  return [task, prio, prio];
}

export function raiseOf(holder, prio) {
  if (!holder || !holder.length) return holder;
  if (!(prio > holder[1])) return holder.slice();
  return [holder[0], prio, holder[2]];
}
