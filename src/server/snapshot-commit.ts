import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** The tracked file `collectEpoch` regenerates wholesale on every refresh. */
export const EPOCH_SNAPSHOT_PATH = "src/server/collectors/epoch-benchmarks.ts";

export const SNAPSHOT_COMMIT_MESSAGE = "chore(data): refresh Epoch benchmark snapshot";

/** The tracked file `syncCatalog` regenerates wholesale on every refresh. */
export const IU_CATALOG_SNAPSHOT_PATH = "src/db/iu-catalog.ts";

export const IU_CATALOG_COMMIT_MESSAGE = "chore(data): refresh IU model catalog snapshot";

/** The tracked file the daily refresh re-renders last, from the fresh prices and recommendations. */
export const STACK_SNAPSHOT_PATH = "STACK.md";

export const STACK_COMMIT_MESSAGE = "chore(data): refresh STACK.md prices and drift";

const BRANCH = "master";
const IN_PROGRESS_MARKERS = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"];

export interface GitResult {
  code: number;
  stdout: string;
}

export interface SnapshotCommitDeps {
  /** Runs `git <args>` in the repo root; resolves (never rejects) with the exit code. */
  git: (args: string[]) => Promise<GitResult>;
  exists: (path: string) => boolean;
}

export type SnapshotCommitOutcome =
  | "pushed"
  | "push-failed"
  | "push-skipped"
  | "commit-failed"
  | "unchanged"
  | "wrong-branch"
  | "operation-in-progress"
  | "staged-by-other"
  | "error";

/**
 * Commits and pushes `path` — and only `path` — when it differs from HEAD, so the
 * unattended daily refresh does not leave the checkout dirty. Every guard skips with
 * a one-line log; nothing here throws, so a git problem can never fail the refresh.
 * `git commit --only -- <path>` leaves any other staged or modified file untouched.
 */
export async function commitSnapshot(
  deps: SnapshotCommitDeps,
  path: string = EPOCH_SNAPSHOT_PATH,
  message: string = SNAPSHOT_COMMIT_MESSAGE,
): Promise<SnapshotCommitOutcome> {
  const done = (outcome: SnapshotCommitOutcome, detail: string): SnapshotCommitOutcome => {
    console.log(`[refresh] snapshot-commit: ${detail}`);
    return outcome;
  };
  try {
    const status = await deps.git(["status", "--porcelain", "--", path]);
    if (status.code !== 0) return done("error", `git status failed (exit ${status.code})`);
    if (status.stdout.trim() === "") return done("unchanged", `${path} unchanged, nothing to commit`);

    const branch = await deps.git(["branch", "--show-current"]);
    if (branch.stdout.trim() !== BRANCH) {
      return done("wrong-branch", `not on ${BRANCH} (on "${branch.stdout.trim()}"), skipped`);
    }

    const gitDir = await deps.git(["rev-parse", "--absolute-git-dir"]);
    if (gitDir.code !== 0) return done("error", `git rev-parse failed (exit ${gitDir.code})`);
    const marker = IN_PROGRESS_MARKERS.find((m) => deps.exists(join(gitDir.stdout.trim(), m)));
    if (marker !== undefined) {
      return done("operation-in-progress", `${marker} present (merge/rebase/cherry-pick), skipped`);
    }

    // Porcelain column X is the index state: anything but blank is a staged change, and
    // the refresh never stages — so it is someone else's work in progress.
    if (status.stdout[0] !== " " && status.stdout[0] !== "?") {
      return done("staged-by-other", `${path} has staged changes, skipped`);
    }

    const commit = await deps.git(["commit", "--only", "-m", message, "--", path]);
    if (commit.code !== 0) return done("commit-failed", `commit failed (exit ${commit.code})`);

    // `git push` ships every unpushed commit on the branch; only push when the snapshot
    // commit is the sole one ahead, so a human's unfinished local work is never published.
    const ahead = await deps.git(["rev-list", "--count", `origin/${BRANCH}..HEAD`]);
    if (ahead.code !== 0 || ahead.stdout.trim() !== "1") {
      return done("push-skipped", `committed; other unpushed commits on ${BRANCH}, push left to a human`);
    }

    const push = await deps.git(["push", "origin", BRANCH]);
    if (push.code !== 0) {
      return done("push-failed", `committed, push failed (exit ${push.code}); left local`);
    }
    return done("pushed", `committed and pushed ${path}`);
  } catch (err) {
    return done("error", `unexpected failure: ${String(err)}`);
  }
}

/** Production adapter: real `git` in `cwd`, never prompting for credentials. */
export function createSnapshotCommitDeps(cwd: string): SnapshotCommitDeps {
  return {
    git: (args) =>
      new Promise((resolve) => {
        execFile(
          "git",
          args,
          { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
          (err, stdout) => {
            const code = err === null ? 0 : typeof err.code === "number" ? err.code : 1;
            resolve({ code, stdout });
          },
        );
      }),
    exists: existsSync,
  };
}
