import { versionPayload } from "@/lib/build-identity.mjs";

// The WEB build's own version + channel (NOT the user's data checkout), captured
// by next.config.mjs at build time and inlined by Next. The channel is derived
// from a pre-release suffix (`-rc`/`-beta`) so the UI can show a beta banner + the
// bug reporter can tag the right release. Invisible to stable installs (the
// updater reads VERSION from `main`, which stays stable while the bundle lives on
// a branch).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    versionPayload({
      sha: process.env.CAREER_OPS_BUILD_SHORT_SHA,
      fullSha: process.env.CAREER_OPS_BUILD_SHA,
      coreVersion: process.env.CAREER_OPS_BUILD_VERSION,
      webVersion: process.env.CAREER_OPS_BUILD_WEB_VERSION,
    }),
  );
}
