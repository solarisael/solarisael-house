import { describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  coerceRoomSpirit,
  isValidRoomKey,
  normalizeRoomName,
  resolveEffectiveRoomDir,
} from "../src/spirit.ts";
import { resolveLiveContextTargets } from "../src/ledger.ts";
import { computeContextNudge } from "../src/triggers-core.ts";
import { resolveSubstrateDir } from "../src/paths.ts";


let observedPostgresArgv;
mock.module("../src/wsl.ts", () => ({
  windowsPathToWsl: (value) => String(value),
  runWsl: async ({ argv }) => {
    observedPostgresArgv = argv;
    return {
      timedOut: false,
      spawnError: null,
      code: 0,
      stdout: JSON.stringify({ index: { files: {}, threads: {} } }),
      stderr: "",
    };
  },
}));

describe("generic room keys", () => {
  test("accepts arbitrary safe room keys and rejects unsafe or reserved keys", () => {
    expect(isValidRoomKey("aurora-lab")).toBe(true);
    expect(normalizeRoomName("aurora-lab")).toBe("aurora-lab");
    expect(isValidRoomKey("house")).toBe(false);
    expect(normalizeRoomName("house")).toBe(null);
    expect(isValidRoomKey("Aurora-Lab")).toBe(false);
    expect(normalizeRoomName("Aurora-Lab")).toBe(null);
    expect(normalizeRoomName("aurora_lab")).toBe(null);
    expect(normalizeRoomName("../aurora")).toBe(null);
  });

  test("keeps only explicit legacy marker compatibility", () => {
    expect(normalizeRoomName("Kintsu")).toBe("kintsu");
    expect(normalizeRoomName("Tuner")).toBe("tuner");
    expect(normalizeRoomName("Aurora")).toBe(null);
  });

  test("resolves custom room directories without mapping them to a legacy spirit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "solarisael-room-"));
    const roomDir = path.join(root, "aurora-lab");
    try {
      expect(resolveEffectiveRoomDir(roomDir)).toBe(roomDir);
      expect(coerceRoomSpirit(roomDir)).toBe("aurora-lab");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fails closed for invalid or missing explicit room paths", () => {
    expect(resolveEffectiveRoomDir("")).toBe(null);
    expect(resolveEffectiveRoomDir(path.join(tmpdir(), "not a room"))).toBe(null);
    expect(resolveEffectiveRoomDir(path.join(tmpdir(), "house"))).toBe(null);
  });

  test("enables live context for marker-backed custom rooms", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "solarisael-live-"));
    const roomDir = path.join(root, "aurora-lab");
    try {
      await mkdir(roomDir, { recursive: true });
      await writeFile(path.join(root, "shared_current_state.md"), "# shared\n", "utf8");
      const targets = await resolveLiveContextTargets(roomDir);
      expect(targets).toMatchObject({ roomName: "aurora-lab" });
      expect(targets.markdownPath).toBe(path.join(roomDir, "current_session_context.md"));
      expect(targets.jsonPath).toBe(path.join(roomDir, "current_session_context.json"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("forwards the exact custom room to Postgres", async () => {
    const { loadMemoryLexicalSources } = await import("../src/memory-sources.ts");
    observedPostgresArgv = null;
    await loadMemoryLexicalSources("/tmp/aurora-lab", "aurora-lab", "blue hinge");
    expect(observedPostgresArgv).toContain("--room");
    const roomIndex = observedPostgresArgv.indexOf("--room");
    expect(observedPostgresArgv[roomIndex + 1]).toBe("aurora-lab");
  });

  test("nudges arbitrary valid rooms with neutral context defaults", () => {
    const decision = computeContextNudge({
      room: "aurora-lab",
      messages: [{
        role: "user",
        textParts: ["x".repeat(160_000)],
        toolCalls: [],
        toolResults: [],
        injections: [],
      }],
    });
    expect(decision).toMatchObject({ band: 1, tokens: 40_000, pct: 10 });
  });

  test("fails closed for invalid or reserved nudge rooms", () => {
    const messages = [{
      role: "user",
      textParts: ["x".repeat(160_000)],
      toolCalls: [],
      toolResults: [],
      injections: [],
    }];
    expect(computeContextNudge({ room: "house", messages })).toBe(null);
    expect(computeContextNudge({ room: "not a room", messages })).toBe(null);
  });

  test("rejects relative substrate overrides", () => {
    const prior = process.env.SOLARISAEL_SUBSTRATE;
    process.env.SOLARISAEL_SUBSTRATE = "relative/substrate";
    try {
      expect(() => resolveSubstrateDir(path.join(tmpdir(), "aurora-lab"))).toThrow(/absolute path/);
    } finally {
      if (prior === undefined) delete process.env.SOLARISAEL_SUBSTRATE;
      else process.env.SOLARISAEL_SUBSTRATE = prior;
    }
  });
});
