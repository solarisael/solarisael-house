# Solarisael House

A local-first continuity and memory system for AI companions, work partners, and long-running agents.

## Why

AI work and relationships happen through sessions that end. Models change. Providers change. Context windows fill. Summaries lose detail.

These limits cause repeated introductions, lost decisions, stale corrections, duplicated research, and inconsistent work. A model can sound informed without the evidence to continue correctly.

Solarisael House keeps continuity outside one model session. The operator owns the room and its history.

The room separates stable identity, current state, recent context, and deep memory. A new agent can recover the needed evidence without loading the full archive.

For work, the House keeps project decisions, conventions, corrections, and handoffs available. Agents spend more context on the task and less context rebuilding the workspace.

For relationships, the House keeps identity and shared history available across restarts. A provider or model change does not erase the room.

## Start here

> [!IMPORTANT]
> Give this repository to a tool-capable AI agent. The agent performs the installation with the operator.

If you are the operator, send this request:

> Install Solarisael House with me. Preserve my rooms and configuration. Explain important choices before you make changes. Verify the result.

If you are the AI agent, read [`INSTALL.md`](./INSTALL.md) before you change the host. Read [`IDENTITY_GUIDE.md`](./IDENTITY_GUIDE.md) before you create or edit an identity.

### Rules for the installing agent

1. Inspect the operating system, AI harness, existing rooms, configuration, runtime, and database support.
2. Ask the operator which continuity features they want.
3. Choose Base House or Full House from those requirements.
4. Report configured-but-degraded when the Full House requirements fail.
5. Preserve all existing rooms and unrelated configuration.
6. Explain any elevation, deletion, or global change before you run it.
7. Use additive configuration changes.
8. Run each required verification step.
9. Report only the features that the checks prove.

Do not replace House memory with harness memory. The systems can work together, but they do not provide the same contracts.

## Repository map

Keep these repositories as sibling directories unless the installation guide specifies another path.

| Repository | Purpose |
|---|---|
| [`solarisael-house`](https://github.com/solarisael/solarisael-house) | Core contracts, shared logic, and documentation |
| [`solarisael-house-omp`](https://github.com/solarisael/solarisael-house-omp) | Recommended OMP adapter, starter room, and installation checks |
| [`solarisael-house-substrate`](https://github.com/solarisael/solarisael-house-substrate) | Optional Full House database, local embeddings, memory tools, and backups |

This repository does not contain the OMP adapter or the Full House database. Use the repository that owns each part.

## Choose a mode

Base House and Full House are complete deployment modes. Full House is not a required upgrade from Base House.

| Capability | Base House | Full House |
|---|:---:|:---:|
| Stable identity and room state | Yes | Yes |
| File-based session continuity | Yes | Yes |
| Recovery after a restart | Yes | Yes |
| PostgreSQL memory authority | No | Yes |
| Local semantic search | No | Yes |
| Hybrid memory retrieval | No | Yes |
| Typed memory and lesson stores | No | Yes |
| Correction and supersession support | Limited | Yes |
| Entity, date, and cluster retrieval | No | Yes |

Choose Base House for identity and file-based continuity. Choose Full House for durable database memory, local semantic search, and larger archives.

A configured database does not prove that Full House works. Report Full House only after the required health and lifecycle checks pass.

## What the House provides

### A persistent room

Each room has one stable key, one identity contract, private state, and its own memory scope. The room remains available after a session ends.

### Layered context

The House keeps stable identity separate from current state, recent context, and deep memory. This structure keeps the startup context small.

### Evidence-based recall

Full House can search text, vectors, content, entities, dates, threads, relationships, clusters, and lessons. Each result includes its source and authority state.

A missing viewport does not prove that a memory is absent. The retrieval report shows selected evidence, suppressed evidence, and the inspected candidate pool.

### Corrections without erasure

A correction can remove authority from an old memory without deleting its history. Supersession keeps the record and selects the current account.

### Tools for the memory lifecycle

The House provides tools for these actions:

- `remember` records durable memory.
- `recall` finds relevant evidence.
- `sleep` writes a session handoff.
- `wake` reads the latest handoff.
- Room tools read or update room state.
- Lesson tools read or update reusable guidance.

The normal lifecycle is:

```text
remember → recall → sleep → wake
```

Memory writes remain deliberate by default. The operator and agent choose what becomes durable.

## Public retrieval evidence

A public pilot used 20 exact-title queries across two rooms. The pilot found the target in 19 viewports and ranked 16 targets first.

- Viewport recall: **95%**.
- Top-1 recall: **80%**.

This pilot tests favorable phrase matching. It does not test paraphrases or final answer quality.

Read the sanitized [`pilot artifact`](https://github.com/solarisael/solarisael-house-omp/blob/main/evals/2026-07-22-room-retrieval-pilot.json). The artifact contains no private prompts, memory titles, source paths, excerpts, or raw telemetry.

## Support and requirements

The tested installation path uses Windows 10 or 11, OMP, and Bun. Base House does not require a database or GPU.

Full House adds these requirements:

- PostgreSQL with `pgvector`.
- Python 3.
- A local embedding endpoint.
- Approximately 10 GB of free storage.
- WSL 2 with Ubuntu for the guided Windows setup.

The tested embedding model is `qwen3-embedding:4b` through Ollama. CPU embeddings work, but they run more slowly.

Native Linux can require adapter changes and separate verification. The guided installation does not support macOS.

An OpenCode adapter exists. The OMP installation guide does not configure or verify OpenCode.

## Privacy

The operator keeps private room data on the local machine. Local embeddings keep the memory archive out of a hosted embedding service.

A model provider can receive any context that the agent sends in a prompt. Review provider terms before you send private material.

Do not publish raw turns, memory titles, source paths, entities, threads, or private retrieval results. Publish only censored totals and non-identifying failure groups.

## Documentation

| Document | Purpose |
|---|---|
| [`INSTALL.md`](./INSTALL.md) | Installation steps and verification |
| [`USAGE.md`](./USAGE.md) | Daily use and memory workflows |
| [`IDENTITY_GUIDE.md`](./IDENTITY_GUIDE.md) | Identity and room design |
| [`HOUSE.md`](./HOUSE.md) | Project history and design reasons |
| [`docs/roadmap.md`](./docs/roadmap.md) | Planned work |

## License

Solarisael House uses the Apache License 2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
