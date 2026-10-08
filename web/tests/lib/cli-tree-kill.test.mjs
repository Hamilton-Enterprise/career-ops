import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { terminateCliRun, terminateCliTree } from "../../src/lib/cli-launch.mjs";

function fakeChild({ pid = 4242, exitCode = null, signalCode = null } = {}) {
  const child = Object.assign(new EventEmitter(), { pid, exitCode, signalCode, kills: [] });
  child.kill = (signal) => { child.kills.push(signal); return true; };
  const pipe = () => Object.assign(new EventEmitter(), { destroyed: false, destroy() { this.destroyed = true; } });
  child.stdout = pipe();
  child.stderr = pipe();
  return child;
}

const taskkillPath = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");

function recordingSpawner() {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    const proc = new EventEmitter();
    calls.push({ command, args, options, proc });
    return proc;
  };
  return { calls, spawnProcess };
}

test("Windows: terminates the run's process tree with taskkill, without a shell", () => {
  const child = fakeChild();
  const { calls, spawnProcess } = recordingSpawner();
  const kills = [];
  assert.equal(terminateCliTree(child, "SIGTERM", { platform: "win32", spawnProcess, kill: (...a) => kills.push(a) }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, taskkillPath, "taskkill comes from System32, not from PATH");
  assert.deepEqual(calls[0].args, ["/PID", "4242", "/T", "/F"]);
  assert.notEqual(calls[0].options?.shell, true);
  assert.deepEqual(kills, [], "no POSIX process-group signal on Windows");
  assert.deepEqual(child.kills, []);
});

test("Windows: a tree that is already gone is tolerated", () => {
  const child = fakeChild();
  const { calls, spawnProcess } = recordingSpawner();
  terminateCliTree(child, "SIGKILL", { platform: "win32", spawnProcess });
  // taskkill exits non-zero when the PID no longer exists; nothing listens for that.
  assert.doesNotThrow(() => calls[0].proc.emit("exit", 128, null));
});

test("Windows: falls back to killing the child when taskkill cannot start", () => {
  const child = fakeChild();
  const { calls, spawnProcess } = recordingSpawner();
  terminateCliTree(child, "SIGTERM", { platform: "win32", spawnProcess });
  assert.doesNotThrow(() => calls[0].proc.emit("error", Object.assign(new Error("spawn taskkill ENOENT"), { code: "ENOENT" })));
  assert.deepEqual(child.kills, ["SIGTERM"]);
});

test("Windows: an exited child is not targeted, since its PID may be reused", () => {
  const { calls, spawnProcess } = recordingSpawner();
  assert.equal(terminateCliTree(fakeChild({ exitCode: 0 }), "SIGTERM", { platform: "win32", spawnProcess }), false);
  assert.equal(terminateCliTree({ ...fakeChild(), pid: undefined }, "SIGTERM", { platform: "win32", spawnProcess }), false);
  assert.equal(calls.length, 0);
});

test("POSIX: signals the detached child's process group", () => {
  const child = fakeChild();
  const { calls, spawnProcess } = recordingSpawner();
  const kills = [];
  assert.equal(terminateCliTree(child, "SIGTERM", { platform: "linux", spawnProcess, kill: (...a) => kills.push(a) }), true);
  assert.deepEqual(kills, [[-4242, "SIGTERM"]]);
  assert.equal(calls.length, 0, "taskkill is Windows-only");
  assert.deepEqual(child.kills, []);
});

test("POSIX: falls back to the direct child when the group is gone", () => {
  const child = fakeChild();
  const kill = () => { throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" }); };
  assert.equal(terminateCliTree(child, "SIGKILL", { platform: "darwin", kill }), true);
  assert.deepEqual(child.kills, ["SIGKILL"]);
});

const groupGone = () => { throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" }); };

test("run termination releases our stdio once the run's own tree has exited", () => {
  const child = fakeChild();
  terminateCliRun(child, { platform: "linux", kill: groupGone });
  assert.deepEqual(child.kills, ["SIGTERM"]);
  assert.equal(child.stdout.destroyed, false, "output is kept until the child itself exits");
  child.exitCode = 143;
  child.emit("exit", 143, null);
  // An escaped descendant may still hold the far ends; destroying ours lets `close` fire.
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  child.emit("close", 143, null);
});

test("run termination keeps stdio while the process group survives, then forces it", async () => {
  const child = fakeChild();
  let groupAlive = true;
  const signals = [];
  const kill = (pid, sig) => {
    signals.push([pid, sig]);
    if (!groupAlive && sig === 0) groupGone();
    if (sig === "SIGKILL") groupAlive = false;
  };
  terminateCliRun(child, { platform: "linux", kill, forceAfterMs: 10, closeWithinMs: 1_000 });
  child.exitCode = 0;
  child.emit("exit", 0, null);
  assert.equal(child.stdout.destroyed, false, "a SIGTERM-ignoring group member still writes until SIGKILL");
  await delay(30);
  assert.ok(signals.some(([pid, sig]) => pid === -4242 && sig === "SIGKILL"));
  assert.equal(child.stdout.destroyed, true);
  child.emit("close", 0, null);
});

test("run termination reports a close that never arrives, once, within the bound", async () => {
  const child = fakeChild();
  let timeouts = 0;
  terminateCliRun(child, { platform: "linux", kill: groupGone, forceAfterMs: 10, closeWithinMs: 10, onCloseTimeout: () => { timeouts++; } });
  terminateCliRun(child, { platform: "linux", kill: groupGone, forceAfterMs: 10, closeWithinMs: 10, onCloseTimeout: () => { timeouts++; } });
  await delay(60);
  assert.equal(timeouts, 1, "repeat termination requests are no-ops");
  assert.equal(child.stdout.destroyed, true);
});

test("run termination does not report a timeout when close arrives", async () => {
  const child = fakeChild();
  let timeouts = 0;
  terminateCliRun(child, { platform: "linux", kill: groupGone, forceAfterMs: 10, closeWithinMs: 10, onCloseTimeout: () => { timeouts++; } });
  child.exitCode = 143;
  child.emit("exit", 143, null);
  child.emit("close", 143, null);
  await delay(60);
  assert.equal(timeouts, 0);
});

test("run termination of an already closed child signals nothing", async () => {
  const child = fakeChild({ exitCode: 0 });
  child.stdout.destroyed = true;
  child.stderr.destroyed = true;
  const { calls, spawnProcess } = recordingSpawner();
  let timeouts = 0;
  terminateCliRun(child, { platform: "win32", spawnProcess, forceAfterMs: 10, closeWithinMs: 10, onCloseTimeout: () => { timeouts++; } });
  await delay(40);
  assert.equal(calls.length, 0);
  assert.deepEqual(child.kills, []);
  assert.equal(timeouts, 0);
});

test("Windows run termination releases stdio when the child exits, even if a grandchild was orphaned", () => {
  const child = fakeChild();
  const { calls, spawnProcess } = recordingSpawner();
  terminateCliRun(child, { platform: "win32", spawnProcess });
  assert.equal(calls[0].command, taskkillPath);
  child.exitCode = 1;
  child.emit("exit", 1, null);
  assert.equal(child.stdout.destroyed, true);
  child.emit("close", 1, null);
});
