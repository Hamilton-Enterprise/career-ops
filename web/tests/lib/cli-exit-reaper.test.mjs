import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { killActiveCliChildren, removeCliWorkDir, trackCliChild } from "../../src/lib/cli-launch.mjs";

function fakeChild(pid) {
  const child = Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null });
  return child;
}

function isDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
    return true;
  }
}

test("server exit kills a detached worker that would otherwise keep writing", { timeout: 15_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-exit-reaper-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, "worker.log");
  const spawnCli = new URL("../../src/lib/spawn-cli.mjs", import.meta.url).href;
  const caps = new URL("../../src/lib/worker-capabilities.mjs", import.meta.url).href;
  // A stand-in server: spawns a silent worker through the shared spawner,
  // reports its PID once it is writing, then exits normally.
  const parentSource = `
    import fs from "node:fs";
    import { spawnHeadlessCli } from ${JSON.stringify(spawnCli)};
    import { CAPS } from ${JSON.stringify(caps)};
    const out = ${JSON.stringify(out)};
    const worker = spawnHeadlessCli(process.execPath, ["-e", "setInterval(() => require('node:fs').appendFileSync(" + JSON.stringify(out) + ", 'x'), 20)"],
      { detached: process.platform !== "win32", stdio: "ignore" }, { cliId: "opencode", capabilities: CAPS.localReadOnly });
    worker.unref();
    const wait = setInterval(() => {
      if (fs.existsSync(out) && fs.statSync(out).size > 0) {
        clearInterval(wait);
        process.stdout.write(String(worker.pid));
        process.exit(0);
      }
    }, 10);
  `;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", parentSource], { stdio: ["ignore", "pipe", "inherit"] });
  let stdout = "";
  parent.stdout.on("data", (d) => { stdout += d; });
  const [code] = await once(parent, "close");
  assert.equal(code, 0);
  const workerPid = Number(stdout);
  assert.ok(workerPid > 0, "parent never reported its worker");
  t.after(() => { try { process.kill(workerPid, "SIGKILL"); } catch { /* gone */ } });

  for (let i = 0; i < 500 && !isDead(workerPid); i++) await delay(10);
  assert.ok(isDead(workerPid), "the worker outlived the server");
  const size = fs.statSync(out).size;
  await delay(100);
  assert.equal(fs.statSync(out).size, size, "nothing keeps writing after the server exits");
});

test("exit reaping SIGKILLs each active process group on POSIX and forgets closed children", () => {
  const grouped = fakeChild(101);
  const direct = fakeChild(202);
  const closed = fakeChild(303);
  trackCliChild(grouped, { processGroup: true });
  trackCliChild(direct, { processGroup: false });
  trackCliChild(closed, { processGroup: true });
  closed.emit("close", 0, null);
  const kills = [];
  killActiveCliChildren({ platform: "linux", kill: (pid, sig) => { kills.push([pid, sig]); if (pid === -101) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" }); } });
  assert.deepEqual(kills, [[-101, "SIGKILL"], [202, "SIGKILL"]]);
  grouped.emit("close", null, "SIGKILL");
  direct.emit("close", null, "SIGKILL");
});

test("exit reaping on Windows runs a synchronous System32 taskkill per running tree", () => {
  const running = fakeChild(4242);
  const exited = Object.assign(fakeChild(4343), { exitCode: 0 });
  trackCliChild(running, { processGroup: false });
  trackCliChild(exited, { processGroup: false });
  const calls = [];
  killActiveCliChildren({
    platform: "win32",
    systemRoot: "C:\\Windows",
    spawnSyncProcess: (command, args, options) => { calls.push({ command, args, options }); throw new Error("taskkill failed"); },
  });
  assert.deepEqual(calls.map((c) => [c.command, c.args]), [["C:\\Windows\\System32\\taskkill.exe", ["/PID", "4242", "/T", "/F"]]]);
  assert.notEqual(calls[0].options?.shell, true);
  running.emit("close", 1, null);
  exited.emit("close", 0, null);
});

test("a child without a PID (spawn failed) is not tracked", () => {
  const kills = [];
  trackCliChild(fakeChild(undefined), { processGroup: true });
  killActiveCliChildren({ platform: "linux", kill: (...a) => kills.push(a) });
  assert.deepEqual(kills, []);
});

const busy = (code) => () => { throw Object.assign(new Error(code), { code }); };

for (const code of ["EBUSY", "EPERM"]) {
  test(`work-dir removal retries with backoff on ${code}`, async () => {
    const calls = [];
    const removed = await removeCliWorkDir("/tmp/x", {
      rmSync: busy(code),
      rm: async (dir, options) => { calls.push([dir, options]); },
    });
    assert.equal(removed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "/tmp/x");
    assert.ok(calls[0][1].maxRetries >= 3, "retries a few times");
    assert.ok(calls[0][1].retryDelay > 0 && calls[0][1].retryDelay <= 200, "short backoff");
  });
}

test("work-dir removal reports failure when retries are exhausted or the error is not transient", async () => {
  assert.equal(await removeCliWorkDir("/tmp/x", { rmSync: busy("EBUSY"), rm: async () => { throw new Error("still busy"); } }), false);
  let retried = false;
  assert.equal(await removeCliWorkDir("/tmp/x", { rmSync: busy("EACCES"), rm: async () => { retried = true; } }), false);
  assert.equal(retried, false, "only lock-style errors are retried");
});

test("work-dir removal succeeds synchronously on the common path", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-rm-"));
  const pending = removeCliWorkDir(dir);
  assert.equal(fs.existsSync(dir), false, "removed before the first await");
  assert.equal(await pending, true);
});
