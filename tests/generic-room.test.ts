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
  test("accepts arbitrary safe room keys and rejects unsafe keys", () => {
    expect(isValidRoomKey("aurora-lab")).toBe(true);
    expect(normalizeRoomName("aurora-lab")).toBe("aurora-lab");
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
});
