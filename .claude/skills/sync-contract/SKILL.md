---
name: sync-contract
description: Keep the API contract in sync between apps/api/src/valt_api/schemas.py (Pydantic) and packages/shared/src/index.ts (TypeScript). Use whenever a request/response model, SSE event payload, or enum changes, when the user says sync types/contract/schemas, or to audit for drift between the two files.
---

# Sync Contract

`schemas.py` is the source of truth. `packages/shared/src/index.ts` mirrors it by hand (ADR 0002).
A change to one without the other is a broken build waiting to happen.

## Procedure

1. Read both files in full.
2. Build a drift table — every model/interface, field by field:

   | Model | Field | Python | TypeScript | Status |
   | --- | --- | --- | --- | --- |
   | Item | description | `str \| None = None` | `string \| null` | ok |

3. Apply the mapping below to bring TypeScript in line with Python (never the reverse unless the
   user says the TS side is correct).
4. Verify:
   ```bash
   pnpm --filter @valt/web typecheck
   pnpm --filter @valt/api typecheck
   ```
5. Report the drift table (only changed rows) and verification output.

## Type mapping (Pydantic v2 JSON output → TS)

| Python | TypeScript |
| --- | --- |
| `str`, `EmailStr`, `HttpUrl`, `UUID`, `datetime`, `date` | `string` |
| `int`, `float`, `Decimal` (as float) | `number` |
| `bool` | `boolean` |
| `X \| None` with no default (required, nullable) | `x: X \| null` |
| `X \| None = None` in a **response** model | `x: X \| null` (always serialized) |
| `X \| None = None` in a **request** model | `x?: X \| null` |
| field with a non-None default in a request model | `x?: X` |
| `list[X]` | `X[]` |
| `dict[str, X]` | `Record<string, X>` |
| `Literal["a", "b"]` | `"a" \| "b"` |
| `Enum` (str values) | string-literal union of the values |
| Nested `BaseModel` | its interface |
| Generic `Page[T]` | `interface Page<T>` |
| Discriminated SSE events | discriminated union on `event` (see `RunEvent`) |

Field names stay exactly as serialized (snake_case unless the model sets an alias generator).

## Rules

- Keep the header comment in each file pointing at the other.
- Keep declaration order the same in both files so diffs line up.
- Response models that are subclasses (`Item(ItemCreate)`) become separate TS interfaces with all
  fields spelled out — request optionality must not leak into the response type.

## When hand-syncing stops scaling

If the drift table grows past ~15 models or drift keeps recurring, propose (via the `adr` skill)
generating types from `/openapi.json` with `openapi-typescript` into `packages/shared/src/api.gen.ts`.
