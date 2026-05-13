# legion

A coding agent control plane for individual developers. Orchestrate multiple coding agents (Claude Code, Codex, Gemini, ...) as a coordinated team to deliver software at the productivity of a full engineering organization.

## Status

Phase 0 (scaffolding). The project is in early design and bootstrap.

## Concept

legion treats every coding agent as a long-running teammate with a role (Director, Implementer, Reviewer, Tester, Knowledge Keeper, ...). Agents communicate through a Blackboard substrate for both local (same machine) and remote (across machines) coordination. A Web UI exposes a two-layer view:

- **Layer 1 (Topology)**: the team's organization chart, edited as YAML and visualized in the editor.
- **Layer 2 (Execution)**: live agent instances overlaid on Layer 1.

See the design decisions in [docs/dev/minutes/](docs/dev/minutes/) for details.

## Documentation

- [Initial brainstorming (2026-05-13)](docs/dev/minutes/2026-05-13_initial_brainstorming.md) — design decisions D-001 through D-020.
- [Coding agent control plane research (2026-05-13)](docs/dev/coding_agent_control_plane_research_2026-05-13.md) — market and technology survey.

## Repository layout

```
packages/
  core/         types, data model, blackboard interface
  runtime/      worktree manager, agent adapters, PTY supervisor
  server/       Bun HTTP/WS server, control API
  web/          React frontend
  cli/          optional CLI for power users
workflows/      workflow template YAMLs
docs/           design docs and meeting minutes
```

## License

Apache-2.0. See [LICENSE](LICENSE).
