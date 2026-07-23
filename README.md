# Solarisael House

Solarisael House is a local-first continuity and memory system for AI agents that need to persist across sessions, models, providers, and harnesses.

Sessions end. Models and providers change. Context windows fill. Solarisael House keeps identity, decisions, corrections, important memories, and project history outside any one model session so an agent can return with the evidence needed to continue.

**Status: 0.8.x operational late beta.** House runs daily, carries real rooms, and has external installations. The Rust cutover leads to 0.9; supported ordinary-user installation defines 1.0.

## What House changes

Without durable continuity, every new session spends context reconstructing the past. Summaries flatten detail, stale statements survive corrections, and important decisions disappear into old transcripts.

House gives the operator a persistent room with separate layers for identity, current state, recent context, and deep memory. It retrieves only the evidence relevant to the current turn, preserves where that evidence came from, and keeps changed truths from competing forever with the record they replaced.

For work, House carries project decisions, conventions, lessons, corrections, and handoffs across sessions and harnesses.

For personal continuity, House keeps important memories and shared history available across restarts, model changes, and provider changes. The room belongs to the operator, not to one model endpoint.

## Capabilities

| Capability | Base | Full |
|---|:---:|:---:|
| Persistent rooms and identity contracts | Yes | Yes |
| Restart continuity and room-local context | Yes | Yes |
| Multiple isolated rooms | Yes | Yes |
| Conversation logging and compact handoffs | Yes | Yes |
| PostgreSQL memory authority | — | Yes |
| Hybrid lexical, content, structured, and semantic retrieval | — | Yes |
| Local embeddings through a compatible endpoint | — | Yes |
| Memories, coding lessons, project lessons, writing lessons, and audio lessons | — | Yes |
| Entity, date, thread, taxonomy, relationship, and cluster retrieval | — | Yes |
| Provenance, authority state, and selection reasons | — | Yes |
| Corrections through supersession without historical deletion | Limited | Yes |
| Memory lifecycle tools: `remember`, `recall`, `sleep`, and `wake` | — | Yes |

Base House is a complete file-backed continuity system. Full House adds durable database memory, typed stores, local semantic search, and larger archives.

## Public evidence

The first sanitized public retrieval pilot used 20 exact-title queries across two real rooms:

| Measure | Result |
|---|---:|
| Target present in the retrieval viewport | **19/20 — 95%** |
| Target ranked first | **16/20 — 80%** |

The full method, scope, and next evaluation contracts live in [`EVIDENCE.md`](./docs/EVIDENCE.md). The sanitized artifact is published in the OMP adapter repository: [`2026-07-22-room-retrieval-pilot.json`](https://github.com/solarisael/solarisael-house-omp/blob/main/evals/2026-07-22-room-retrieval-pilot.json).

## Architecture

```text
AI harness
    │
    ▼
harness adapter
    │
    ├── room discovery, lifecycle hooks, tools
    │
    ▼
Solarisael House core
    │
    ├── identity and room contracts
    ├── continuity and retrieval orchestration
    ├── ranking, authority, and worker-routing contracts
    │
    ├──────── Base ──────── room-local files
    │
    └──────── Full ──────── PostgreSQL + pgvector + embeddings
```

The implementation is split by responsibility:

| Repository | Owns |
|---|---|
| [`solarisael-house`](https://github.com/solarisael/solarisael-house) | Core contracts, shared behavior, and canonical documentation |
| [`solarisael-house-omp`](https://github.com/solarisael/solarisael-house-omp) | Recommended OMP adapter, starter room, verifier, and portable distribution |
| [`solarisael-house-substrate`](https://github.com/solarisael/solarisael-house-substrate) | Full House database, migrations, embeddings, memory tools, health, and backups |

Read [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for components, data flow, authority, and extension boundaries.

## Install

The tested path is Windows 10/11 with OMP and Bun. Full House adds the public substrate and its PostgreSQL, pgvector, Python, WSL 2, and embedding requirements.

Give this repository to a tool-capable AI agent with:

> Install Solarisael House with me. Preserve my existing rooms and configuration, explain consequential system changes before making them, and verify the completed installation.

The installing agent follows [`INSTALL.md`](./INSTALL.md). Platform boundaries and current non-goals live in [`LIMITATIONS.md`](./docs/LIMITATIONS.md).

## Daily use

A normal session is simple:

```text
enter the room → work or live together → remember what matters → leave a paper boat
```

- `recall` retrieves older evidence.
- `remember` records durable events, decisions, or lessons.
- `sleep` leaves a compact handoff for the next session.
- `wake` catches the latest handoff.

Read [`USAGE.md`](./USAGE.md) for the everyday workflow.

## Documentation

| Document | Purpose |
|---|---|
| [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Components, contracts, data flow, and repository ownership |
| [`INSTALL.md`](./INSTALL.md) | Supported installation and observable verification |
| [`USAGE.md`](./USAGE.md) | Everyday memory, room, sleep, and wake workflows |
| [`EVIDENCE.md`](./docs/EVIDENCE.md) | Public evaluations, results, methods, and planned proof |
| [`PLANNED_FEATURES.md`](./docs/PLANNED_FEATURES.md) | Plain-language product direction, market value, and feature status |
| [`LIMITATIONS.md`](./docs/LIMITATIONS.md) | Platform boundaries, current constraints, and non-goals |
| [`SECURITY.md`](./docs/SECURITY.md) | Privacy, secrets, permissions, and publication rules |
| [`IDENTITY_GUIDE.md`](./IDENTITY_GUIDE.md) | Co-authoring rooms, identities, and active spirits |
| [`docs/RETRIEVAL.md`](./docs/RETRIEVAL.md) | Recall lanes, authority, automatic retrieval, and corrections |
| [`docs/LESSONS.md`](./docs/LESSONS.md) | Typed lesson stores, fields, scopes, imports, updates, and deletion |
| [`HOUSE.md`](./HOUSE.md) | Project history, philosophy, and design reasons |
| [`docs/roadmap.md`](./docs/roadmap.md) | Release sequence and future product surface |
| [`docs/progress.md`](./docs/progress.md) | Current maintainer implementation state |

## License

Solarisael House uses the Apache License 2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
