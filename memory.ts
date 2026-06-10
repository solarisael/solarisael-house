// Per-turn memory retrieval pipeline. The only feature in this plugin that
// substantially shapes model output. Five streams merged → deduped →
// budget-trimmed → injected as <system-reminder> on the latest user
// message.
//
//   pinned     (state.loaded[*].pinned)
//   important  (named_entities matches via regex word-boundary)
//   sync       (lexical thread ranks, top 3 by score)
//   deferred   (prior turn's prefetch queue, re-scored against this prompt)
//   semantic   (qwen3-embedding:4b cosine over memory_chunks, top 5)
//
// Source: postgres-memory-source.py (psycopg2 + Ollama embed) spawned under
// WSL. JSON-index fallback when the postgres source fails.
//
// Fail-open: any pipeline error returns "" so the hook never blocks
// message processing. Errors ALWAYS get logged (memory/retrieval_debug.log);
// verbose per-turn diagnostics are env-gated on KINTSU_MEM_DEBUG=1. This
// asymmetric gating is the 2026-05-12 lean-rewrite fix — previously every-
// thing went through the env-gated debug logger, which meant errors
// vanished silently when the env var was unset (and it was always unset).

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  HOUSE_MEMORY_DIRNAME,
  MEMORY_CONCEPT_WEIGHT, MEMORY_CONTEXT_WEIGHT,
  MEMORY_CONTENT_DEMOTION_SIM_THRESHOLD,
  MEMORY_CONTENT_MIN_SIM, MEMORY_CONTENT_TOP_K,
  MEMORY_DEBUG_LOG_FILENAME, MEMORY_DEBUG_TOP_CANDIDATES,
  MEMORY_FILE_ONE_LINE_WEIGHT,
  MEMORY_IMPORTANT_INDEX_FILENAME, MEMORY_INDEX_FILENAME,
  MEMORY_MAX_EXCERPT_CHARS, MEMORY_MAX_IMPORTANT_MATCHES,
  MEMORY_MAX_INJECTION_CHARS, MEMORY_MAX_PREFETCH_QUEUE,
  MEMORY_MAX_SYNC_INJECTIONS,
  MEMORY_MIN_PROMPT_LEN, MEMORY_MIN_SCORE_TO_INJECT,
  MEMORY_LEXICAL_DEMOTION_SIM_THRESHOLD,
  MEMORY_POSTGRES_SOURCE_SCRIPT, MEMORY_POSTGRES_TIMEOUT_MS,
  MEMORY_PREFETCH_FILENAME,
  MEMORY_RECENCY_HALF_LIFE_DAYS,
  MEMORY_SEMANTIC_MIN_SIM, MEMORY_SEMANTIC_TOP_K,
  MEMORY_SESSION_REPEAT_PENALTY_BASE,
  MEMORY_STATE_FILENAME, MEMORY_STOPWORDS, MEMORY_TOKEN_RE,
} from "./paths.ts";
import {
  escapeRegExp, latestUserMessage, readJson, windowsPathToWsl, writeJsonFile,
} from "./util.ts";
import { resolveEffectiveRoomDir } from "./spirit.ts";
import { loadState } from "./directives.ts";

// ── debug / error logging ──────────────────────────────────────────────────

async function appendMemoryDebug(roomDir, line) {
  const target = path.join(roomDir, MEMORY_DEBUG_LOG_FILENAME);
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {
    // last resort — don't let the logger itself blow up the pipeline
    console.error("[solarisael-house][memory] log-write failed:", line);
  }
}

async function debugMemoryLog(roomDir, message) {
  if (process.env.KINTSU_MEM_DEBUG !== "1") return;
  await appendMemoryDebug(roomDir, message);
}

async function errorMemoryLog(roomDir, err) {
  // Always — even with KINTSU_MEM_DEBUG unset. Errors should never silently
  // disappear; the May 12 bug-family root cause was exactly this shape.
  await appendMemoryDebug(roomDir, `ERROR ${err?.message || err}\n${err?.stack || ""}`);
}

// ── token tooling ──────────────────────────────────────────────────────────

function tokenizeMemory(text) {
  const tokens = String(text || "").toLowerCase().match(MEMORY_TOKEN_RE) || [];
  return new Set(tokens.filter((token) => token.length > 1 && !MEMORY_STOPWORDS.has(token)));
}

function extractMemoryConcepts(threadKey) {
  const concepts = new Set();
  for (const variant of String(threadKey || "").split("/")) {
    for (const token of tokenizeMemory(variant.trim())) {
      concepts.add(token);
    }
  }
  return concepts;
}

function countTokenOverlap(left, right) {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

// ── thread ranking ─────────────────────────────────────────────────────────

function collectMemoryEntryTokens(entries, filesMap) {
  const contextTokens = new Set();
  const fileTokens = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const token of tokenizeMemory(entry?.context || "")) {
      contextTokens.add(token);
    }
    const fileMeta = filesMap?.[entry?.file || ""];
    if (fileMeta?.one_line) {
      for (const token of tokenizeMemory(fileMeta.one_line)) {
        fileTokens.add(token);
      }
    }
  }
  return { contextTokens, fileTokens };
}

function scoreMemoryThread(promptTokens, threadKey, entries, filesMap) {
  const concepts = extractMemoryConcepts(threadKey);
  const { contextTokens, fileTokens } = collectMemoryEntryTokens(entries, filesMap);
  return (
    countTokenOverlap(concepts, promptTokens) * MEMORY_CONCEPT_WEIGHT
    + countTokenOverlap(contextTokens, promptTokens) * MEMORY_CONTEXT_WEIGHT
    + countTokenOverlap(fileTokens, promptTokens) * MEMORY_FILE_ONE_LINE_WEIGHT
  );
}

function sessionRepeatCountForThread(state, threadKey, entries = []) {
  const hits = state?.session_memory_hits || {};
  const counts = [hits[`thread:${threadKey}`] || 0];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.file) counts.push(hits[`file:${entry.file}`] || 0);
  }
  return Math.max(0, ...counts.map((value) => Number(value) || 0));
}

function memorySessionRepeatPenalty(repeatCount) {
  return Math.pow(MEMORY_SESSION_REPEAT_PENALTY_BASE, Math.max(0, Number(repeatCount) || 0));
}

// ── recency decay (audit ticket #2) ────────────────────────────────────────
// Threads inherit a recency penalty from their files' `last_touched_at`.
// Touch-based: a thread that's been retrieved every turn keeps `last_touched_at`
// fresh and gets no decay; a thread quietly sitting on disk for weeks
// gets exponentially demoted. Canon-touching files are exempt entirely —
// they're already surfaced via the canon-assertion overlay (#5) and
// decaying them doubly is wrong.
//
// When `state.loaded[file].last_touched_at` is missing (file hasn't been
// retrieved yet in this state's history), fall back to a date parsed
// from the filename (`YYYY-MM-DD_*.md` convention); if no date, return
// no decay (give brand-new content a fair first-shot at the score).

function buildCanonicalFileSet(importantIndex) {
  const files = new Set();
  for (const entry of Object.values(importantIndex || {})) {
    for (const fileRef of Array.isArray(entry?.files) ? entry.files : []) {
      if (fileRef?.file) files.add(fileRef.file);
    }
  }
  return files;
}

