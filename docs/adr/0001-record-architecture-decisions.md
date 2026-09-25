# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

VALT combines a Python AI backend (FastAPI, LangChain, LangGraph, CrewAI) with a TypeScript
frontend (Next.js, TanStack, shadcn/ui, Tailwind). Several of these tools overlap — LangGraph and
CrewAI both orchestrate agents; server components and TanStack Query both fetch data — so "why is it
done this way?" will come up often. The repo already keeps product and plan documents on disk
(`docs/product/`, `docs/plans/`); architectural rationale has no home yet.

## Decision

We will record significant architectural decisions as ADRs in `docs/adr/`, numbered sequentially,
using the template in `docs/adr/template.md`.

A decision is "significant" if it is hard to reverse, affects more than one app, adds a framework or
infrastructure dependency, or settles a question the team has argued about.

Accepted ADRs are not edited in substance. A changed decision gets a new ADR that supersedes the old
one, and the old one's status is updated to point at it.

## Alternatives considered

- **Wiki / external docs** — drifts from the code and is not reviewed in PRs.
- **Rationale in PR descriptions only** — not discoverable once merged.

## Consequences

### Positive

- Rationale is versioned with the code and reviewed like code.
- `tech-plan` output (`docs/plans/`) can cite ADRs instead of re-arguing choices.

### Negative / risks

- Small ongoing cost: new dependencies and structural changes need an ADR in the same PR.
