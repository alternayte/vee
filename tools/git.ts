// SPDX-License-Identifier: AGPL-3.0-or-later
// File lists for the repo checks. Untracked files count, so a check fails
// before the file is committed.

function git(args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

const split = (out: string) => out.split("\u0000").filter((p) => p !== "");

/** Tracked files plus untracked files that are not ignored. Deleted files are left out. */
export function listFiles(): string[] {
  const all = split(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
  const deleted = new Set(split(git(["ls-files", "-z", "--deleted"])));
  return [...new Set(all)].filter((p) => !deleted.has(p));
}

export function stagedFiles(): string[] {
  return split(git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]));
}

export function readStaged(path: string): string {
  return git(["show", `:${path}`]);
}
