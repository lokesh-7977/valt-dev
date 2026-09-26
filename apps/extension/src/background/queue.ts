/**
 * ALT's work queue: what to do next. Discovery first (it's fast and feeds everything), then the
 * developer's current route, then tests by priority, then deeper exploration.
 */

export type Task =
  | { kind: "visit"; url: string; routeKey: string; depth: number; source: "start" | "link" | "action" | "developer" }
  | { kind: "explore_actions"; routeKey: string; url: string }
  | { kind: "test"; caseId: string; routeKey: string; priority: number }
  | { kind: "check_links"; routeKey: string; urls: string[] };

export function taskKey(t: Task): string {
  switch (t.kind) {
    case "visit":
      return `visit:${t.routeKey}`;
    case "explore_actions":
      return `explore:${t.routeKey}`;
    case "test":
      return `test:${t.caseId}`;
    case "check_links":
      return `links:${t.routeKey}`;
  }
}

function rank(t: Task, boosted: string | null): number {
  const boost = boosted !== null && t.routeKey === boosted && t.kind !== "check_links" ? -1_000_000 : 0;
  switch (t.kind) {
    case "visit":
      return boost + (t.source === "developer" ? -500 : 0) + t.depth;
    case "test":
      return boost + 1000 + t.priority;
    case "explore_actions":
      return boost + 5000;
    case "check_links":
      return 9000;
  }
}

export interface Queue {
  push(t: Task): boolean;
  pop(): Task | undefined;
  peek(): Task | undefined;
  has(key: string): boolean;
  boost(routeKey: string): void;
  removeWhere(pred: (t: Task) => boolean): number;
  size(): number;
  list(): Task[];
  serialize(): { tasks: Task[]; boosted: string | null };
}

export function createQueue(init?: { tasks: Task[]; boosted: string | null }): Queue {
  let tasks: Task[] = [];
  let boosted: string | null = init?.boosted ?? null;
  const keys = new Set<string>();
  let seq = 0;
  const order = new Map<string, number>();

  const sorted = () =>
    tasks
      .map((t) => ({ t, r: rank(t, boosted), o: order.get(taskKey(t)) ?? 0 }))
      .sort((a, b) => a.r - b.r || a.o - b.o)
      .map((x) => x.t);

  const q: Queue = {
    push(t) {
      const k = taskKey(t);
      if (keys.has(k)) return false;
      keys.add(k);
      order.set(k, seq++);
      tasks.push(t);
      return true;
    },
    pop() {
      const next = sorted()[0];
      if (!next) return undefined;
      const k = taskKey(next);
      tasks = tasks.filter((t) => taskKey(t) !== k);
      keys.delete(k);
      order.delete(k);
      return next;
    },
    peek: () => sorted()[0],
    has: (k) => keys.has(k),
    boost(routeKey) {
      boosted = routeKey;
    },
    removeWhere(pred) {
      const before = tasks.length;
      tasks = tasks.filter((t) => {
        if (!pred(t)) return true;
        keys.delete(taskKey(t));
        order.delete(taskKey(t));
        return false;
      });
      return before - tasks.length;
    },
    size: () => tasks.length,
    list: () => sorted(),
    serialize: () => ({ tasks: sorted(), boosted }),
  };
  for (const t of init?.tasks ?? []) q.push(t);
  return q;
}
