import { MockHelper } from "./server.js";

const PAIRING_TOKEN = "4F7K-92QD";
const port = Number(process.env.ALT_HELPER_PORT ?? 7777);

const helper = new MockHelper({ port, logToDisk: true });

helper
  .start()
  .then((bound) => {
    console.log(`ALT token: ${PAIRING_TOKEN}`);
    console.log(`ALT mock helper on ws://127.0.0.1:${bound}/ws`);
  })
  .catch((err: unknown) => {
    console.error(`ALT mock helper could not start on port ${port}:`, err);
    process.exit(1);
  });

const shutdown = () => void helper.stop().then(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
