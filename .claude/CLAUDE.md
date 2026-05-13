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
