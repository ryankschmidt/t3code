import { startPublisherRuntime, loadPublisherConfig } from "../../src/publisher-runtime.ts";
import { PublicationStore } from "../../src/index.ts";
import { join } from "node:path";
const [configPath, authority] = process.argv.slice(2);
if (!configPath || !authority || !/^\d+$/.test(authority))
  throw Error("REHEARSAL_ARGUMENTS_REQUIRED");
const config = await loadPublisherConfig(configPath, Number(authority));
const store = new PublicationStore({ root: join(config.stateRoot, "publisher") });
await store.initialize({ "help.txt": "accepted runtime baseline" });
await store.openTask({ taskId: "runtime-task", agentId: "runtime-worker", scope: ["help.txt"] });
const server = await startPublisherRuntime(configPath, Number(authority));
console.log(JSON.stringify({ event: "LISTENING", pid: process.pid, socket: server.socketPath }));
process.on("SIGTERM", () => {
  void server.close().then(() => process.exit(0));
});
