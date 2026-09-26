import pkg from "../../package.json" with { type: "json" };

export const EXT_VERSION: string = pkg.version;
export const HELPER_START_COMMAND = "pnpm alt:helper";

export const FEED_CAP = 200;
export const CONTRACTS_CAP = 100;
export const QUEUE_CAP = 50;
export const QUEUE_BYTES = 8_000_000;
export const QUEUE_IN_FLIGHT = 10;

export const ACTION_TIMEOUT_MS = 10_000;
export const SETTLE_MS = 800;
/** A request counts toward a submit if it starts this long before the trigger… */
export const CORRELATE_BEFORE_MS = 50;
/** …or up to this long after it. */
export const CORRELATE_AFTER_MS = 2_000;
export const KEEPALIVE_MS = 20_000;
export const RECONNECT_MAX_MS = 2_000;
export const VERSION_RETRY_MS = 10_000;
export const TOAST_GROUP_MS = 1_000;

export const STORAGE_TOKEN = "alt_token";
export const STORAGE_MODE = "alt_mode";
export const STORAGE_STATE = "alt_state";
export const STORAGE_QUEUE = "alt_queue";
export const KEEPALIVE_ALARM = "alt-keepalive";
