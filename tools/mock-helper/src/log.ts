import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Every frame the mock receives, in order. Read by tests via GET /__mock/received. */
export class ReceivedLog {
  private readonly entries: unknown[] = [];
  private readonly file: string | null;

  constructor(writeToDisk: boolean) {
    if (!writeToDisk) {
      this.file = null;
      return;
    }
    const dir = fileURLToPath(new URL("../.logs/", import.meta.url));
    mkdirSync(dir, { recursive: true });
    this.file = `${dir}received.jsonl`;
  }

  add(entry: unknown): void {
    this.entries.push(entry);
    if (this.file) appendFileSync(this.file, JSON.stringify(entry) + "\n");
  }

  list(): unknown[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }
}
