// In-memory fake of the chrome.* APIs ALT uses. Installed on globalThis in test/setup.ts and
// reset before every test. `calls` records API calls in order, so tests can assert ordering.

type Listener = (...args: never[]) => unknown;

export class FakeEvent<L extends Listener = Listener> {
  readonly listeners: L[] = [];
  addListener(l: L): void {
    this.listeners.push(l);
  }
  removeListener(l: L): void {
    const i = this.listeners.indexOf(l);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  hasListener(l: L): boolean {
    return this.listeners.includes(l);
  }
  dispatch(...args: Parameters<L>): unknown[] {
    return [...this.listeners].map((l) => l(...args));
  }
}

class FakeStorageArea {
  data: Record<string, unknown> = {};
  constructor(
    private readonly area: string,
    private readonly onChanged: FakeEvent,
  ) {}
  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    const clone = (v: unknown) => (v === undefined ? v : structuredClone(v));
    if (keys == null) return structuredClone(this.data);
    const list = typeof keys === "string" ? [keys] : keys;
    return Object.fromEntries(list.filter((k) => k in this.data).map((k) => [k, clone(this.data[k])]));
  }
  async set(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: this.data[k], newValue: v };
      this.data[k] = structuredClone(v);
    }
    this.onChanged.dispatch(changes as never, this.area as never);
  }
  async remove(keys: string | string[]): Promise<void> {
    for (const k of typeof keys === "string" ? [keys] : keys) delete this.data[k];
  }
  async clear(): Promise<void> {
    this.data = {};
  }
}

export type FakeSender = { tab?: { id: number; url?: string }; url?: string };

export class FakePort {
  readonly onMessage = new FakeEvent<(msg: never, port: FakePort) => void>();
  readonly onDisconnect = new FakeEvent<(port: FakePort) => void>();
  other: FakePort | null = null;
  connected = true;
  readonly sent: unknown[] = [];
  constructor(
    readonly name: string,
    readonly sender?: FakeSender,
  ) {}
  postMessage(msg: unknown): void {
    if (!this.connected) throw new Error("Attempting to use a disconnected port object");
    this.sent.push(msg);
    const other = this.other;
    if (other) queueMicrotask(() => other.connected && other.onMessage.dispatch(structuredClone(msg) as never, other));
  }
  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    const other = this.other;
    if (other?.connected) {
      other.connected = false;
      other.onDisconnect.dispatch(other);
    }
  }
}

export type TabRecord = { id: number; url: string; active: boolean; windowId: number };

export function createChromeFake() {
  const calls: Array<{ api: string; args: unknown[] }> = [];
  const record = (api: string, ...args: unknown[]) => calls.push({ api, args });
  const storageChanged = new FakeEvent();
  const onMessage = new FakeEvent<
    (msg: never, sender: FakeSender, sendResponse: (r?: unknown) => void) => boolean | void
  >();
  const onConnect = new FakeEvent<(port: FakePort) => void>();
  const tabs = new Map<number, TabRecord>();
  const tabMessages: Array<{ tabId: number; msg: unknown }> = [];
  const badges = new Map<number | undefined, string>();
  const alarms = new Map<string, { periodInMinutes?: number }>();

  const fake = {
    calls,
    tabMessages,
    tabsById: tabs,
    badges,
    alarmsByName: alarms,
    storage: {
      local: new FakeStorageArea("local", storageChanged),
      session: new FakeStorageArea("session", storageChanged),
      onChanged: storageChanged,
    },
    runtime: {
      id: "fakeextensionid",
      lastError: undefined as undefined | { message: string },
      onMessage,
      onConnect,
      onInstalled: new FakeEvent(),
      onStartup: new FakeEvent(),
      getManifest: () => ({ version: "0.1.0", name: "ALT" }),
      getURL: (p: string) => `chrome-extension://fakeextensionid/${p.replace(/^\//, "")}`,
      async getPlatformInfo() {
        record("runtime.getPlatformInfo");
        return { os: "win", arch: "x86-64" };
      },
      /** Delivers to onMessage listeners as if sent from `sender` (default: extension page). */
      sendMessage(msg: unknown, sender: FakeSender = {}): Promise<unknown> {
        record("runtime.sendMessage", msg);
        return new Promise((resolve) => {
          let async = false;
          const respond = (r?: unknown) => resolve(r);
          for (const l of [...onMessage.listeners]) {
            if (l(structuredClone(msg) as never, sender, respond) === true) async = true;
          }
          if (!async) resolve(undefined);
        });
      },
      connect(info: { name: string }, sender?: FakeSender): FakePort {
        const client = new FakePort(info.name);
        const server = new FakePort(info.name, sender);
        client.other = server;
        server.other = client;
        onConnect.dispatch(server);
        return client;
      },
    },
    tabs: {
      onActivated: new FakeEvent(),
      onUpdated: new FakeEvent(),
      onRemoved: new FakeEvent(),
      async get(id: number) {
        const t = tabs.get(id);
        if (!t) throw new Error(`No tab with id: ${id}`);
        return { ...t };
      },
      async query(q: { active?: boolean; url?: string | string[] } = {}) {
        return [...tabs.values()].filter((t) => q.active === undefined || t.active === q.active);
      },
      async update(id: number, props: { active?: boolean }) {
        record("tabs.update", id, props);
        const t = tabs.get(id);
        if (t && props.active) {
          for (const o of tabs.values()) o.active = false;
          t.active = true;
        }
        return t;
      },
      async sendMessage(tabId: number, msg: unknown) {
        tabMessages.push({ tabId, msg: structuredClone(msg) });
      },
    },
    windows: {
      async update(id: number, props: unknown) {
        record("windows.update", id, props);
      },
    },
    action: {
      async setBadgeText({ tabId, text }: { tabId?: number; text: string }) {
        badges.set(tabId, text);
      },
      async getBadgeText({ tabId }: { tabId?: number }) {
        return badges.get(tabId) ?? "";
      },
      async setBadgeBackgroundColor() {},
    },
    sidePanel: {
      open(opts: unknown) {
        record("sidePanel.open", opts);
        return Promise.resolve();
      },
      setPanelBehavior(opts: unknown) {
        record("sidePanel.setPanelBehavior", opts);
        return Promise.resolve();
      },
    },
    alarms: {
      onAlarm: new FakeEvent<(alarm: { name: string }) => void>(),
      async create(name: string, info: { periodInMinutes?: number }) {
        alarms.set(name, info);
      },
      async clear(name: string) {
        return alarms.delete(name);
      },
      async get(name: string) {
        return alarms.has(name) ? { name, ...alarms.get(name) } : undefined;
      },
    },
    /** Test helper: add a tab the fake APIs know about. */
    addTab(t: Partial<TabRecord> & { id: number }): TabRecord {
      const rec: TabRecord = { url: "http://localhost:5180/invoices/new", active: false, windowId: 1, ...t };
      tabs.set(rec.id, rec);
      return rec;
    },
  };
  return fake;
}

export type ChromeFake = ReturnType<typeof createChromeFake>;

/** The fake installed for the current test. */
export const fakeChrome = (): ChromeFake => (globalThis as unknown as { chrome: ChromeFake }).chrome;
