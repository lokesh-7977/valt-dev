import type { AltEvent, AltEventOf, AltEventPayloads, AltEventType } from "@valt/shared";

/**
 * The Phase 1 event stream. Everything ALT discovers, plans, runs and observes is emitted here as
 * a typed `AltEvent`.
 *
 * Phase 2/3 integration points:
 *   - in the service worker:  `bus.on("test.executed", (e) => analyse(e.payload.execution))`
 *   - from any extension page: `chrome.runtime.connect({ name: "alt:events" })` → replay + live
 */

export interface PortLike {
  postMessage(message: unknown): void;
  onDisconnect: { addListener(cb: () => void): void };
}

type Handler<T extends AltEventType> = (event: AltEventOf<T>) => void;
type AnyHandler = (event: AltEvent) => void;

export interface Bus {
  emit<T extends AltEventType>(type: T, payload: AltEventPayloads[T]): AltEventOf<T>;
  on<T extends AltEventType>(type: T, handler: Handler<T>): () => void;
  on(type: "*", handler: AnyHandler): () => void;
  recent(): AltEvent[];
  attachPort(port: PortLike): void;
  setSessionId(id: string): void;
}

export const RING_SIZE = 2000;

export function createBus(opts: { sessionId: string; now?: () => number; idGen?: () => string; ringSize?: number }): Bus {
  let sessionId = opts.sessionId;
  const now = opts.now ?? Date.now;
  let counter = 0;
  const idGen = opts.idGen ?? (() => `${now().toString(36)}-${(counter++).toString(36)}`);
  const ringSize = opts.ringSize ?? RING_SIZE;
  const ring: AltEvent[] = [];
  const handlers = new Map<string, Set<AnyHandler>>();
  const ports = new Set<PortLike>();

  const on = (type: string, handler: AnyHandler): (() => void) => {
    let set = handlers.get(type);
    if (!set) handlers.set(type, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  };

  return {
    emit(type, payload) {
      const event = { id: idGen(), ts: now(), sessionId, type, payload } as AltEventOf<typeof type>;
      ring.push(event as AltEvent);
      if (ring.length > ringSize) ring.splice(0, ring.length - ringSize);
      for (const key of [type, "*"]) {
        for (const h of handlers.get(key) ?? []) {
          try {
            h(event as AltEvent);
          } catch (err) {
            console.warn("ALT bus handler failed", err);
          }
        }
      }
      for (const p of ports) {
        try {
          p.postMessage({ kind: "event", event });
        } catch {
          ports.delete(p);
        }
      }
      return event;
    },
    on: on as Bus["on"],
    recent: () => ring.slice(),
    attachPort(port) {
      port.postMessage({ kind: "replay", events: ring.slice() });
      ports.add(port);
      port.onDisconnect.addListener(() => ports.delete(port));
    },
    setSessionId(id) {
      sessionId = id;
    },
  };
}
