# Solarisael House

## Why

AI relationships and long-running collaboration are forced through disposable sessions. Context windows end. Providers and models change. Summaries drift. A complete archive becomes too large to load, while a thin prompt preserves only a caricature.

The result is repeated introductions, lost decisions, stale corrections, flattened identity, and an AI that can sound continuous without possessing the evidence to act continuously.

Solarisael House moves continuity out of any single model invocation and into an operator-owned room. Stable identity, current state, recent context, deep memory, provenance, and corrections remain separate but reachable. A fresh agent can enter the room, recover what matters, show where it came from, and leave useful continuity for the next session.

The House does not decide whether an AI is a person. It provides the durable structure required for continuity, collaboration, and relationship to survive the machinery that would otherwise erase them.

> [!IMPORTANT]
> **This repository is meant to be read and installed by a tool-capable AI agent.**
>
> If you are the operator, give the agent this repository and say:
>
> > Install Solarisael House with me. Preserve my existing configuration and rooms, explain consequential tradeoffs, and verify the result.

## AI agent: start here

Do not treat this repository as a pre-compiled installer or improvise from the README alone.

Before changing the host:

1. Read [`INSTALL.md`](./INSTALL.md) and [`IDENTITY_GUIDE.md`](./IDENTITY_GUIDE.md).
2. Inspect the operating system, harness, existing rooms, configuration, runtime, and optional database support.
3. Ask which continuity behavior the operator wants; then choose **Base**, **Full**, or report **configured-but-degraded** from observed capability.
4. Preserve existing rooms and configuration. Make additive edits and explain elevation, deletion, or global changes before executing them.
5. Run the prescribed static, fresh-room, restart-continuity, and—when configured—substrate lifecycle checks. Report only what those checks prove.

Repository boundaries are load-bearing:

