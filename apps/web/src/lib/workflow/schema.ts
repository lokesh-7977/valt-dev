import { z } from "zod";

import { formatBytes } from "@/lib/utils";

const isFile = (v: unknown): v is File => typeof File !== "undefined" && v instanceof File;

/** Zod schema for the multimodal input form, built from a workflow's limits. */
export function makeInputSchema(opts: { maxFiles: number; maxFileMb: number; maxChars?: number }) {
  const maxBytes = opts.maxFileMb * 1024 * 1024;
  return z
    .object({
      text: z
        .string()
        .max(opts.maxChars ?? 100_000, "That's too long — shorten the text and try again."),
      files: z
        .array(
          z
            .custom<File>(isFile, "Invalid file")
            .refine((f) => f.size > 0, "This file is empty.")
            .refine((f) => f.size <= maxBytes, `Files must be under ${formatBytes(maxBytes)}.`),
        )
        .max(opts.maxFiles, `Add up to ${opts.maxFiles} files.`),
    })
    .refine((v) => v.text.trim().length > 0 || v.files.length > 0, {
      message: "Add some text, a file, an image, or a recording to continue.",
      path: ["text"],
    });
}

export type InputFormValues = z.infer<ReturnType<typeof makeInputSchema>>;

/** Does `file` match an accept list like ["image/*", "application/pdf", ".md"]? */
export function matchesAccept(file: File, accept: string[]): boolean {
  if (accept.length === 0) return true;
  const name = file.name.toLowerCase();
  return accept.some((rule) => {
    const r = rule.trim().toLowerCase();
    if (r.startsWith(".")) return name.endsWith(r);
    if (r.endsWith("/*")) return file.type.startsWith(r.slice(0, -1));
    return file.type === r;
  });
}
