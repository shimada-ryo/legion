# legion project conventions

## Document language

- Decision-tracking markdown under `docs/dev/specs/`, `docs/dev/minutes/`, and `docs/dev/plans/` is written in **Japanese**. The body of these files records design dialogue and decisions; matching the conversation language keeps nuance intact.
- `docs/dev/handoff/` may be in English (it is read by the next session's agent at boot; English is fine).
- Everything else (source code, comments, commit messages, READMEs, this CLAUDE.md, third-party-facing docs) stays in **English** per the user's global preference.
- Inside Japanese documents, code samples, type definitions, YAML examples, file paths, and identifier names remain in English as written.

## Commit messages

- Write commit messages in English.
- Do NOT include `Co-Authored-By: Claude <...>` trailers. This is a personal project; do not attribute commits to the AI.
- Keep the subject line concise (under 70 chars). Use the body for additional context.

## Line Count Awareness

Pay close attention to line counts at every stage. While drafting an
implementation plan and while writing code, continuously estimate and
count the lines being added or changed, and monitor the total line count
of each class, function, and file. See the Refactoring Policy below for
the upper bounds and what to do when they are exceeded.

## Refactoring Policy

Propose refactoring when:

- A single class exceeds **500 lines**
- A single function exceeds **100 lines**
- A single file exceeds **1000 lines**

When refactoring, always lead with **reasonable separation of concerns**:
each extracted unit must have a clear, independent responsibility that
a developer can articulate without reading its internals. Line-count
reduction is the measurement, not the goal — but aim for splits that
**roughly halve the target file**. Fine-grained decomposition can come
later. Splitting for the sake of splitting is not acceptable.

Keep line count low at all times. Every line must earn its place.
Adding lines is easy; reducing them takes skill.

## Test Policy: Mocks Require Contract Tests

Mocks are permitted, but every mock must be paired with a **contract test**
that verifies the assumption the mock encodes against the real artifact.
Without a contract test, mocks become silent fiction the moment the real
system drifts.

### Mock requirements

Every mock fixture, mock injection, or mock object must have a header
comment with these four fields:

- `representing:` what real artifact and version is being faked
- `verified on:` when and how the contract was last checked
- `invalidated when:` what real-system change would cause divergence
- `contract test:` path to the contract test that verifies this mock

Example:

```ts
// Mock for @openai/codex-sdk Thread.runStreamed
// representing:    @openai/codex-sdk@0.130.x, ThreadEvent stream from runStreamed()
// verified on:     2026-05-14, by docs at developers.openai.com/codex/sdk
// invalidated when: codex-sdk bumps the ThreadEvent union shape or adds new item types
// contract test:   packages/runtime/test/adapter/codex/codex-provider.contract.test.ts
const mockThread = { runStreamed: () => ({ events: stubEvents() }) }
```

### Contract test requirements

A contract test lives in a `*.contract.test.ts` file and:

- Exercises the **real** artifact end-to-end at the boundary the mock covers.
- May be `skipIf`-gated (auth, real binary, env var) when costly. CI is
  absent in legion, so contract tests are typically opt-in (`skipIf` with
  an explicit env flag like `CODEX_INTEGRATION=1`).
- Has a reverse reference in its top-of-file comment back to the mock(s)
  it verifies.

### Gate

All contract tests must be run **before tagging any phase boundary**
(`phase<N>-...-end` tag). SDK / external-dependency version bumps are
also a gate — re-run all relevant contract tests before resuming feature
work that depends on the bumped dependency.

### Why

Mocks tied to nothing real go stale silently. The canonical legion
example is the Phase 2 narrow bug fixed in `c4d043a`: unit tests
passed because the SDK's `query` function was mocked and accepted
any input shape, while the real SDK silently ignored the `tools:`
option that did not exist. Only a real-SDK integration test caught
it — at the cost of one production-class bug almost shipping.

### How to apply

- When introducing a new mock, write the contract test first (a failing
  skeleton is acceptable until the implementation lands).
- When mocks accumulate without a contract test, treat the gap as tech
  debt that blocks the next phase boundary.
- Phase-specific test sections in specs (e.g., `docs/dev/specs/.../§G`)
  should reference this policy rather than restating it.
