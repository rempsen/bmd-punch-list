// Checks the built takeoff workspace before it is committed: nothing too large for the host to serve,
// and every asset addressed under /takeoff/ so it is found when served from the BMD site.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_BYTES = 24 * 1024 * 1024;

/** @param {{path: string, bytes: number}[]} files @param {string} indexHtml @returns {string[]} problems; empty when the build is fine */
export function checkBuild(files, indexHtml) {
  const problems = [];
  for (const f of files) if (f.bytes > MAX_BYTES) problems.push(`${f.path} is ${(f.bytes / 1048576).toFixed(1)} MB; the host serves files up to 25 MB, and the limit here is 24 MB.`);
  const refs = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => u.startsWith("/") && !u.startsWith("//"));
  if (!/<script[^>]+src=/.test(indexHtml)) problems.push("index.html has no entry script; the build did not produce a workspace.");
  for (const u of refs) if (!u.startsWith("/takeoff/")) problems.push(`${u} is not under /takeoff/; the build's base path is wrong.`);
  return problems;
}

function walk(dir, root = dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    const s = statSync(p);
    return s.isDirectory() ? walk(p, root) : [{ path: relative(root, p), bytes: s.size }];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(process.cwd(), "public", "takeoff");
  let problems;
  try {
    problems = checkBuild(walk(out), readFileSync(join(out, "index.html"), "utf8"));
  } catch (e) {
    problems = [`The takeoff workspace has not been built (${e.message}). Run: bun run build:takeoff`];
  }
  for (const p of problems) console.error(p);
  process.exit(problems.length ? 1 : 0);
}
