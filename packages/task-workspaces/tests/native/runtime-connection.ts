import { serveConfiguredPublisherConnection } from "../../src/publisher-runtime.ts";
const [config, authority] = process.argv.slice(2);
if (!config || !authority || !/^\d+$/.test(authority)) throw Error("REHEARSAL_ARGUMENTS_REQUIRED");
await serveConfiguredPublisherConnection(config, Number(authority));
