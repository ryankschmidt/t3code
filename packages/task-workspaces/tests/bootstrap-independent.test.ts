import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("bootstrap channel reports failed control write without an unhandled stream error", () => {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const channel = new URL(`../src/bootstrap-channel.${extension}`, import.meta.url).href;
  const gate = new URL(`../src/worker-bootstrap.${extension}`, import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {Writable,PassThrough} from 'node:stream';
    import {BootstrapChannel} from ${JSON.stringify(channel)};
    import {bootstrapDigest} from ${JSON.stringify(gate)};
    const binding={agentId:'a',taskId:'t',runId:'r'}, expires=Date.now()+5000;
    const input=new Writable({write(_chunk,_encoding,done){done(Error('CONTROL_WRITE_FAILURE'));}});
    const output=new PassThrough();
    const channel=new BootstrapChannel(input,output,binding,expires);
    output.write(JSON.stringify({schema:'throughline.worker-ready.v1',digest:bootstrapDigest(binding,expires),pid:123,uid:1002})+'\\n');
    try {await channel.release('grant');throw Error('UNEXPECTED_RELEASE');}
    catch(e){if(!String(e).includes('CONTROL_WRITE_FAILURE'))throw e;}
    await new Promise(resolve=>setImmediate(resolve));
    console.log('CONTROL_FAILURE_HANDLED');
  `,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /CONTROL_FAILURE_HANDLED/);
});
