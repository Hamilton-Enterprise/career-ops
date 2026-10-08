import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { terminateCliTree } from "../../src/lib/cli-launch.mjs";

function fakeChild({ pid = 4242, exitCode = null, signalCode = null } = {}) {
  const child = { pid, exitCode, signalCode, kills: [] };
  child.kill = (signal) => { child.kills.push(signal); return true; };
  return child;
}

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
  assert.equal(calls[0].command, "taskkill");
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
