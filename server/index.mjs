import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPortDeckServer } from "./app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const instance = await startPortDeckServer({
  host: "127.0.0.1",
  port: Number(process.env.PORTDECK_PORT || 4399),
  dataRoot: process.env.PORTDECK_DATA_DIR || path.join(root, "data"),
  version: "2.1.0",
});

async function shutdown(signal) {
  console.log(`\nReceived ${signal}; shutting down PortDeck.`);
  const timeout = setTimeout(() => process.exit(1), 3000);
  timeout.unref();
  await instance.close();
  clearTimeout(timeout);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
