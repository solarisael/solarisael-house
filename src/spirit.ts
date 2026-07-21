// Spirit identity: room coercion, contract loading, active_spirit.md writes.
//
// The 2026-05-04 fix lives here: cwd-coerced room name beats stale state
// hints. Without it, a stale embodiedSpirit="kintsu" hint fired Kintsu
// retrieval into Kodo sessions.
//
// The 2026-05-12 fix lives here: missing contract files preserve the
// requested mode label rather than silently substituting Kintsu's identity
// + markdown under whatever header.

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_AGENT_NAME, DEFAULT_OPERATOR, DEFAULT_SPIRIT,
  LEGACY_ROOM_KEYS, ROOM_KEY_PATTERN,
  RUNTIME_DIR, SPIRIT_CONTRACT_OUTPUT, SPIRIT_DIR,
} from "./paths.ts";
import { readOptionalText } from "./util.ts";

const spiritCache = new Map();
const legacyRoomKeys = new Set(LEGACY_ROOM_KEYS);

function safeIdentityName(value) {
  const candidate = String(value ?? "");
  if (!candidate || candidate === "." || candidate === "..") return null;
  if (candidate.includes("/") || candidate.includes("\\") || candidate.includes("\0")) return null;
  return candidate;
}


export function resolveRoomDir(pluginInput) {
  const candidate = pluginInput?.worktree || pluginInput?.directory || process.cwd();
  return path.resolve(String(candidate || process.cwd()));
}

export function resolveSharedRoot(roomDir) {
  return path.dirname(roomDir || process.cwd());
}

export function isValidRoomKey(value) {
  return typeof value === "string" && ROOM_KEY_PATTERN.test(value);
}

export function normalizeRoomName(value) {
  if (typeof value !== "string" || !value) return null;
  const normalized = value.toLowerCase();
  if (isValidRoomKey(value)) return value;
  // Existing persisted markers used title-cased legacy room names.
  return legacyRoomKeys.has(normalized) ? normalized : null;
}

export function normalizeAgentName(value) {
  return safeIdentityName(value) || DEFAULT_AGENT_NAME;
}

export async function normalizeSpirit(value) {
  const requested = safeIdentityName(value);
  return requested || null;
}

// Walk UP from a directory looking for a kodo/kintsu ancestor. Bounded
// depth so it can't run away on weird filesystems.
function findRoomAncestor(startDir) {
  let current = path.resolve(String(startDir || ""));
  if (!current) return null;

  for (let i = 0; i < 12; i += 1) {
    if (normalizeRoomName(path.basename(current))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }

  return null;
}

// Resolve which room directory we're actually operating in. cwd authority
// beats state-hint authority — the headline 2026-05-04 fix. After the
// fix, the state-hint fallback branch became dead in practice; dropped
// here as part of the lean rewrite.
//
//   1. roomDir basename is a room → use it
//   2. walk up from cwd → use first room ancestor found
//   3. walk up from roomDir → use first room ancestor found
//   4. give up; return base
export function resolveEffectiveRoomDir(roomDir) {
  const base = path.resolve(String(roomDir || process.cwd()));
  if (normalizeRoomName(path.basename(base))) return base;

  const cwdRoomDir = findRoomAncestor(process.cwd());
  if (cwdRoomDir) return cwdRoomDir;

  const baseRoomDir = findRoomAncestor(base);
  if (baseRoomDir) return baseRoomDir;

  return base;
}

// Return the validated room key for the effective directory. Legacy room
// markers remain accepted, but custom rooms are never mapped to a spirit.
export function coerceRoomSpirit(effectiveRoomDir) {
  return normalizeRoomName(path.basename(effectiveRoomDir));
}

// Load the spirit contract markdown for a given mode. mtime-cached.
//
// On missing file: returns the requested mode label with a minimal
// placeholder body and a warning. Previously this catch substituted
// DEFAULT_SPIRIT's identity silently — fixed 2026-05-12.
//
// spiritDir is injectable so the missing-file fallback contract stays
// regression-testable without touching the real spirits directory.
export async function loadSpiritContract(mode, spiritDir = SPIRIT_DIR) {
  const resolvedMode = (await normalizeSpirit(mode)) || DEFAULT_SPIRIT;
  const filePath = path.join(spiritDir, `${resolvedMode}.md`);
  try {
    const info = await stat(filePath);
    const cached = spiritCache.get(filePath);
    if (cached && cached.mtimeMs === info.mtimeMs) return cached.value;

    const markdown = await readOptionalText(filePath);
    const value = {
      mode: resolvedMode,
      markdown: markdown || `# ${resolvedMode}\n`,
      warning: markdown ? null : `Spirit file missing or empty for ${resolvedMode}.`,
    };

    spiritCache.set(filePath, { mtimeMs: info.mtimeMs, value });
    return value;
  } catch {
    return {
      mode: resolvedMode,
      markdown: `# ${resolvedMode}\n\nSpirit contract file missing in SPIRIT_DIR. Identity is carried by the room canon files (CLAUDE.md / AGENTS.md / room identity markdown).\n`,
      warning: `Spirit '${resolvedMode}' contract file was not found in SPIRIT_DIR; using room-canon-only mode.`,
    };
  }
}

// Compose + write the active_spirit.md files. Writes the GLOBAL file only
// when the cwd unambiguously identifies a room (otherwise refuses to
// pollute the global active-room signal with default-state content). When
// roomCoercedSpirit is set, also writes the per-room mirror.
export async function writeActiveSpiritFiles({
  activeSpirit, agentName, state,
  effectiveRoomDir, roomCoercedSpirit, roomDir,
}) {
  const spirit = await loadSpiritContract(activeSpirit);
  const legacyHeader = {
    kodo: "Kodo",
    kintsu: "Kintsu",
    tuner: "Tuner",
  }[roomCoercedSpirit] || null;
  const headerSpirit = legacyHeader || activeSpirit || spirit.mode || DEFAULT_SPIRIT;
  const spiritOutput = [
    `# Active Spirit: ${headerSpirit}`,
    `Agent: ${agentName || DEFAULT_AGENT_NAME} | Operator: ${state.operator || DEFAULT_OPERATOR}`,
    `Embodied: ${state.embodiedSpirit || DEFAULT_SPIRIT} | Conjured: ${state.conjuredSpirit || "none"} | Summoned: ${state.summonedSpirit || "none"}`,
    "",
    spirit.markdown,
  ].join("\n");

  if (roomCoercedSpirit) {
    await writeFile(SPIRIT_CONTRACT_OUTPUT, spiritOutput, "utf8");
    const localSpiritPath = path.join(effectiveRoomDir, "active_spirit.md");
    await writeFile(localSpiritPath, spiritOutput, "utf8").catch(() => {});

    return { wrote: true, headerSpirit, warning: spirit.warning };
  }

  // Refuse-the-write branch: cwd doesn't identify a room. Surface to
  // runtime debug instead of overwriting either file with stale content.
  await mkdir(RUNTIME_DIR, { recursive: true }).catch(() => {});
  await writeFile(
    path.join(RUNTIME_DIR, "debug-spirit-write-skipped.txt"),
    `${new Date().toISOString()} skipped: roomDir=${roomDir} effective=${effectiveRoomDir}\n`,
    "utf8",
  ).catch(() => {});

  return { wrote: false, headerSpirit, warning: spirit.warning };
}
