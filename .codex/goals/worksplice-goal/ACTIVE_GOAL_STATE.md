---
status: active
owner_mode: goal
objective: "Improve this project through bounded, verified goal segments."
updated_at: 2026-08-17T20:31:39+08:00
adapter_id: worksplice-goal
---

# Active Goal State

## Objective

Improve this project through bounded, verified goal segments.

## Authority Sources

- No explicit goal document was provided during bootstrap.

## Operating Contract

- Treat this file as the durable goal state for future agent ticks.
- Treat the authority sources above as the first context to inspect before acting.
- Read current project evidence before choosing the next action.
- Run a bounded progress segment when useful; it does not have to be one tiny step.
- Keep private evidence, credentials, local paths, and raw logs out of public commits.
- End each tick with changed files, validation, residual risk, and the next action.

## Execution Profile

- `cadence=bounded_progress_segment minimum=multi_surface_or_implementation include=coherent_artifact,targeted_validation,state_writeback spend_rule=spend_only_after_artifact_validation_writeback small_streak_threshold=2`
- Repeated small-scale follow-through should expand the next delivery batch or report a blocker before spending quota.

## Non-Goals

- Do not perform irreversible production operations without explicit approval.
- Do not publish private project evidence.
- Do not optimize for activity if no useful artifact or decision can be produced.

## Onboarding Control

- Fast repository scan: `enabled`.
- Scan read file bodies: `False`.
- Git repo detected: `True`.
- Local change count from `git status --short`: `3`.
- Recent commits sampled: `5`.
- Project signal files: `README.md, AGENTS.md, package.json`.
- Validation signal files: `package.json`.
- Candidate agent todos: `requires user selection before delivery work`.
- Autonomous advancement: `requires an explicit user yes/no choice`.
- Codex App heartbeat: `requires explicit heartbeat=yes/no before a recurring Codex App automation is installed`.

## Proposed Onboarding Candidates

1. [P1] Inspect current uncommitted changes (M AGENTS.md, ?? .agent-teams/, ?? .scratch/architecture-improvements/) and decide what belongs in the first LoopX segment before editing.
   - reason: The repo already has local changes, so the first safe step is ownership and scope classification.
   - metadata: `advancement_task:repo_status_review`
2. [P1] Summarize the last 5 commits and extract the safest next bounded project follow-up.
   - reason: Recent commits are a fast signal of current project direction without reading private bodies.
   - metadata: `advancement_task:commit_summary`
3. [P1] Identify the fastest validation command from package.json and record whether it is safe to run now.
   - reason: Validation entrypoints are visible from top-level project metadata.
   - metadata: `advancement_task:validation_plan`
4. [P2] Build a compact read-only project map from README.md, AGENTS.md, package.json and note authority sources, risks, and first useful handoff.
   - reason: Top-level project files can seed a useful map before any implementation work.
   - metadata: `advancement_task:read_only_map`


## User Todo / Owner Review Reading Queue

- [ ] [P1] Choose which proposed onboarding agent todos to accept and whether Codex may start autonomous advancement and whether to enable the Codex App heartbeat; reply with accepted numbers plus autonomous=yes/no plus heartbeat=yes/no.
  <!-- loopx:todo todo_id=todo_ff948e17985e status=open task_class=user_gate action_kind=onboarding_decision updated_at=2026-08-17T20:31:39%2B08:00 -->

## Agent Todo

- [ ] [P1] Present the onboarding scan and ask which candidate agent todos to accept, whether autonomous advancement may start, whether to enable the Codex App heartbeat before delivery work. If heartbeat=yes, create or update the Codex App heartbeat from an identity-scoped `loopx heartbeat-prompt --thin` task body before claiming recurring automation is active.
  <!-- loopx:todo todo_id=todo_cefd5ac318f0 status=open task_class=advancement_task action_kind=onboarding_todo_review updated_at=2026-08-17T20:31:39%2B08:00 -->

## Next Action

- Ask the user which proposed onboarding agent todos to accept, whether Codex may start autonomous advancement, whether to enable the Codex App heartbeat, then write accepted choices and refresh state before delivery work. If heartbeat=yes, create or update the recurring automation from an identity-scoped `loopx heartbeat-prompt --thin` task body. If autonomous=yes, run the quota guard and execute the first accepted onboarding agent todo.

## Recent User Feedback

- Initialized by `loopx bootstrap`.

## Progress Ledger

- Created the initial goal state and registry connection.