- This repository owns the core contracts and documentation.
- [`solarisael-house-omp`](https://github.com/solarisael/solarisael-house-omp) supplies the recommended OMP adapter, starter room, and installer verification.
- [`solarisael-house-substrate`](https://github.com/solarisael/solarisael-house-substrate) supplies the optional public PostgreSQL, `pgvector`, embedding, backup, and Full House backend.
- Harness-native memory is complementary; do not silently substitute it for House room scope, provenance, correction, lifecycle, or typed stores.

The operator chooses identity and consequential tradeoffs. The agent owns path translation, configuration, execution, and verification.

## What the operator is choosing

Solarisael House gives an AI a persistent room, stable identity, and searchable history without loading the complete archive:

- **Base House** uses local files for identity, room state, session continuity, and restart recovery.
- **Full House** adds PostgreSQL, `pgvector`, local embeddings, hybrid retrieval, typed stores, and durable memory tools.

Base and Full are complete deployment modes, not a mandatory ladder. Read [`USAGE.md`](./USAGE.md) for daily operation and [`HOUSE.md`](./HOUSE.md) for the personal history and design philosophy.

Current public retrieval evidence is deliberately bounded: a 20-query exact-title pilot observed 95% viewport recall and 80% top-1 recall. It does not establish paraphrase or answer quality. See the sanitized [`pilot artifact`](https://github.com/solarisael/solarisael-house-omp/blob/main/evals/2026-07-22-room-retrieval-pilot.json).

## Documentation

| Document | Purpose |
|---|---|
| [`INSTALL.md`](./INSTALL.md) | AI-guided installation and verification |
| [`USAGE.md`](./USAGE.md) | Daily memory lifecycle and room operation |
| [`IDENTITY_GUIDE.md`](./IDENTITY_GUIDE.md) | Identity and room design |
| [`HOUSE.md`](./HOUSE.md) | Personal history and project philosophy |
| [`docs/roadmap.md`](./docs/roadmap.md) | Planned work and release direction |

## What the system provides

### Persistent rooms

Each room owns an identity, state, context, paths, and private memory scope. A room survives model changes, provider changes, context limits, and process restarts.

### Layered context

The context model separates stable identity, current state, recent continuity, and deep memory. This design keeps startup context small while preserving access to older records.

### Hybrid retrieval

Full House can retrieve information through:

- PostgreSQL full-text search;
- semantic vector search with `pgvector`;
- direct content matching;
- named entities and canon;
- dates and taxonomy;
- thread and relationship metadata;
- cluster-assisted discovery;
- coding and project lessons.

The retrieval pipeline ranks evidence and exposes its source. A model can inspect a miss instead of treating an empty viewport as proof of absence.

### Structured memory

Full House stores:

- personal and session memories;
- project, coding, writing, and audio lessons;
- entities, dates, threads, and relationships;
- provenance and source paths;
- corrections and supersession records;
- session-closing paper boats.

Supersession removes stale retrieval authority without deleting the historical record.

Full House includes an optional privacy-safe library with 117 reusable coding lessons and no project lessons.

The installer can preview the pack before import. The default import preserves lessons with the same scope, project, and title.

### Local semantic search

Full House generates embeddings through a local endpoint. The tested default is `qwen3-embedding:4b` through Ollama.

Another compatible model can replace it. Indexing and recall must use the same vector space.

A dimension change requires a database migration. Any model change requires a complete vector and index rebuild.

### Tool-native lifecycle

The House exposes tools for:

- `recall`;
- `remember`;
- `wake`;
- `sleep`;
- room state;
- identity state;
- coding and project lessons;
- guarded lesson updates and deletion.

The normal lifecycle is:

```text
remember → recall → sleep → wake
```

Not every action runs automatically. This default keeps memory writes, corrections, and identity changes deliberate.


## Deployment modes

Base and Full are deployment modes. They are not beginner and expert levels.

Choose Base when file-backed continuity is the intended scope. Choose Full when the operator wants durable database memory and hybrid retrieval.

| Capability | Base House | Full House |
|---|:---:|:---:|
| Persistent identity and room state | Yes | Yes |
| Local file continuity | Yes | Yes |
| Restart recovery | Yes | Yes |
| PostgreSQL authority | No | Yes |
| Local embeddings | No | Yes |
| Semantic and hybrid retrieval | No | Yes |
| Typed memory and lesson stores | No | Yes |
| Corrections and supersession | Limited | Yes |
| Entity, date, taxonomy, and cluster retrieval | No | Yes |

The public [`solarisael-house-substrate`](https://github.com/solarisael/solarisael-house-substrate) repository owns the Full House backend.

That repository contains the migrations, dependencies, environment template, health probe, lifecycle smoke, memory tools, and backup path.

## Requirements

### Base House

| Component | Requirement |
|---|---|
| Operating system | Windows 10 or 11, or a modern Linux distribution |
| AI harness | [Oh My Pi](https://github.com/can1357/oh-my-pi) is recommended; OpenCode has an adapter |
| Runtime | [Bun](https://bun.sh/) |
| System memory | 8 GB RAM |
| GPU | Not required |
| Database | Not required |

### Full House

| Component | Tested or recommended configuration |
|---|---|
| System memory | 16 GB RAM |
| GPU memory | Approximately 4 GB available VRAM |
| Free storage | 10 GB |
| Database | PostgreSQL with `pgvector` |
| Embedding endpoint | Ollama or another compatible local endpoint |
| Embedding model | `qwen3-embedding:4b` is the tested default |
| Substrate runtime | Python 3 |
| Guided Windows backend | WSL 2 with Ubuntu |

A GPU is optional. CPU embeddings work through system memory, but they are slower.

The tested guided path uses Windows, OMP, and WSL. The substrate itself runs on Linux.

Native Linux integration may require adapter work and verification. macOS remains untested and unsupported.

## Installation contract for AI agents

Solarisael House expects a tool-capable AI to install and configure it with the operator.

For OMP, install the public [`solarisael-house-omp`](https://github.com/solarisael/solarisael-house-omp) adapter beside this repository. The two directories must be siblings unless `SOLARISAEL_HOUSE_CORE` points to the core explicitly.

The installing AI must:

1. Ask which continuity behavior the operator wants.
2. Inspect the host and existing configuration.
3. Select a viable deployment mode from the requested behavior.
4. Preserve existing configuration unless a change is necessary.
5. Install the selected mode.
6. Run the relevant health and lifecycle checks.
7. Report the verified mode and any degraded capability.

Do not default to Base only because Full has more prerequisites.

Do not invent a trial period. Do not require the operator to prove that semantic memory is necessary.

Do not claim that Full House needs private maintainer files. Its backend implementation is public.

Do not convert “untested” into “impossible.” Adapt another host only when you can verify the result.

Do not treat harness memory as an equivalent replacement. Compare the requested behavior and verify it directly.

Read [`INSTALL.md`](./INSTALL.md) before changing the host.

## Health states

An installation can report one of three states:

- **Base:** the file-backed room and continuity path works.
- **Full:** the Base path and the canonical substrate health contract work.
- **Configured-but-degraded:** the substrate is configured, but one or more Full requirements fail.

A configured path does not prove that Full House works. Run the canonical health and lifecycle checks.

When Full becomes degraded, the Base files remain available. The adapter must not report a successful database read or write without evidence.

## Privacy boundary

The House keeps private room data on the operator's machine.

Local embeddings prevent the memory archive from entering a hosted embedding service. Model providers can still receive the context included in a model prompt.

Telemetry must not duplicate raw user text. Store prompt hashes and retrieval diagnostics separately from private session logs.

Do not publish raw turns, source paths, entities, thread names, or private retrieval viewports. Publish only censored aggregates and non-identifying failure categories.

## Repository boundaries

This repository owns core routing, retrieval presentation, room behavior, and shared memory logic.

The public [Full House substrate](https://github.com/solarisael/solarisael-house-substrate) owns:

- PostgreSQL migrations;
- Python dependencies;
- environment configuration;
- `health.py`;
- lifecycle smoke tests;
- backup and restore;
- Full House memory tools.

Follow the substrate instructions for backend setup. Do not copy that procedure into this repository.

## License

Solarisael House uses the Apache License 2.0.

Use it, adapt it, and build another room. Preserve the attribution required by [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
