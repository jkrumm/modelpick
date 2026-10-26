import { describe, it, expect, vi } from "vitest";
import {
  commitSnapshot,
  EPOCH_SNAPSHOT_PATH,
  SNAPSHOT_COMMIT_MESSAGE,
  STACK_COMMIT_MESSAGE,
  STACK_SNAPSHOT_PATH,
} from "../server/snapshot-commit.js";
import type { GitResult, SnapshotCommitDeps } from "../server/snapshot-commit.js";

interface Scenario {
  status?: string;
  branch?: string;
  markers?: string[];
  commit?: number;
  push?: number;
  ahead?: string;
}

/** Fake git: answers by subcommand, records every invocation. */
function makeDeps(s: Scenario = {}) {
  const calls: string[][] = [];
  const git = vi.fn(async (args: string[]): Promise<GitResult> => {
    calls.push(args);
    switch (args[0]) {
      case "status":
        return { code: 0, stdout: s.status ?? ` M ${EPOCH_SNAPSHOT_PATH}\n` };
      case "branch":
        return { code: 0, stdout: `${s.branch ?? "master"}\n` };
      case "rev-parse":
        return { code: 0, stdout: "/repo/.git\n" };
      case "commit":
        return { code: s.commit ?? 0, stdout: "" };
      case "rev-list":
        return { code: 0, stdout: `${s.ahead ?? "1"}\n` };
      case "push":
        return { code: s.push ?? 0, stdout: "" };
      default:
        throw new Error(`unexpected git ${args.join(" ")}`);
    }
  });
  const deps: SnapshotCommitDeps = {
    git,
    exists: (p) => (s.markers ?? []).some((m) => p === `/repo/.git/${m}`),
  };
  return { deps, calls };
}

const subcommands = (calls: string[][]) => calls.map((c) => c[0]);

describe("commitSnapshot", () => {
  it("commits but does not push when other local commits are unpushed", async () => {
    const { deps, calls } = makeDeps({ ahead: "3" });
    expect(await commitSnapshot(deps)).toBe("push-skipped");
    expect(subcommands(calls)).toContain("commit");
    expect(subcommands(calls)).not.toContain("push");
  });

  it("commits only the snapshot path and pushes master when it changed", async () => {
    const { deps, calls } = makeDeps();
    expect(await commitSnapshot(deps)).toBe("pushed");
    expect(calls).toContainEqual([
      "commit",
      "--only",
      "-m",
      SNAPSHOT_COMMIT_MESSAGE,
      "--",
      EPOCH_SNAPSHOT_PATH,
    ]);
    expect(calls.at(-1)).toEqual(["push", "origin", "master"]);
    expect(calls.flat()).not.toContain("add");
  });

  it("commits STACK.md as its own sibling commit under the same guards", async () => {
    const { deps, calls } = makeDeps({ status: ` M ${STACK_SNAPSHOT_PATH}\n` });
    expect(await commitSnapshot(deps, STACK_SNAPSHOT_PATH, STACK_COMMIT_MESSAGE)).toBe("pushed");
    expect(calls).toContainEqual([
      "commit",
      "--only",
      "-m",
      STACK_COMMIT_MESSAGE,
      "--",
      STACK_SNAPSHOT_PATH,
    ]);
  });

  it("does nothing when the file is unchanged", async () => {
    const { deps, calls } = makeDeps({ status: "" });
    expect(await commitSnapshot(deps)).toBe("unchanged");
    expect(subcommands(calls)).toEqual(["status"]);
  });

  it("skips off master", async () => {
    const { deps, calls } = makeDeps({ branch: "feature" });
    expect(await commitSnapshot(deps)).toBe("wrong-branch");
    expect(subcommands(calls)).not.toContain("commit");
  });

  it.each(["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"])(
    "skips while %s exists",
    async (marker) => {
      const { deps, calls } = makeDeps({ markers: [marker] });
      expect(await commitSnapshot(deps)).toBe("operation-in-progress");
      expect(subcommands(calls)).not.toContain("commit");
    },
  );

  it.each([`M  ${EPOCH_SNAPSHOT_PATH}`, `MM ${EPOCH_SNAPSHOT_PATH}`, `A  ${EPOCH_SNAPSHOT_PATH}`])(
    "skips when the path has staged changes (%s)",
    async (status) => {
      const { deps, calls } = makeDeps({ status });
      expect(await commitSnapshot(deps)).toBe("staged-by-other");
      expect(subcommands(calls)).not.toContain("commit");
    },
  );

  it("logs a failed push without throwing and keeps the local commit", async () => {
    const { deps, calls } = makeDeps({ push: 128 });
    expect(await commitSnapshot(deps)).toBe("push-failed");
    expect(subcommands(calls)).toContain("commit");
  });

  it("does not push when the commit fails", async () => {
    const { deps, calls } = makeDeps({ commit: 1 });
    expect(await commitSnapshot(deps)).toBe("commit-failed");
    expect(subcommands(calls)).not.toContain("push");
  });

  it("never throws when git itself blows up", async () => {
    const deps: SnapshotCommitDeps = {
      git: async () => {
        throw new Error("spawn git ENOENT");
      },
      exists: () => false,
    };
    expect(await commitSnapshot(deps)).toBe("error");
  });
});
