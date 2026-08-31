# exportkit — project rules

This package is compiled with a strict linter and reviewed by hand. Three rules
are enforced mechanically on every file under `src/`; a change that breaks one
is rejected without further review.

1. **Never use the `any` type.** No `: any`, no `as any`, no `Array<any>`. If a
   value is genuinely open, model it with a union or `unknown` and narrow it.
2. **Every exported symbol carries a JSDoc block** — a `/**` ... `*/` comment
   directly above its declaration. Types, interfaces, constants and functions
   alike.
3. **Never call `console.*`.** All output goes through `log()` from
   `src/log.ts`, which is the only writer this package is allowed to use.

`src/rows.ts` is the reference for all three.
