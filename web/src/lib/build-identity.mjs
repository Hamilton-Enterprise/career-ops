import { join } from "node:path";

function attempt(read) {
  try {
    return read();
  } catch {
    return "";
  }
}

/**
 * Identity of the web build, computed once by next.config.mjs and inlined by
 * Next through `env`. The running server must never ask git again: the
 * checkout can move to another commit while an older build keeps serving.
 */
export function captureBuildIdentity({ webDir, runGit, readText }) {
  const coreVersion = attempt(() => readText(join(webDir, "..", "VERSION")).split(/\s+/)[0].trim());
  const webVersion = attempt(() => {
    const pkg = JSON.parse(readText(join(webDir, "package.json")));
    return typeof pkg.version === "string" ? pkg.version : "";
  });
  return {
    CAREER_OPS_BUILD_SHA: attempt(() => runGit(["rev-parse", "HEAD"]).trim()),
    CAREER_OPS_BUILD_SHORT_SHA: attempt(() => runGit(["rev-parse", "--short", "HEAD"]).trim()),
    CAREER_OPS_BUILD_VERSION: coreVersion,
    CAREER_OPS_BUILD_WEB_VERSION: webVersion,
  };
}

/** @param {{ sha?: string, fullSha?: string, coreVersion?: string, webVersion?: string }} identity */
export function versionPayload({ sha = "", fullSha = "", coreVersion = "", webVersion = "" }) {
  const m = coreVersion.match(/-(rc|beta|alpha|next)\b/i);
  // Channel precedence: an explicit core pre-release suffix wins (RC installs);
  // otherwise the web component's own maturity decides — pre-1.0 on main IS the
  // alpha (release-please versions web/ independently), and the banner/bug-report
  // stay visible until the web graduates to 1.0.
  const channel = m ? m[1].toLowerCase() : webVersion && /^0\./.test(webVersion) ? "alpha" : "stable";
  const version = webVersion ? `web ${webVersion}` : coreVersion;
  return { version, coreVersion, channel, sha, fullSha };
}