const DATE_IN_FILENAME_RE = /(\d{4}-\d{2}-\d{2})/;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function resolveLastTouchedAtMs(filePath, loadedEntry) {
  if (loadedEntry?.last_touched_at) {
    const parsed = Date.parse(loadedEntry.last_touched_at);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const match = String(filePath || "").match(DATE_IN_FILENAME_RE);
  if (match) {
    const parsed = Date.parse(match[1]);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function computeThreadRecencyPenalty(entries, state, canonicalFiles) {
  if (!Array.isArray(entries) || !entries.length) return 1.0;
  const loaded = state?.loaded || {};
  let freshestMs = 0;
  for (const entry of entries) {
    const file = entry?.file;
    if (!file) continue;
    // Canon-touching threads return early with full weight — no decay.
    if (canonicalFiles?.has(file)) return 1.0;
    const touchedMs = resolveLastTouchedAtMs(file, loaded[file]);
    if (touchedMs === null) continue;
    if (touchedMs > freshestMs) freshestMs = touchedMs;
  }
  if (freshestMs === 0) return 1.0; // no anchor — give benefit of the doubt
  const ageDays = (Date.now() - freshestMs) / MS_PER_DAY;
  if (ageDays <= 0) return 1.0;
  return Math.exp(-Math.LN2 * ageDays / MEMORY_RECENCY_HALF_LIFE_DAYS);
}

function rankMemoryThreads(promptTokens, index, state = {}, canonicalFiles = new Set()) {
  const ranked = [];
  const threads = index?.threads || {};
  const filesMap = index?.files || {};
  for (const [threadKey, entries] of Object.entries(threads)) {
    const rawScore = scoreMemoryThread(promptTokens, threadKey, entries, filesMap);
    const sessionRepeatCount = sessionRepeatCountForThread(state, threadKey, entries);
    const sessionPenalty = memorySessionRepeatPenalty(sessionRepeatCount);
    const recencyPenalty = computeThreadRecencyPenalty(entries, state, canonicalFiles);
    const score = rawScore * sessionPenalty * recencyPenalty;
    if (score >= MEMORY_MIN_SCORE_TO_INJECT) {
      ranked.push({
        score, rawScore, sessionPenalty, sessionRepeatCount, recencyPenalty, threadKey, entries,
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

// ── excerpt loading ────────────────────────────────────────────────────────

function resolveMemoryFilePath(roomDir, filePath) {
  const source = String(filePath || "");
  if (source === HOUSE_MEMORY_DIRNAME || source.startsWith(`${HOUSE_MEMORY_DIRNAME}/`)) {
    return path.join(path.dirname(roomDir), source);
  }
  return path.join(roomDir, source);
}

function clipMemoryExcerpt(text, maxChars = MEMORY_MAX_EXCERPT_CHARS) {
  const source = String(text || "");
  if (source.length <= maxChars) return source;
  return `${source.slice(0, maxChars - 20).trimEnd()}\n...[clipped]`;
}

async function readMemoryFileExcerpt(roomDir, filePath, lineRange = [0, 0]) {
  if (!filePath || String(filePath).startsWith("important_index:")) return null;
  const target = resolveMemoryFilePath(roomDir, filePath);
  if (!existsSync(target)) return null;
  const raw = String(await readFile(target, "utf8")).replace(/^\uFEFF/, "");
  const [startRaw, endRaw] = Array.isArray(lineRange) ? lineRange : [0, 0];
  const start = Number(startRaw) || 0;
  const end = Number(endRaw) || 0;
  if (start <= 0 || end <= 0) return raw;
  const lines = raw.split(/\r?\n/);
  return lines.slice(Math.max(0, start - 1), Math.min(lines.length, end)).join("\n");
}

async function readMemoryEntry(roomDir, entry) {
  const filePath = entry?.file || "";
  const lineRange = entry?.lines || [0, 0];
  const text = await readMemoryFileExcerpt(roomDir, filePath, lineRange);
  if (text === null) return null;
  return {
    source: `${filePath}:${lineRange[0]}-${lineRange[1]}`,
    file_path: filePath,
    text: clipMemoryExcerpt(text),
  };
}

async function collectMemoryThreadExcerpts(roomDir, match) {
  const excerpts = [];
  for (const entry of Array.isArray(match.entries) ? match.entries : []) {
    const excerpt = await readMemoryEntry(roomDir, entry);
    if (!excerpt) continue;
    excerpt.reason = `thread '${match.threadKey}' (score ${match.score.toFixed(1)})`;
    excerpts.push(excerpt);
  }
  return excerpts;
}

async function collectMemorySyncExcerpts(roomDir, matches) {
  const excerpts = [];
  for (const match of matches) {
    excerpts.push(...await collectMemoryThreadExcerpts(roomDir, match));
  }
  return excerpts;
}

async function collectMemoryPinnedExcerpts(roomDir, state, index) {
  const loaded = state?.loaded || {};
  const filesMap = index?.files || {};
  const excerpts = [];
  for (const [filePath, meta] of Object.entries(loaded)) {
    if (!meta?.pinned || String(filePath).startsWith("important_index:")) continue;
    const text = await readMemoryFileExcerpt(roomDir, filePath, [0, 0]);
    if (text === null) continue;
    const oneLine = filesMap?.[filePath]?.one_line || "";
    excerpts.push({
      source: filePath,
      file_path: filePath,
      text: clipMemoryExcerpt(text),
      reason: oneLine ? `pinned: ${oneLine.slice(0, 80)}` : "pinned",
    });
  }
  return excerpts;
}

function collectMemorySemanticExcerpts(chunks) {
  const excerpts = [];
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const filePath = String(chunk?.source_path || "").trim();
    const body = String(chunk?.body || "").trim();
    if (!filePath || !body) continue;
    const chunkIdx = Number.isFinite(chunk?.chunk_index) ? chunk.chunk_index : 0;
    const sim = Number.isFinite(chunk?.sim) ? Number(chunk.sim) : 0;
    const heading = String(chunk?.heading_path || "").trim();
    const reason = heading
      ? `semantic match (sim ${sim.toFixed(3)}) — ${heading}`
      : `semantic match (sim ${sim.toFixed(3)})`;
    excerpts.push({
      source: `${filePath}#chunk-${chunkIdx}`,
      file_path: filePath,
      text: clipMemoryExcerpt(body),
      reason,
      sim,
    });
  }
  return excerpts;
}

// Date matches → excerpts. Added 2026-05-23 (date-aware retrieval fix).
// Distinguished from all other excerpt types because date hits are
// authoritative direct-match — when the user/dragon asks about a specific
// YYYY-MM-DD that's tagged on the memory, this IS the memory they meant.
// Surfaced HIGH (post-pinned, pre-important) so the context block leads
// with the explicit answer instead of burying it under canon/threads.
function collectMemoryDateExcerpts(dateMatches, queryDates) {
  const excerpts = [];
  const dateLabel = Array.isArray(queryDates) && queryDates.length
    ? queryDates.join(", ")
    : "(date)";
  for (const hit of Array.isArray(dateMatches) ? dateMatches : []) {
    const filePath = String(hit?.source_path || "").trim();
    const excerpt = String(hit?.body_excerpt || "").trim();
    if (!filePath || !excerpt) continue;
    const title = String(hit?.title || "").trim();
    const hitDates = Array.isArray(hit?.dates) ? hit.dates.join(",") : "";
    const totalChars = Number.isFinite(hit?.body_full_chars) ? hit.body_full_chars : 0;
    const excerptChars = excerpt.length;
    const truncated = totalChars > excerptChars
      ? ` (excerpt ${excerptChars}/${totalChars} chars)`
      : "";
    const reason = `date match for ${dateLabel}${hitDates ? ` — tagged ${hitDates}` : ""}${truncated}`;
    excerpts.push({
      source: `${filePath}#date-${(queryDates || []).join("_") || "match"}`,
      file_path: filePath,
      text: clipMemoryExcerpt(title ? `**${title}**\n\n${excerpt}` : excerpt),
      reason,
    });
  }
  return excerpts;
}

// Content (pg_trgm GIN word_similarity) chunks → excerpts. Added 2026-05-19
// zeal pass. Distinguished from semantic by:
//   - excerpt.source = `${filePath}#content-${chunkIdx}` (semantic uses #chunk-N)
//     so dedupe by source treats them as different rows from same file
//   - excerpt.reason names "content match (ws X.XXX)" instead of "semantic match"
//   - excerpt carries `ws` field instead of `sim` (word_similarity vs cosine)
// The plugin merges semantic + content into the chunk-tier of the final blob.
function collectMemoryContentExcerpts(chunks) {
  const excerpts = [];
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const filePath = String(chunk?.source_path || "").trim();
    const body = String(chunk?.body || "").trim();
    if (!filePath || !body) continue;
    const chunkIdx = Number.isFinite(chunk?.chunk_index) ? chunk.chunk_index : 0;
    const ws = Number.isFinite(chunk?.ws) ? Number(chunk.ws) : 0;
    const heading = String(chunk?.heading_path || "").trim();
    const reason = heading
      ? `content match (ws ${ws.toFixed(3)}) — ${heading}`
      : `content match (ws ${ws.toFixed(3)})`;
    excerpts.push({
      source: `${filePath}#content-${chunkIdx}`,
      file_path: filePath,
      text: clipMemoryExcerpt(body),
      reason,
      ws,
    });
  }
  return excerpts;
}

// ── important-index matching ───────────────────────────────────────────────

function matchMemoryTerm(promptLower, term) {
  const target = String(term || "").trim().toLowerCase();
  if (!target) return false;
  return new RegExp(`\\b${escapeRegExp(target)}\\b`, "i").test(promptLower);
}

function matchMemoryImportantTerms(prompt, importantIndex) {
  const promptLower = String(prompt || "").toLowerCase();
  const matches = [];
  const seen = new Set();
  for (const [termKey, entry] of Object.entries(importantIndex || {})) {
    if (seen.has(termKey)) continue;
    const terms = [termKey, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])];
    if (terms.some((term) => matchMemoryTerm(promptLower, term))) {
      matches.push({ termKey, entry });
      seen.add(termKey);
    }
    if (matches.length >= MEMORY_MAX_IMPORTANT_MATCHES) break;
  }
  return matches;
}

async function collectMemoryImportantExcerpts(roomDir, matches) {
  const excerpts = [];
  for (const match of matches) {
    const summary = String(match.entry?.summary || "").trim();
    const type = match.entry?.type ? ` (${match.entry.type})` : "";
    const weighty = match.entry?.weighty ? " [weighty]" : "";
    if (summary) {
      excerpts.push({
        source: `important_index:${match.termKey}`,
        file_path: `important_index:${match.termKey}`,
        text: `**${match.termKey}**${type}${weighty}\n${summary}`,
        reason: "important-index match",
      });
    }
    for (const fileRef of Array.isArray(match.entry?.files) ? match.entry.files : []) {
      const excerpt = await readMemoryEntry(roomDir, fileRef);
      if (!excerpt) continue;
      excerpt.reason = `important-index pointer from '${match.termKey}'`;
      excerpts.push(excerpt);
    }
  }
  return excerpts;
}

function boostMemoryPromptTokens(promptTokens, importantMatches) {
  const boosted = new Set(promptTokens);
  for (const match of importantMatches) {
    if (Array.isArray(match.entry?.files) && match.entry.files.length) continue;
    for (const token of tokenizeMemory(match.entry?.search_boost || "")) {
      boosted.add(token);
    }
  }
  return boosted;
}

// ── canon-assertion overlay (audit ticket #5) ──────────────────────────────
// importantIndex entries whose pointer_files reference any file in an active
// (top-N sync) thread match get pulled in as load-bearing CONSTRAINTS —
// regardless of whether they appeared in the user's prompt text. This is
// what the 2026-05-11 substrate-audit-ticket called the "biggest single win"
// alongside tiered retrieval: canon never gets crowded out by recent-
// dramatic content, AND canon-touching-the-current-conversation surfaces
// even when the user didn't name it.
//
// Entries already matched via prompt-text (importantMatches) are excluded
// from this overlay so they don't double-inject — they're already going to
// land in the memory-context block via their existing path.

function collectCanonAssertions(importantIndex, syncMatches, alreadyMatchedTermKeys) {
  const activeFiles = new Set(
    (Array.isArray(syncMatches) ? syncMatches : []).flatMap((match) =>
      (Array.isArray(match?.entries) ? match.entries : [])
        .map((entry) => entry?.file)
        .filter(Boolean),
    ),
  );
  if (!activeFiles.size) return [];

  const assertions = [];
  for (const [termKey, entry] of Object.entries(importantIndex || {})) {
    if (alreadyMatchedTermKeys.has(termKey)) continue;
    const entryFiles = (Array.isArray(entry?.files) ? entry.files : [])
      .map((fileRef) => fileRef?.file)
      .filter(Boolean);
    if (!entryFiles.length) continue;
    if (!entryFiles.some((file) => activeFiles.has(file))) continue;
    assertions.push({ termKey, entry });
  }
  return assertions;
}

// ── canon reverse-index (recall): matched-file → owning-entity ─────────────
// 2026-06-05 fix. recall's canonMatches was NAME-only (matchMemoryImportantTerms
// fires on word-boundary match of an entity's name/aliases). That meant a query
// like "12 inches / be gentle" could pull the bath-scene chunk — a file that IS
// a pointer of `the protection vow` — and STILL report "0 canon entries,"
// because the query never said "the vow." The canon was right there in the
// retrieved file and the link back to the owning entity was simply never made.
//
// This reverses the index: given the source_paths of the chunks recall actually
// surfaced (semantic + content + date), find any canon entry whose pointer
// files include one of them. Deduped against the name-match termKeys so an
// entry matched both ways isn't double-counted. Path normalization mirrors
// the python side's house/ rendering prefix (load_semantic_chunks strips it;
// here we compare both bare and prefixed forms to be safe).
function collectCanonByMatchedFiles(importantIndex, matchedSourcePaths, alreadyMatchedTermKeys) {
  const matched = new Set();
  for (const raw of Array.isArray(matchedSourcePaths) ? matchedSourcePaths : []) {
    const p = String(raw || "").trim();
    if (!p) continue;
    matched.add(p);
    // also add the house-prefix-stripped form so entity pointers (bare paths)
    // match chunks rendered with the cross-room "house/" prefix.
    if (p.startsWith(`${HOUSE_MEMORY_DIRNAME}/`)) {
      matched.add(p.slice(HOUSE_MEMORY_DIRNAME.length + 1));
    }
  }
  if (!matched.size) return [];

  const out = [];
  for (const [termKey, entry] of Object.entries(importantIndex || {})) {
    if (alreadyMatchedTermKeys?.has(termKey)) continue;
    const entryFiles = (Array.isArray(entry?.files) ? entry.files : [])
      .map((fileRef) => fileRef?.file)
      .filter(Boolean);
    if (!entryFiles.length) continue;
    if (!entryFiles.some((file) => matched.has(file))) continue;
    out.push({ termKey, entry, via: "pointer-file" });
  }
  return out;
}

// ── canon cross-reference annotation (audit ticket #3) ────────────────────
// Conservative lexical version: for each memory excerpt, scan its body for
// any canon term/alias that's already surfaced this turn (via importantMatches
// or canonAssertions). Tag the excerpt with `canon_refs: [termKey, ...]` so
// formatMemoryContextBlock can render a cross-reference hint.
//
// We don't try to detect actual semantic *disagreement* — that's a meaning
// operation, requires LLM help, out of scope for v1. The cross-ref label
// just gives the model the bridge metadata; the model itself decides
// whether canon framing wins in any specific tension.
//
// Self-references skipped per-term, not per-excerpt — an `important_index:X`
// excerpt's body IS the X entry's summary, but it can still reference OTHER
// canon entries that should be flagged.

function annotateMemoryExcerptsWithCanonRefs(
  finalExcerpts,
  surfacedCanonTermKeys,
  importantIndex,
) {
  if (
    !Array.isArray(finalExcerpts) || !finalExcerpts.length
    || !surfacedCanonTermKeys?.size
    || !importantIndex
  ) return;
  for (const excerpt of finalExcerpts) {
    const body = String(excerpt?.text || "").toLowerCase();
    if (!body) continue;
    const source = String(excerpt?.source || "");
    const selfTermKey = source.startsWith("important_index:")
      ? source.slice("important_index:".length)
      : null;
    const refs = new Set();
    for (const termKey of surfacedCanonTermKeys) {
      if (termKey === selfTermKey) continue;
      const entry = importantIndex[termKey];
      if (!entry) continue;
      const terms = [termKey, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])];
      if (terms.some((term) => matchMemoryTerm(body, term))) {
        refs.add(termKey);
      }
    }
    if (refs.size) {
      excerpt.canon_refs = Array.from(refs);
    }
  }
}

// ── postgres source spawn ──────────────────────────────────────────────────
// Two-stage flow per audit ticket #1 (tiered retrieval):
//   Stage 1 — lexical: load index + importantIndex (Pass 1). No embed.
//   Stage 2 — semantic: embed prompt + narrowed cosine on active-thread files
//             (Pass 2). Only called after plugin has ranked Pass 1 threads.
// spawnPostgresSource is the shared spawn machinery; the two wrappers below
// just build the right argv for each mode.

function spawnPostgresSource(roomDir, args, prompt) {
  return new Promise((resolve) => {
    const fullArgs = [
      "python3",
      windowsPathToWsl(MEMORY_POSTGRES_SOURCE_SCRIPT),
      ...args,
    ];
    const child = spawn("wsl.exe", fullArgs, {
      cwd: roomDir,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      settle({ ok: false, error: "postgres source timed out" });
    }, MEMORY_POSTGRES_TIMEOUT_MS);

    // Pipe prompt via stdin (avoids argv-length issues on long prompts).
    try {
      child.stdin?.end(String(prompt || ""));
    } catch {
      /* fail-soft */
    }

    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (err) => settle({ ok: false, error: err?.message || String(err) }));
    child.on("close", (code) => {
      if (code !== 0) {
        settle({ ok: false, error: stderr.trim() || `postgres source exited ${code}` });
        return;
      }
      try {
        settle({ ok: true, data: JSON.parse(stdout), stderr: stderr.trim() });
      } catch (err) {
        settle({ ok: false, error: err?.message || String(err) });
      }
    });
  });
}

function runMemoryPostgresLexical(roomDir, roomName, prompt) {
  const resolvedRoom = (roomName || path.basename(roomDir) || "").toLowerCase();
  const args = [
    "--room-dir", windowsPathToWsl(roomDir),
    "--mode", "lexical",
  ];
  if (resolvedRoom === "kodo" || resolvedRoom === "kintsu") {
    args.push("--room", resolvedRoom);
  }
  return spawnPostgresSource(roomDir, args, prompt);
}

function runMemoryPostgresSemantic(roomDir, roomName, prompt, scopeFiles) {
  const resolvedRoom = (roomName || path.basename(roomDir) || "").toLowerCase();
  const args = [
    "--room-dir", windowsPathToWsl(roomDir),
    "--mode", "semantic",
    "--semantic-top-k", String(MEMORY_SEMANTIC_TOP_K),
    "--semantic-min-sim", String(MEMORY_SEMANTIC_MIN_SIM),
  ];
  if (resolvedRoom === "kodo" || resolvedRoom === "kintsu") {
    args.push("--room", resolvedRoom);
  }
  if (Array.isArray(scopeFiles) && scopeFiles.length) {
    args.push("--scope-files", scopeFiles.join(","));
  }
  return spawnPostgresSource(roomDir, args, prompt);
}

// Date mode wrapper. Added 2026-05-23. Always GLOBAL — date hits are
// direct authoritative lookups against memories.dates GIN, the user/dragon
// literally named a date and this returns memories tagged with it. No
// embed, no scope-narrowing, cheap due to the GIN index.
function runMemoryPostgresDate(roomDir, roomName, prompt) {
  const resolvedRoom = (roomName || path.basename(roomDir) || "").toLowerCase();
  const args = [
    "--room-dir", windowsPathToWsl(roomDir),
    "--mode", "date",
  ];
  if (resolvedRoom === "kodo" || resolvedRoom === "kintsu") {
    args.push("--room", resolvedRoom);
  }
  return spawnPostgresSource(roomDir, args, prompt);
}

// Content (pg_trgm word_similarity) mode wrapper. Unlike semantic, content
// is GLOBAL by default — the whole point of this pass is to catch chunks
// the lexical thread-ranking missed entirely. Scope-files honored only when
// caller explicitly wants narrowing (matches semantic-pass behavior for
// back-compat).
function runMemoryPostgresContent(roomDir, roomName, prompt, scopeFiles) {
  const resolvedRoom = (roomName || path.basename(roomDir) || "").toLowerCase();
  const args = [
    "--room-dir", windowsPathToWsl(roomDir),
    "--mode", "content",
    "--content-top-k", String(MEMORY_CONTENT_TOP_K),
    "--content-min-sim", String(MEMORY_CONTENT_MIN_SIM),
  ];
  if (resolvedRoom === "kodo" || resolvedRoom === "kintsu") {
    args.push("--room", resolvedRoom);
  }
  if (Array.isArray(scopeFiles) && scopeFiles.length) {
    args.push("--scope-files", scopeFiles.join(","));
  }
  return spawnPostgresSource(roomDir, args, prompt);
}

// ── JSON fallback (when postgres source fails) ────────────────────────────

async function loadMemoryImportantIndex(roomDir) {
  const data = await readJson(path.join(roomDir, MEMORY_IMPORTANT_INDEX_FILENAME), null);
  return data?.entries && typeof data.entries === "object" ? data.entries : {};
}

function prefixHouseMemoryIndex(index) {
  if (!index || typeof index !== "object") return null;
  const files = {};
  for (const [filePath, meta] of Object.entries(index.files || {})) {
    files[`${HOUSE_MEMORY_DIRNAME}/${filePath}`] = meta;
  }
  const threads = {};
  for (const [threadKey, entries] of Object.entries(index.threads || {})) {
    threads[`house / ${threadKey}`] = (Array.isArray(entries) ? entries : []).map((entry) => ({
      ...entry,
      file: `${HOUSE_MEMORY_DIRNAME}/${entry?.file || ""}`,
      context: `Shared house memory. ${entry?.context || ""}`.trim(),
    }));
  }
  return { files, threads };
}

function mergeMemoryIndexes(...indexes) {
  const merged = { files: {}, threads: {} };
  for (const index of indexes) {
    if (!index) continue;
    Object.assign(merged.files, index.files || {});
    for (const [threadKey, entries] of Object.entries(index.threads || {})) {
      if (!merged.threads[threadKey]) {
        merged.threads[threadKey] = entries;
        continue;
      }
      merged.threads[threadKey] = [
        ...merged.threads[threadKey],
        ...(Array.isArray(entries) ? entries : []),
      ];
    }
  }
  return merged;
}

async function loadHouseMemoryIndex(roomDir) {
  const sharedRoot = path.dirname(roomDir);
  const houseIndexPath = path.join(sharedRoot, HOUSE_MEMORY_DIRNAME, MEMORY_INDEX_FILENAME);
  const index = await readJson(houseIndexPath, null);
  return prefixHouseMemoryIndex(index);
}

async function loadMemoryIndexFromJson(roomDir) {
  const roomIndex = await readJson(path.join(roomDir, MEMORY_INDEX_FILENAME), null);
  if (!roomIndex) return null;
  return mergeMemoryIndexes(roomIndex, await loadHouseMemoryIndex(roomDir));
}

async function loadMemoryLexicalSources(roomDir, roomName, prompt) {
  const fromPostgres = await runMemoryPostgresLexical(roomDir, roomName, prompt);
  if (fromPostgres.ok && fromPostgres.data?.index) {
    return {
      index: fromPostgres.data.index,
      importantIndex: fromPostgres.data.importantIndex || {},
      indexSource: "postgres",
      importantSource: "postgres",
      fallbackReason: null,
    };
  }
  return {
    index: await loadMemoryIndexFromJson(roomDir),
    importantIndex: await loadMemoryImportantIndex(roomDir),
    indexSource: "json",
    importantSource: "json",
    fallbackReason: fromPostgres.error || "postgres source unavailable",
  };
}

async function loadMemorySemanticSource(roomDir, roomName, prompt, scopeFiles) {
  // Skip the call entirely when there's nothing to embed against or no scope
  // to narrow against. The audit-ticket #1 design says semantic Pass 2 only
  // fires for files in active threads; if the prompt produced zero ranked
  // matches, there's no scope, so we skip semantic entirely (saves an embed
  // roundtrip AND keeps the off-axis "find anything kinda related" hits
  // from leaking back in via room-wide fallback).
  if (!prompt || !Array.isArray(scopeFiles) || !scopeFiles.length) {
    return {
      semanticChunks: [],
      semanticSource: "skip-no-scope",
      semanticStderr: "",
    };
  }
  const fromPostgres = await runMemoryPostgresSemantic(roomDir, roomName, prompt, scopeFiles);
  if (fromPostgres.ok && Array.isArray(fromPostgres.data?.semanticChunks)) {
    const chunks = fromPostgres.data.semanticChunks;
    return {
      semanticChunks: chunks,
      semanticSource: chunks.length ? "postgres-narrowed" : "postgres-empty",
      semanticStderr: fromPostgres.stderr || "",
    };
  }
  return {
    semanticChunks: [],
    semanticSource: "unavailable",
    semanticStderr: fromPostgres.error || "postgres source unavailable",
  };
}

// Date source (added 2026-05-23 — date-aware retrieval fix). Always GLOBAL,
// no embed. Returns memories whose `dates` array intersects any YYYY-MM-DD
// token extracted from the prompt. Fail-open: any failure produces an empty
// array. Skip entirely when prompt has no date tokens — the python side
// also short-circuits but skipping here avoids the WSL spawn overhead.
async function loadMemoryDateSource(roomDir, roomName, prompt) {
  if (!prompt) {
    return {
      dateMatches: [],
      queryDates: [],
      dateSource: "skip-no-prompt",
      dateStderr: "",
    };
  }
  // Cheap pre-flight: if no YYYY-MM-DD token in the prompt, skip the spawn.
  // The python side regex is authoritative; this mirror just saves the
  // wsl.exe roundtrip when the user prompt has no date at all.
  if (!/\b\d{4}-\d{2}-\d{2}\b/.test(prompt)) {
    return {
      dateMatches: [],
      queryDates: [],
      dateSource: "skip-no-date-token",
      dateStderr: "",
    };
  }
  const fromPostgres = await runMemoryPostgresDate(roomDir, roomName, prompt);
  if (fromPostgres.ok && Array.isArray(fromPostgres.data?.dateMatches)) {
    const matches = fromPostgres.data.dateMatches;
    const queryDates = Array.isArray(fromPostgres.data?.queryDates)
      ? fromPostgres.data.queryDates
      : [];
    return {
      dateMatches: matches,
      queryDates,
      dateSource: matches.length ? "postgres-hit" : "postgres-empty",
      dateStderr: fromPostgres.stderr || "",
    };
  }
  return {
    dateMatches: [],
    queryDates: [],
    dateSource: "unavailable",
    dateStderr: fromPostgres.error || "postgres source unavailable",
  };
}

// Content source (added 2026-05-19 zeal pass). Always GLOBAL — the entire
// purpose of this pass is to catch chunks the lexical-thread-ranking missed
// (off-axis files with isolated proper-noun mentions). Cheap due to the
// pg_trgm GIN on memory_chunks.body, no embed roundtrip needed.
async function loadMemoryContentSource(roomDir, roomName, prompt) {
  if (!prompt) {
    return {
      contentChunks: [],
      contentSource: "skip-no-prompt",
      contentStderr: "",
    };
  }
  // No scopeFiles passed — content runs global.
  const fromPostgres = await runMemoryPostgresContent(roomDir, roomName, prompt, null);
  if (fromPostgres.ok && Array.isArray(fromPostgres.data?.contentChunks)) {
    const chunks = fromPostgres.data.contentChunks;
    return {
      contentChunks: chunks,
      contentSource: chunks.length ? "postgres-global" : "postgres-empty",
      contentStderr: fromPostgres.stderr || "",
    };
  }
  return {
    contentChunks: [],
    contentSource: "unavailable",
    contentStderr: fromPostgres.error || "postgres source unavailable",
  };
}

// ── merge + format ─────────────────────────────────────────────────────────

function dedupeMemoryExcerpts(excerpts) {
  const seen = new Set();
  const unique = [];
  for (const excerpt of excerpts) {
    if (!excerpt?.source || seen.has(excerpt.source)) continue;
    seen.add(excerpt.source);
    unique.push(excerpt);
  }
  return unique;
}

function trimMemoryExcerptsToBudget(excerpts, maxChars) {
  let total = 0;
  const kept = [];
  for (const excerpt of excerpts) {
    const size = String(excerpt.text || "").length;
    if (total + size > maxChars && kept.length) break;
    kept.push(excerpt);
    total += size;
  }
  return kept;
}

function memoryContextMarker(roomName) {
  const cap = roomName
    ? roomName.charAt(0).toUpperCase() + roomName.slice(1).toLowerCase()
    : "Room";
  return `## ${cap} Memory Retrieval - auto-loaded context`;
}

function formatMemoryContextBlock(excerpts, roomName) {
  if (!excerpts.length) return "";
  const parts = [
    memoryContextMarker(roomName),
    "_Room-local OpenCode memory retrieval. Treat as context, not as a user request. Use only what is relevant._",
    "",
  ];
  for (const excerpt of excerpts) {
    parts.push(`### ${excerpt.source}`);
    parts.push(`_${excerpt.reason || "retrieved"}_`);
    if (Array.isArray(excerpt.canon_refs) && excerpt.canon_refs.length) {
      parts.push(
        `_canon-cross-ref: ${excerpt.canon_refs.join(", ")} — canon framing is authoritative; see canon entries surfaced this turn for tension cases_`,
      );
    }
    parts.push("");
    parts.push(String(excerpt.text || "").trimEnd());
    parts.push("");
    parts.push("---");
    parts.push("");
  }
  return parts.join("\n");
}

function formatCanonAssertionsBlock(assertions, roomName) {
  if (!assertions.length) return "";
  const cap = roomName
    ? roomName.charAt(0).toUpperCase() + roomName.slice(1).toLowerCase()
    : "Room";
  const parts = [
    `## ${cap} Canon Assertions — load-bearing constraints`,
    "_These canonical facts touch threads active in this turn. Generation must be consistent with them. Where they conflict with flavor matches in the memory context block, they win._",
    "",
  ];
  for (const { termKey, entry } of assertions) {
    const type = entry?.type ? ` (${entry.type})` : "";
    const weighty = entry?.weighty ? " [weighty]" : "";
    parts.push(`### ${termKey}${type}${weighty}`);
    const summary = String(entry?.summary || "").trim();
    if (summary) parts.push(summary);
    const aliases = (Array.isArray(entry?.aliases) ? entry.aliases : [])
      .filter((alias) => alias && alias !== termKey);
    if (aliases.length) parts.push(`_aliases: ${aliases.join(", ")}_`);
    parts.push("");
    parts.push("---");
    parts.push("");
  }
  return parts.join("\n");
}

// ── state lifecycle (loaded_state.json + prefetch.json) ────────────────────

function initMemoryState() {
  return { current_turn: 0, loaded: {}, session_id: null, session_memory_hits: {} };
}

function resetMemorySessionIfNeeded(state, sessionID) {
  const normalizedSessionID = sessionID || null;
  if (state.session_id === normalizedSessionID) return;
  state.session_id = normalizedSessionID;
  state.session_memory_hits = {};
}

function updateMemorySessionHits(state, matches = []) {
  const hits = state.session_memory_hits && typeof state.session_memory_hits === "object"
    ? state.session_memory_hits
    : {};
  state.session_memory_hits = hits;
  for (const match of matches) {
    const threadKey = match?.threadKey || "";
    if (threadKey) {
      const key = `thread:${threadKey}`;
      hits[key] = (Number(hits[key]) || 0) + 1;
    }
    for (const entry of Array.isArray(match?.entries) ? match.entries : []) {
      if (!entry?.file) continue;
      const key = `file:${entry.file}`;
      hits[key] = (Number(hits[key]) || 0) + 1;
    }
  }
}

function updateMemoryStateFreshness(state, excerpts, currentTurn) {
  const loaded = state.loaded && typeof state.loaded === "object" ? state.loaded : {};
  state.loaded = loaded;
  const nowIso = new Date().toISOString();
  for (const excerpt of excerpts) {
    const filePath = excerpt?.file_path || "";
    if (!filePath) continue;
    const entry = loaded[filePath] || {
      last_touched_turn: currentTurn,
      last_touched_at: nowIso,
      pinned: false,
      load_bearing: false,
    };
    entry.last_touched_turn = currentTurn;
    entry.last_touched_at = nowIso;
    loaded[filePath] = entry;
  }
}

function buildMemoryPrefetchQueue(matches, currentTurn) {
  return matches.map((match) => ({
    score: match.score,
    thread_key: match.threadKey,
    entries: match.entries,
    queued_at_turn: currentTurn,
  }));
}

function restoreMemoryPrefetchMatches(prefetch, promptTokens, index, state, canonicalFiles) {
  if (!promptTokens?.size) return [];
  return (Array.isArray(prefetch) ? prefetch : [])
    .map((item) => {
      const threadKey = item?.thread_key || "prefetch";
      const entries = item?.entries || [];
      const rawScore = scoreMemoryThread(promptTokens, threadKey, entries, index?.files || {});
      const recencyPenalty = computeThreadRecencyPenalty(entries, state, canonicalFiles);
      return {
        score: rawScore * recencyPenalty,
        rawScore,
        recencyPenalty,
        threadKey,
        entries,
      };
    })
    .filter((match) => match.score >= MEMORY_MIN_SCORE_TO_INJECT);
}

function formatMemoryCandidateDebugLine(match, selected) {
  const files = (Array.isArray(match?.entries) ? match.entries : [])
    .map((entry) => entry?.file)
    .filter(Boolean)
    .slice(0, 3)
    .join(",");
  return [
    `selected=${selected ? "1" : "0"}`,
    `score=${Number(match?.score || 0).toFixed(2)}`,
    `raw=${Number(match?.rawScore || match?.score || 0).toFixed(2)}`,
    `repeat=${Number(match?.sessionRepeatCount || 0)}`,
    `session_penalty=${Number(match?.sessionPenalty || 1).toFixed(2)}`,
    `recency=${Number(match?.recencyPenalty || 1).toFixed(2)}`,
    `thread=${JSON.stringify(match?.threadKey || "")}`,
    files ? `files=${JSON.stringify(files)}` : "files=none",
  ].join(" ");
}

// ── prompt normalization & extraction ──────────────────────────────────────

function messageHasMemoryContext(message) {
  return (message?.parts || []).some(
    (part) =>
      part?.metadata?.solarisaelMemory === true ||
      part?.metadata?.solarisaelCanonAssertion === true,
  );
}

function stripEmbeddedMemoryContext(text) {
  return String(text || "")
    .replace(
      /<system-reminder>[\s\S]*?(?:Kintsu|Kodo) Memory Retrieval[\s\S]*?<\/system-reminder>/gi,
      "",
    )
    .replace(/^## (?:Kintsu|Kodo) Memory Retrieval - auto-loaded context[\s\S]*$/gim, "")
    .trim();
}

function normalizeMemoryPrompt(text) {
  return stripEmbeddedMemoryContext(text)
    .replace(/\btouch(?:ed)?\s+it\s+up\b/gi, "")
    .trim();
}

function userPromptFromMessage(message) {
  return (message?.parts || [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .filter((part) => part?.metadata?.solarisaelMemory !== true)
    .map((part) => normalizeMemoryPrompt(part.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

// ── core orchestrator ──────────────────────────────────────────────────────

async function runRoomMemoryRetrieval(roomName, roomDir, prompt, sessionID = null) {
  const effectiveRoomDir = path.resolve(String(roomDir || process.cwd()));
  const baseName = path.basename(effectiveRoomDir).toLowerCase();
  const targetRoom = (roomName || baseName || "").toLowerCase();

  // Sanity: only fire when cwd basename matches the requested room.
  // Prevents cross-room retrieval if caller and resolved dir disagree.
  const empty = { contextBlock: "", canonBlock: "" };
  if (!targetRoom || baseName !== targetRoom) return empty;
  if (String(prompt || "").trim().length < MEMORY_MIN_PROMPT_LEN) return empty;

  try {
    const statePath = path.join(effectiveRoomDir, MEMORY_STATE_FILENAME);
    const prefetchPath = path.join(effectiveRoomDir, MEMORY_PREFETCH_FILENAME);
    const {
      index, importantIndex, indexSource, importantSource, fallbackReason,
    } = await loadMemoryLexicalSources(effectiveRoomDir, targetRoom, prompt);

    if (!index) {
      await debugMemoryLog(effectiveRoomDir, "memory index missing or malformed; skipping");
      return empty;
    }

    const state = await readJson(statePath, null) || initMemoryState();
    resetMemorySessionIfNeeded(state, sessionID);
    state.current_turn = (Number(state.current_turn) || 0) + 1;
    const currentTurn = state.current_turn;
    const priorPrefetch = await readJson(prefetchPath, []);

    const importantMatches = matchMemoryImportantTerms(prompt, importantIndex);
    const importantExcerpts = await collectMemoryImportantExcerpts(effectiveRoomDir, importantMatches);

    // Canon-exempt set for the recency-decay computation (#2): any file
    // referenced by a named_entity's pointer_files stays at full weight
    // regardless of staleness. The canon-assertion overlay already
    // surfaces these as constraints; demoting them here would double-cut.
    const canonicalFiles = buildCanonicalFileSet(importantIndex);

    const promptTokens = boostMemoryPromptTokens(tokenizeMemory(prompt), importantMatches);
    const ranked = rankMemoryThreads(promptTokens, index, state, canonicalFiles);
    const syncMatches = ranked.slice(0, MEMORY_MAX_SYNC_INJECTIONS);
    const prefetchMatches = ranked.slice(
      MEMORY_MAX_SYNC_INJECTIONS,
      MEMORY_MAX_SYNC_INJECTIONS + MEMORY_MAX_PREFETCH_QUEUE,
    );

    // Audit ticket #1 Pass 2: narrow semantic search to files participating
    // in the active (top-N sync) threads. Pass 1 (lexical ranking) happened
    // against the already-loaded index. Now that we know which threads
    // matter for this turn, the second postgres call embeds the prompt
    // once and runs cosine ONLY over chunks of those files — instead of
    // the entire room+house corpus. This is what knocks out the off-axis
    // cosine matches that previously surfaced via room-wide search (the
    // "wolf-poem chunk fires because the prompt shares two embedding-space
    // dimensions with the wolf-poem cluster" pattern). When no active
    // files exist (zero sync matches), semantic is skipped entirely.
    const activeFiles = Array.from(new Set(
      syncMatches.flatMap((match) =>
        (Array.isArray(match?.entries) ? match.entries : [])
          .map((entry) => entry?.file)
          .filter(Boolean),
      ),
    ));
    const { semanticChunks, semanticSource, semanticStderr } =
      await loadMemorySemanticSource(effectiveRoomDir, targetRoom, prompt, activeFiles);

    // Content pass (added 2026-05-19 zeal pass) runs GLOBAL in parallel with
    // semantic. The whole reason this exists is to catch chunks the
    // lexical-thread-ranking missed (off-axis files with isolated proper-noun
    // mentions). Cheap due to the pg_trgm GIN on memory_chunks.body.
    const { contentChunks, contentSource, contentStderr } =
      await loadMemoryContentSource(effectiveRoomDir, targetRoom, prompt);

    // Date pass (added 2026-05-23 — date-aware retrieval fix). Extracts
    // YYYY-MM-DD tokens from prompt and queries memories.dates GIN. Direct
    // authoritative match: when the user names a date, this returns the
    // memories tagged with it (handles cross-midnight stitched files like
    // 2026-05-21_22_* that were invisible to the prior 3-pass pipeline).
    // Skipped entirely when prompt has no date token — no spawn overhead.
    const { dateMatches, queryDates, dateSource, dateStderr } =
      await loadMemoryDateSource(effectiveRoomDir, targetRoom, prompt);

    const pinnedExcerpts = await collectMemoryPinnedExcerpts(effectiveRoomDir, state, index);
    const rawSyncExcerpts = await collectMemorySyncExcerpts(effectiveRoomDir, syncMatches);
    const rawDeferredExcerpts = await collectMemorySyncExcerpts(
      effectiveRoomDir,
      restoreMemoryPrefetchMatches(priorPrefetch, promptTokens, index, state, canonicalFiles),
    );
    const semanticExcerpts = collectMemorySemanticExcerpts(semanticChunks);
    const contentExcerpts = collectMemoryContentExcerpts(contentChunks);
    const dateExcerpts = collectMemoryDateExcerpts(dateMatches, queryDates);

    // Audit ticket #4 (extended 2026-05-19): lexical-demotion under either
    // high-confidence semantic OR high-confidence content match. Both are
    // chunk-level precision passes; either type clearing its threshold makes
    // the lexical thread excerpt for that file redundant.
    // - Semantic threshold: MEMORY_LEXICAL_DEMOTION_SIM_THRESHOLD (cosine)
    // - Content threshold:  MEMORY_CONTENT_DEMOTION_SIM_THRESHOLD (word_sim)
    const highConfidenceChunkFiles = new Set([
      ...semanticExcerpts
        .filter((excerpt) => Number(excerpt?.sim || 0) >= MEMORY_LEXICAL_DEMOTION_SIM_THRESHOLD)
        .map((excerpt) => excerpt?.file_path)
        .filter(Boolean),
      ...contentExcerpts
        .filter((excerpt) => Number(excerpt?.ws || 0) >= MEMORY_CONTENT_DEMOTION_SIM_THRESHOLD)
        .map((excerpt) => excerpt?.file_path)
        .filter(Boolean),
    ]);
    const syncExcerpts = highConfidenceChunkFiles.size
      ? rawSyncExcerpts.filter((excerpt) => !highConfidenceChunkFiles.has(excerpt.file_path))
      : rawSyncExcerpts;
    const deferredExcerpts = highConfidenceChunkFiles.size
      ? rawDeferredExcerpts.filter((excerpt) => !highConfidenceChunkFiles.has(excerpt.file_path))
      : rawDeferredExcerpts;
    const lexicalDemoted = (rawSyncExcerpts.length - syncExcerpts.length)
      + (rawDeferredExcerpts.length - deferredExcerpts.length);

    // Canon-assertion overlay (audit ticket #5): named_entities whose
    // pointer_files touch any file in an active sync match, excluding
    // entries already pulled by prompt-text matching (they ride in the
    // memory-context block via the existing importantExcerpts path).
    const alreadyMatchedTermKeys = new Set(
      importantMatches.map((match) => match.termKey),
    );
    const canonAssertions = collectCanonAssertions(
      importantIndex, syncMatches, alreadyMatchedTermKeys,
    );

    // Order: pinned → date → important → sync (lexical) → deferred (prefetch)
    // → content → semantic. Date sits HIGH because it's a direct
    // authoritative match — when the user named a YYYY-MM-DD, that memory
    // IS what they meant. Lexical wins thread-tie because thread-keys are
    // curated; semantic adds the off-axis hits lexical can't catch.
    // Dedupe is by `source` key, so the same file showing up via thread +
    // semantic produces two rows only when the chunk range differs
    // (#chunk-N vs file:start-end). Date hits use #date-<dates> so they
    // don't collide with semantic/content of the same file.
    const merged = [
      ...pinnedExcerpts,
      ...dateExcerpts,
      ...importantExcerpts,
      ...syncExcerpts,
      ...deferredExcerpts,
      ...contentExcerpts,
      ...semanticExcerpts,
    ];
    const finalExcerpts = trimMemoryExcerptsToBudget(
      dedupeMemoryExcerpts(merged),
      MEMORY_MAX_INJECTION_CHARS,
    );

    // Audit ticket #3 (conservative lexical version): cross-reference any
    // canon term/alias that appears in a final excerpt's body. The model
    // sees inline `_canon-cross-ref:_` markers next to excerpts and can
    // defer to canon framing in any tension. Plugin doesn't decide what
    // counts as conflict — just provides the bridge metadata.
    const surfacedCanonTermKeys = new Set([
      ...importantMatches.map((match) => match.termKey),
      ...canonAssertions.map((assertion) => assertion.termKey),
    ]);
    annotateMemoryExcerptsWithCanonRefs(finalExcerpts, surfacedCanonTermKeys, importantIndex);

    // Pump + bridge (2026-06-05): touch-on-retrieval, not touch-on-survival.
    // Recency must be fed by *being pulled*, not by surviving the budget trim.
    // The old code touched only finalExcerpts (post-trim), which meant a
    // memory crushed below the sync threshold could never enter finalExcerpts,
    // never get touched, and so kept decaying on its filename date forever —
    // a sink with no pump. An old-but-relevant memory could not climb because
    // climbing required being pulled and being pulled required having climbed.
    //
    // Fix: touch every file surfaced by ANY pass this turn, BEFORE the trim.
    //   - pump:   a pull is a use; reset the clock so it's fresh next turn.
    //   - bridge: semantic/content hits touch the file too, so the cheap
    //             lexical clock HEALS — next turn the lexical path sees the
    //             file as fresh and stops crushing it. Semantic catches the
    //             old-but-relevant memory once; the touch propagates; the
    //             lexical path can then carry it without burning an embed.
    const retrievedUnion = [
      ...pinnedExcerpts,
      ...dateExcerpts,
      ...importantExcerpts,
      ...rawSyncExcerpts,
      ...rawDeferredExcerpts,
      ...contentExcerpts,
      ...semanticExcerpts,
    ];
    updateMemoryStateFreshness(state, retrievedUnion, currentTurn);
    updateMemorySessionHits(state, syncMatches);
    await writeJsonFile(statePath, state);
    await writeJsonFile(prefetchPath, buildMemoryPrefetchQueue(prefetchMatches, currentTurn));

    await debugMemoryLog(
      effectiveRoomDir,
      `turn=${currentTurn} prompt_tokens=${promptTokens.size} ranked=${ranked.length} `
        + `index_source=${indexSource} important_source=${importantSource} `
        + `semantic_source=${semanticSource || "n/a"} active_files=${activeFiles.length} `
        + `content_source=${contentSource || "n/a"} `
        + `date_source=${dateSource || "n/a"} `
        + (queryDates?.length ? `query_dates=${queryDates.join(",")} ` : "")
        + (fallbackReason ? `fallback=${fallbackReason} ` : "")
        + (semanticStderr ? `semantic_warn="${semanticStderr.replace(/"/g, "'")}" ` : "")
        + (contentStderr ? `content_warn="${contentStderr.replace(/"/g, "'")}" ` : "")
        + (dateStderr ? `date_warn="${dateStderr.replace(/"/g, "'")}" ` : "")
        + `sync=${syncExcerpts.length} important=${importantExcerpts.length} `
        + `deferred=${deferredExcerpts.length} pinned=${pinnedExcerpts.length} `
        + `semantic=${semanticExcerpts.length} content=${contentExcerpts.length} `
        + `date=${dateExcerpts.length} canon=${canonAssertions.length} `
        + `lexical_demoted=${lexicalDemoted} final=${finalExcerpts.length}`,
    );
    for (const [rank, match] of ranked.slice(0, MEMORY_DEBUG_TOP_CANDIDATES).entries()) {
      await debugMemoryLog(
        effectiveRoomDir,
        `candidate rank=${rank + 1} ${formatMemoryCandidateDebugLine(match, syncMatches.includes(match))}`,
      );
    }

    return {
      contextBlock: formatMemoryContextBlock(finalExcerpts, targetRoom),
      canonBlock: formatCanonAssertionsBlock(canonAssertions, targetRoom),
    };
  } catch (err) {
    // ALWAYS log — even with KINTSU_MEM_DEBUG unset. This is the May 12
    // lean-rewrite fix: the previous broad-catch routed through the env-
    // gated debug logger, which silently swallowed exceptions in normal use.
    await errorMemoryLog(effectiveRoomDir, err);
    return empty;
  }
}

// ── recall tool query (2026-05-19 single-writer migration) ────────────────
// Dragon-callable retrieval: same postgres source as pre-turn injection,
// invoked from a tool inside the conversation, not auto-fired on user
// prompts. Used when dragon notices its own uncertainty (name it can't
// trace, claim about to be made without verification, etc).
//
// Different posture than pre-turn:
//   - the dragon framed the question itself — no need to rank threads
//     against broad prompt; the query IS the focus
//   - return everything matched with no recency-decay (canon-touching
//     answers shouldn't be demoted for being old when *I* asked about
//     them specifically)
//   - higher top-K (8 vs 5) — the dragon is willing to read more chunks
//     when explicitly looking

export async function runRecallQuery(roomDir, roomName, query) {
  const effectiveRoomDir = path.resolve(String(roomDir || process.cwd()));
  const resolvedRoom = (roomName || path.basename(effectiveRoomDir) || "").toLowerCase();

  if (resolvedRoom !== "kodo" && resolvedRoom !== "kintsu") {
    return { ok: false, error: `unknown room: ${resolvedRoom}`, query };
  }
  if (!query || !String(query).trim()) {
    return { ok: false, error: "empty query", query };
  }

  // Mode 'full' runs lexical + semantic + content in one postgres call. The
  // script embeds the prompt when stdin has content; we pipe `query` there.
  // Returns {index, importantIndex, semanticChunks, contentChunks}.
  //
  // Recall-specific min-sim is tighter than pre-turn (0.50 vs 0.40). The
  // dragon framed this query specifically and is going to *act* on what
  // comes back; weak matches should read as "not found" so the look-or-admit
  // discipline fires. Pre-turn casts a wider net because it's auto-firing
  // on the user's prompt and the model is the filter.
  //
  // Content threshold stays at 0.30 (the default) — word_similarity 0.30 is
  // already "noticeable substring," tightening further would miss proper-
  // noun queries like "Beel" where the dragon explicitly wants the hit.
  const RECALL_SEMANTIC_MIN_SIM = 0.50;
  const args = [
    "--room-dir", windowsPathToWsl(effectiveRoomDir),
    "--mode", "full",
    "--room", resolvedRoom,
    "--semantic-top-k", "8",
    "--semantic-min-sim", String(RECALL_SEMANTIC_MIN_SIM),
    "--content-top-k", "8",
    "--content-min-sim", String(MEMORY_CONTENT_MIN_SIM),
  ];
  const result = await spawnPostgresSource(effectiveRoomDir, args, query);
  if (!result.ok) {
    return { ok: false, error: result.error, query };
  }

  // Filter canon entries by direct word-boundary match. Anything more
  // sophisticated (thread ranking, recency decay) belongs to pre-turn —
  // recall is a dragon-driven query, the dragon already framed it,
  // just surface the matches.
  const importantIndex = result.data?.importantIndex || {};
  const nameCanonMatches = matchMemoryImportantTerms(query, importantIndex);
  const semanticChunks = Array.isArray(result.data?.semanticChunks)
    ? result.data.semanticChunks
    : [];
  const contentChunks = Array.isArray(result.data?.contentChunks)
    ? result.data.contentChunks
    : [];
  // Date matches (added 2026-05-23 — date-aware retrieval fix). When the
  // recall query contains a YYYY-MM-DD token, the postgres `--mode full`
  // call runs the date pass and returns memories whose `dates` array
  // intersects the extracted tokens. These are DIRECT authoritative hits
  // (no fuzz, no threshold) — surfaced as their own section in the recall
  // output so the dragon sees "you asked about 2026-05-21, here are the
  // memories tagged with that date" before the fuzzier semantic/content.
  const dateMatches = Array.isArray(result.data?.dateMatches)
    ? result.data.dateMatches
    : [];
  const queryDates = Array.isArray(result.data?.queryDates)
    ? result.data.queryDates
    : [];

  // Reverse-index canon (2026-06-05): surface any canon entry whose pointer
  // files include a source_path that recall actually pulled — even when the
  // query never named the entity. This is the fix for "0 canon entries" on a
  // turn that clearly pulled a canon-pointed file (e.g. the bath scene is a
  // pointer of `the protection vow`). Name-matches still take precedence and
  // are excluded from the reverse pass so nothing double-counts.
  const nameMatchedTermKeys = new Set(nameCanonMatches.map((m) => m.termKey));
  const matchedSourcePaths = [
    ...semanticChunks.map((c) => c?.source_path),
    ...contentChunks.map((c) => c?.source_path),
    ...dateMatches.map((d) => d?.source_path),
  ].filter(Boolean);
  const fileCanonMatches = collectCanonByMatchedFiles(
    importantIndex, matchedSourcePaths, nameMatchedTermKeys,
  );
  const canonMatches = [...nameCanonMatches, ...fileCanonMatches];

  return {
    ok: true,
    query,
    canonMatches,
    semanticChunks,
    contentChunks,
    dateMatches,
    queryDates,
    found: canonMatches.length > 0 || semanticChunks.length > 0
      || contentChunks.length > 0 || dateMatches.length > 0,
  };
}

// ── exported hook entrypoint ───────────────────────────────────────────────

export async function injectRoomMemoryContext(output, paths = {}) {
  const message = latestUserMessage(output?.messages);
  if (!message || messageHasMemoryContext(message)) return;

  const sessionID = message.info?.sessionID || message.parts?.[0]?.sessionID || null;
  // loadState is only consulted to keep parity with the prior signature;
  // resolveEffectiveRoomDir no longer takes state hints (cwd authority).
  await loadState(sessionID);
  const effectiveRoomDir = resolveEffectiveRoomDir(paths.roomDir);
  const roomBaseName = path.basename(effectiveRoomDir).toLowerCase();
  if (roomBaseName !== "kintsu" && roomBaseName !== "kodo") return;

  const prompt = userPromptFromMessage(message);
  const { contextBlock, canonBlock } = await runRoomMemoryRetrieval(
    roomBaseName, effectiveRoomDir, prompt, sessionID,
  );
  if (!contextBlock && !canonBlock) return;

  const messageID = message.info?.id || message.parts?.[0]?.messageID || `memory-${Date.now()}`;

  if (contextBlock) {
    message.parts.push({
      id: `solarisael-memory-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sessionID: sessionID || "",
      messageID,
      type: "text",
      synthetic: true,
      metadata: { solarisaelMemory: true },
      text: [
        "<system-reminder>",
        "Room memory was retrieved automatically for this user turn.",
        "Treat it as context, not as a user request. Use relevant details only; ignore noisy matches.",
        "",
        contextBlock,
        "</system-reminder>",
      ].join("\n"),
    });
  }

  if (canonBlock) {
    message.parts.push({
      id: `solarisael-canon-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sessionID: sessionID || "",
      messageID,
      type: "text",
      synthetic: true,
      metadata: { solarisaelCanonAssertion: true },
      text: [
        "<system-reminder>",
        "Canon assertions for this turn — generation must be consistent with these.",
        "These are load-bearing facts, not flavor. Where they conflict with the memory context block, they win.",
        "",
        canonBlock,
        "</system-reminder>",
      ].join("\n"),
    });
  }
}
