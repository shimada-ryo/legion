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
