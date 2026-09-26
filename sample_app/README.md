# Sample app — signup form with one planted bug

A tiny standalone app for demoing the live QA agent (ADR 0016). Plain HTML + JS, no build step,
no network calls.

**The bug:** `validate()` in `app.js` never checks the password, so submitting a valid email with an
empty password shows "Account created!".

## Run

```bash
pnpm sample:serve   # http://localhost:8001
pnpm sample:watch   # POSTs to the API save hook whenever a file here changes
```

## The fix

In `app.js`, replace the `// BUG ...` comment in `validate()` with:

```js
  if (!password) errors.push("Password is required");
  else if (password.length < 8) errors.push("Password must be at least 8 characters");
```

## Demo script

1. `pnpm dev`, `pnpm sample:serve`, `pnpm sample:watch`; open http://localhost:3000/qa.
2. Save `app.js` (no change needed). A run starts on its own and reports the empty-password bug.
3. Apply the fix above and save. A new run starts and reports that validation works.
4. Revert `app.js` to the buggy version before the next demo.
