import { z } from "zod";

// Zod 4 probes JIT support with `new Function("")`, which trips CSP in extension pages
// (colinhacks/zod#4461, #5789). This must run before any schema is constructed.
z.config({ jitless: true });
