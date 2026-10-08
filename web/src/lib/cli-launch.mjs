import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Prepare a CLI process without routing user-controlled prompts through a shell.
 *
 * npm installs an extensionless POSIX shim plus `.cmd` and `.ps1` wrappers on
 * Windows. `findBin()` can discover the extensionless shim, but CreateProcess
 * cannot execute it (`ENOENT`); `.cmd` also requires a shell (`EINVAL`). npm's
 * generated PowerShell wrapper names the real JS/native entrypoint immediately
 * before `$args`. Resolve that trusted local target and spawn it directly, so
 * prompts keep their argument boundaries without `shell: true` or PowerShell's
 * lossy `-File` argument conversion.
 *
 * @param {string} binPath
 * @param {string[]} args
 * @param {string} [platform]
 * @returns {{ command: string, args: string[] }}
 * @throws {Error} On Windows, for a .cmd/.bat/.ps1 wrapper it cannot resolve.
 */
export function prepareCliLaunch(binPath, args, platform = process.platform) {
  if (platform !== "win32") return { command: binPath, args };

  const ext = path.extname(binPath).toLowerCase();
  if (ext && ![".cmd", ".bat", ".ps1"].includes(ext)) return { command: binPath, args };

  const shimBase = ext ? binPath.slice(0, -ext.length) : binPath;
  const ps1Shim = `${shimBase}.ps1`;
  // Nothing resolved. An extensionless path is handed back unchanged (spawn()
  // may still find a .exe beside it), but a .cmd/.bat/.ps1 needs a shell, which
  // is what this avoids: spawned as-is it only fails (EINVAL for .cmd/.bat), so
  // refuse it with the reason instead.
  const unresolved = () => {
    if (!ext) return { command: binPath, args };
    throw new Error(
      `Cannot launch ${binPath} without a shell: no npm PowerShell shim beside it names the CLI's real .js or .exe. ` +
        "Reinstall the CLI with npm, or put its native .exe on PATH.",
    );
  };
  if (!fs.existsSync(ps1Shim)) return unresolved();

  let wrapper = "";
  try {
    wrapper = fs.readFileSync(ps1Shim, "utf8");
  } catch {
    return unresolved();
  }

  const targetMatches = wrapper.matchAll(/["']\$basedir[\\/]([^"']+)["']\s+\$args/g);
  for (const match of targetMatches) {
    const target = path.resolve(path.dirname(ps1Shim), match[1].replace(/[\\/]/g, path.sep));
    if (!fs.existsSync(target)) continue;
    const targetExt = path.extname(target).toLowerCase();
    if ([".js", ".cjs", ".mjs"].includes(targetExt)) {
      return { command: process.execPath, args: [target, ...args] };
    }
    if ([".exe", ".com"].includes(targetExt)) {
      return { command: target, args };
    }
  }

  return unresolved();
}

/**
 * Terminate a CLI run together with every process it started.
 *
 * POSIX: the child must have been spawned `detached`, so it leads its own
 * process group and `kill(-pid)` reaches its descendants. Windows has neither
 * process groups nor signals, and `child.kill()` ends only the direct child —
 * descendants survive holding its stdio and working directory. There the tree
 * is ended with `taskkill /T /F`, spawned without a shell from System32 so a
 * `taskkill` earlier on PATH cannot stand in for it. taskkill failing because
 * the tree is already gone is the expected outcome, not an error.
 *
 * @param {{ pid?: number, exitCode: number | null, signalCode: string | null, kill: (signal?: NodeJS.Signals) => boolean }} child
 * @param {NodeJS.Signals} signal Ignored on Windows, where termination is always forced.
 * @param {TreeDeps} [deps]
 * @returns {boolean} Whether a termination was dispatched.
 *
 * @typedef {{ platform?: string, spawnProcess?: typeof spawn, kill?: (pid: number, signal: NodeJS.Signals | 0) => unknown, systemRoot?: string }} TreeDeps
 */
export function terminateCliTree(
  child,
  signal,
  {
    platform = process.platform,
    spawnProcess = spawn,
    kill = (pid, sig) => process.kill(pid, sig),
    systemRoot = process.env.SystemRoot || "C:\\Windows",
  } = {},
) {
  const directKill = () => {
    try {
      return child.kill(signal);
    } catch {
      return false;
    }
  };

  if (platform === "win32") {
    // An exited child's PID may already belong to an unrelated process.
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return false;
    try {
      const taskkillExe = path.win32.join(systemRoot, "System32", "taskkill.exe");
      const taskkill = spawnProcess(taskkillExe, ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      taskkill.on("error", directKill);
      return true;
    } catch {
      return directKill();
    }
  }

  if (child.pid) {
    try {
      kill(-child.pid, signal);
      return true;
    } catch {
      /* group may already be gone; fall back to the direct child */
    }
  }
  return directKill();
}

const terminating = new WeakSet();

/**
 * Terminate a CLI run's tree and make the child's `close` arrive within a bound.
 *
 * `close` waits for every holder of the child's stdio, and that includes a
 * descendant that escaped the tree kill (POSIX `setsid`, or a Windows grandchild
 * orphaned before taskkill walked the tree): it would never fire, and whatever
 * the caller releases on `close` would leak. So once the run's own tree has
 * exited, our ends of its pipes are destroyed — a run being terminated has no
 * output left to deliver — which lets `close` fire. SIGTERM first; SIGKILL and
 * the same stdio release after `forceAfterMs`; if `close` still has not arrived
 * `closeWithinMs` later, `onCloseTimeout` runs once so the caller can release
 * without it. Repeat calls for the same child, or a child that already closed,
 * are no-ops.
 *
 * @param {import("node:child_process").ChildProcess} child Spawned `detached` on POSIX.
 * @param {TreeDeps & { forceAfterMs?: number, closeWithinMs?: number, onCloseTimeout?: () => void }} [options]
 */
export function terminateCliRun(child, { forceAfterMs = 5_000, closeWithinMs = 2_000, onCloseTimeout = () => {}, ...treeDeps } = {}) {
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const stdio = [child.stdout, child.stderr].filter((s) => s !== null && s !== undefined);
  // Node destroys every stdio stream before it emits the child's `close`.
  if (terminating.has(child) || (exited() && stdio.every((s) => s.destroyed))) return;
  terminating.add(child);

  const platform = treeDeps.platform ?? process.platform;
  const kill = treeDeps.kill ?? ((pid, sig) => process.kill(pid, sig));
  const treeAlive = () => {
    if (platform === "win32" || !child.pid) return !exited();
    try {
      kill(-child.pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const releaseStdio = () => {
    for (const s of stdio) s.destroy();
  };

  let closed = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let closeDeadline;
  const forceKill = setTimeout(() => {
    terminateCliTree(child, "SIGKILL", treeDeps);
    releaseStdio();
    if (closed) return;
    closeDeadline = setTimeout(() => {
      if (!closed) onCloseTimeout();
    }, closeWithinMs);
    closeDeadline.unref?.();
  }, forceAfterMs);
  forceKill.unref?.();

  child.once("close", () => {
    closed = true;
    if (closeDeadline) clearTimeout(closeDeadline);
    // A group member that ignored SIGTERM keeps the SIGKILL fallback armed.
    if (!treeAlive()) clearTimeout(forceKill);
  });
  const onExit = () => {
    if (!treeAlive()) releaseStdio();
  };
  if (exited()) onExit();
  else child.once("exit", onExit);

  terminateCliTree(child, "SIGTERM", treeDeps);
}
