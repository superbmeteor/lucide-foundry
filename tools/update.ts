/**
 * Moves the Lucide dev dependencies to their next releases on npm and regenerates the libraries.
 *
 *     bun tools/update.ts      # or `bun run update`
 *
 * Each of lucide-static and @lucide/lab moves to its newest stable release in its current major
 * version, or, once it is on the last of those, to the newest release of the next major. Lucide
 * drops old aliases at major versions, so stepping through the last release of each major keeps
 * the renames the ids follow. A run that moves to a new major leaves the next major for a later
 * run.
 *
 * If the version in package.json has already been tagged as a release, its minor version is
 * bumped, since the About components show it. Otherwise this adds to the unreleased version.
 *
 * In GitHub Actions it writes `title` and `body` step outputs for the pull request; with nothing
 * to update it writes neither.
 */
import { $ } from "bun";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGE = join(ROOT, "package.json");
const PACKAGES = ["lucide-static", "@lucide/lab"];

const major = (v: string) => Number(v.split(".")[0]);

/** The release to move to from `current`, or undefined if `current` is the one to stay on. */
export function next(current: string, versions: string[], latest: string): string | undefined {
  const later = versions.filter((v) =>
    !v.includes("-") && Bun.semver.order(v, current) > 0 && Bun.semver.order(v, latest) <= 0);
  if (!later.length) return undefined;
  const step = Math.min(...later.map(major)); // the current major while it has later releases
  return later.filter((v) => major(v) === step).sort(Bun.semver.order).at(-1);
}

async function releases(name: string) {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2f")}`;
  const res = await fetch(url, { headers: { accept: "application/vnd.npm.install-v1+json" } });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const doc = (await res.json()) as { "dist-tags": { latest: string }; versions: Record<string, unknown> };
  return { versions: Object.keys(doc.versions), latest: doc["dist-tags"].latest };
}

async function main() {
  const text = readFileSync(PACKAGE, "utf8");
  const pkg = JSON.parse(text) as { version: string; devDependencies: Record<string, string> };

  const moves: { name: string; from: string; to: string }[] = [];
  for (const name of PACKAGES) {
    const from = pkg.devDependencies[name];
    if (!from) throw new Error(`package.json has no ${name} dev dependency`);
    const { versions, latest } = await releases(name);
    const to = next(from, versions, latest);
    if (to) moves.push({ name, from, to });
  }
  if (!moves.length) {
    console.log(`up to date: ${PACKAGES.map((n) => `${n} ${pkg.devDependencies[n]}`).join(", ")}`);
    return;
  }

  // Bump the version first: the generator writes it into the About components.
  const tag = `v${pkg.version}`;
  const tagged = (await $`git ls-remote --tags origin refs/tags/${tag}`.cwd(ROOT).text()).trim() !== "";
  let version = pkg.version;
  if (tagged) {
    const [x, y] = pkg.version.split(".");
    version = `${x}.${Number(y) + 1}.0`;
    writeFileSync(PACKAGE, text.replace(`"version": "${pkg.version}"`, `"version": "${version}"`));
  }

  for (const m of moves) console.log(`${m.name} ${m.from} -> ${m.to}`);
  await $`bun add --dev --exact ${moves.map((m) => `${m.name}@${m.to}`)}`.cwd(ROOT);
  const generate = await $`bun tools/generate.ts`.cwd(ROOT).nothrow().quiet();
  process.stdout.write(generate.stdout);
  process.stderr.write(generate.stderr);
  if (generate.exitCode !== 0) process.exit(generate.exitCode);

  const title = `Update ${moves.map((m) => `${m.name} to ${m.to}`).join(" and ")}`;
  const body = [
    "Moves the Lucide releases the libraries are generated from:",
    "",
    ...moves.map((m) => `- \`${m.name}\` ${m.from} → ${m.to}${major(m.to) > major(m.from) ? " (new major version)" : ""}`),
    "",
    tagged
      ? `${tag} is tagged, so the version is bumped to ${version}.`
      : `${tag} isn't tagged yet, so this adds to ${version}.`,
    "",
    "What `bun run generate` reported:",
    "",
    "```",
    generate.stdout.toString().trim().slice(0, 50_000),
    "```",
    "",
    "Before merging, update the status line in README.md.",
  ].join("\n");

  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const end = `EOF_${crypto.randomUUID()}`;
    appendFileSync(output, `title=${title}\nbody<<${end}\n${body}\n${end}\n`);
  }
}

if (import.meta.main) await main();
