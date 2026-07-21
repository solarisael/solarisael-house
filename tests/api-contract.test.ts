import { describe, expect, test } from "bun:test";
import {
  CORE_API_VERSION,
  logAssistantTurn,
  logUserTurn,
  runAnamnesisQuery,
  runRecallQuery,
} from "../index.ts";

describe("core public API", () => {
  test("exports the versioned memory and ledger contract from the package root", () => {
    expect(CORE_API_VERSION).toBe(1);
    expect(typeof runAnamnesisQuery).toBe("function");
    expect(typeof runRecallQuery).toBe("function");
    expect(typeof logUserTurn).toBe("function");
    expect(typeof logAssistantTurn).toBe("function");
  });
});
