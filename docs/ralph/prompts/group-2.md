# Group 2: Strictness baseline

## What You're Doing

Land TypeScript strictness + the real linter + formatter **now**, before meaningful code accumulates,
so errors are caught as code is written rather than in a final cascade. Fix any violations this surfaces
in the Group 1 scaffold. Small, focused group.

## Research & Exploration First

1. Read the current `tsconfig.json` and lint setup from Group 1.
2. Check `~/SourceRoot/argo` and `~/.claude/rules/typescript.md` + `~/.claude/rules/code-style.md` for
   the strictness bar and lint conventions used across the user's projects.
3. Decide oxlint vs eslint — match Argo if reasonable; oxlint is fast and the user uses it elsewhere.

## What to Implement

1. **tsconfig**: `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
   `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`. No `any`
   without a justifying comment.
2. **Linter**: real config replacing the Group 1 placeholder; `bun run lint` runs it.
3. **Formatter**: prettier (or biome) config; a `format` script. Keep it consistent with Argo.
4. **Optional**: lefthook pre-commit running lint+typecheck (only if it won't block the autonomous loop;
   the runner already validates — skip if risky).
5. **Fix the cascade**: resolve every typecheck/lint error the new rules surface in existing files.

## Validation

```bash
bun run typecheck   # clean under the new strict flags
bun run lint        # clean under the real linter
bun run test
```

## Commit

```
chore(strictness): strict TS flags + lint + format baseline
```

## Done

Append notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 2
```
