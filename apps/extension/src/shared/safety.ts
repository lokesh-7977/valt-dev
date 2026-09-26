/**
 * Destructive-action classifier. ALT never clicks/submits anything this flags unless the
 * developer turns on `allowDestructive`. Deliberately over-inclusive: a false positive costs one
 * skipped test; a false negative can delete, pay, email or log out in the developer's session.
 */

export interface DestructiveInput {
  text?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  name?: string | null;
  id?: string | null;
  href?: string | null;
  formAction?: string | null;
  method?: string | null;
  /** Surrounding context, e.g. the form's heading or purpose. */
  context?: string | null;
}

export interface DestructiveVerdict {
  destructive: boolean;
  reason: string | null;
}

const TERMS: Array<[RegExp, string]> = [
  [/\b(delete|deleting|remove|destroy|erase|purge|wipe|drop)\b/, "deletes data"],
  [/\b(pay|pay now|payment|refund|charge|purchase|buy|checkout|check out|place order|transfer|withdraw|donate)\b/, "moves money"],
  [/\b(send|resend|invite|email|notify|broadcast|publish|post to)\b/, "sends a message"],
  [/\b(log ?out|sign ?out)\b/, "ends the session"],
  [/\b(deactivate|disable account|close account|terminate|cancel subscription|unsubscribe)\b/, "closes an account"],
  [/\b(reset|revoke|archive|void|approve|reject|submit for approval|finali[sz]e)\b/, "irreversible state change"],
];

const URL_TERMS =
  /\/(delete|destroy|remove|pay|payments?\/\d+\/pay|refund|charge|checkout|transfer|logout|log-out|signout|sign-out|unsubscribe)(\/|$|\?|-)/i;

/** Split camelCase / snake_case / kebab-case identifiers into words. */
function words(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .toLowerCase();
}

export function classifyDestructive(input: DestructiveInput): DestructiveVerdict {
  if (input.method && input.method.toUpperCase() === "DELETE") {
    return { destructive: true, reason: "DELETE request" };
  }
  const label = [input.text, input.ariaLabel, input.title, input.name, input.id]
    .filter((s): s is string => Boolean(s && s.trim()))
    .map(words)
    .join(" | ");
  for (const [re, why] of TERMS) {
    const m = label.match(re);
    if (m) return { destructive: true, reason: `"${m[0]}" ${why}` };
  }
  for (const url of [input.href, input.formAction]) {
    if (url && URL_TERMS.test(url)) {
      return { destructive: true, reason: `target ${url} looks destructive` };
    }
  }
  if (input.context) {
    const ctx = words(input.context);
    if (/\b(danger zone|delete account|close account|payment details|card number)\b/.test(ctx)) {
      return { destructive: true, reason: "located in a destructive/payment context" };
    }
  }
  return { destructive: false, reason: null };
}
