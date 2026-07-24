# Solarisael House Boundaries

This document records current support boundaries and non-goals. The product README states what House does; this document tells operators where adaptation or additional engineering is still required.

## Supported installation path

The guided public installation currently supports:

- Windows 10 or 11;
- OMP;
- Bun;
- Base House room files and adapter runtime.

Full House on the guided Windows path additionally uses:

- WSL 2 with Ubuntu;
- PostgreSQL with pgvector;
- Python 3;
- a compatible local embedding endpoint;
- approximately 10 GB of free storage for the tested setup.

The tested embedding default is Nemotron-3-Embed-1B through WSL ROCm Ollama on compatible AMD hardware.

## Other hosts

| Host | Current state |
|---|---|
| Windows + OMP + Base | Supported guided path |
| Windows + OMP + WSL Full House | Public setup split between the OMP and substrate repositories |
| Native Linux | Substrate-compatible; adapter path requires host-specific adaptation and verification |
| OpenCode | Adapter exists with automated coverage; the OMP installer does not configure or verify it |
| macOS | Unsupported by the guided installation |
| Other harnesses | Require an adapter over the core contracts |

An adapted path becomes trustworthy when it proves the same observable contracts: adapter loading, room discovery, `room_state`, fresh-session continuity, and—when Full House is selected—a real substrate write/read lifecycle.

## Installation boundary

Version 0.8 uses an AI-guided developer-shaped setup. The operator still needs a working harness and its authentication before the AI can take over. The 1.0 milestone adds a trusted native bootstrapper, ordinary-user onboarding, upgrades, uninstall behavior, backup, and recovery.

The current installer does not promise one-click setup on an otherwise empty machine.

## Retrieval boundary

House retrieves bounded evidence; it does not load an entire archive into every prompt.

Automatic retrieval is intentionally narrower than explicit `recall`. Low-information turns may retrieve nothing. Explicit recall remains available for deliberate archive investigation.

Semantic proximity is a candidate signal, not factual authority. Important answers should follow the cited source and its authority state. Imported corporate or project documents require an explicit source-precedence policy.

Retrieval is fail-open for conversation continuity. If PostgreSQL or embeddings are unavailable, the adapter keeps lighter room continuity usable and reports the degraded source rather than blocking the turn.

## Memory boundary

House is not indiscriminate transcript storage. Durable memory remains deliberate by default.

- Events and realizations belong in memories.
- Transferable engineering rules belong in coding lessons.
- Project-bound rules belong in project lessons.
- Current state can supersede older current state.
- Narrative history remains recoverable.
- Secrets belong in a secret manager, never memory.

House can preserve a wrong interpretation if an operator or agent deliberately records it. Correction and supersession make the trail repairable; they do not eliminate the need for judgment.

## Identity boundary

House preserves and loads an identity contract. It does not prove metaphysical identity, consciousness, or equivalence between different model providers.

A room can keep names, voice, commitments, corrections, and shared history available across model changes. Different models may still express the same contract with different capability, style, or reliability.

Identity prose is co-authored. The installer does not manufacture intimacy, relationship claims, or a personality on the operator's behalf.

## Provider boundary

A local House does not make the model provider local. Any context sent to a hosted model can be processed under that provider's terms.

Local embeddings keep archive vectorization off a hosted embedding service. They do not prevent selected memory context from reaching the active model provider.

House keeps continuity provider-portable, but it cannot remove provider-side rate limits, model policies, outages, or capability differences.

## Organizational boundary

The current room model is not yet a complete enterprise authorization system.

A central multi-user deployment requires:

- tenant, team, project, and private-user scopes;
- authorization filtering before relevance ranking;
- source provenance and versioning;
- retention and deletion policy;
- auditability;
- administrative controls;
- tested connectors for corporate sources.

Do not place an entire company's private corpus behind shared retrieval until those controls exist and have been verified.

## Non-goals

House does not replace:

- Git for source-code history, branches, review, and merges;
- a secret manager for credentials;
- object storage for large binary artifacts;
- human judgment over consequential memories and lessons;
- the AI harness that executes models and tools;
- specialized knowledge interfaces such as Obsidian.

House coordinates continuity and retrieval across those systems.

## Planned boundary changes

The release path is maintained in [`roadmap.md`](./roadmap.md). Planned work is not mixed into the current capability list in the root README.
