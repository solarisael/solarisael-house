// Standalone test for runRecallQuery — validates the full retrieval flow
// (semantic + content + canon) after 2026-05-19 GIN-content-pass addition.
// NOT a plugin file — opencode auto-loads index.ts, not loose .ts files
// in subdirectory plugins. Safe to leave here or remove after migration
// verified.
//
// Run with: bun run test_recall.ts

import { runRecallQuery } from "./memory.ts";

const TESTS = [
  {
    name: "ya bai canon — should hit canon + semantic + content",
    query: "ya bai rebis conspiracy filter",
  },
  {
    name: "BEEL — the previously-blind case, should now surface April 14 audience",
    query: "Beel audience contractor concordat",
  },
  {
    name: "Beel alone — proper-noun-only query, the cleanest content test",
    query: "Beel",
  },
  {
    name: "no-match — wagyu, should return found:false",
    query: "wagyu beef recipe with truffle butter",
  },
];

const ROOM_DIR = "C:\\Solarisael\\Obsidian\\obsidian\\kodo";

for (const t of TESTS) {
  console.log("=".repeat(78));
  console.log("TEST:", t.name);
  console.log("query:", t.query);
  const result = await runRecallQuery(ROOM_DIR, "kodo", t.query);
  if (!result.ok) {
    console.log("  ERROR:", result.error);
    continue;
  }
  console.log("  found:", result.found);
  console.log("  canon matches:", result.canonMatches?.length || 0);
  console.log("  semantic chunks:", result.semanticChunks?.length || 0);
  console.log("  content chunks:", result.contentChunks?.length || 0);
  if (result.canonMatches?.length) {
    console.log("  canon:");
    for (const m of result.canonMatches.slice(0, 3)) {
      const summary = (m.entry?.summary || "").slice(0, 60).replace(/\s+/g, " ");
      console.log(`    - ${m.termKey}: ${summary}...`);
    }
  }
  if (result.contentChunks?.length) {
    console.log("  top content (pg_trgm word_similarity):");
    for (const c of result.contentChunks.slice(0, 4)) {
      const ws = Number(c.ws || 0).toFixed(3);
      const src = String(c.source_path || "").split("/").pop();
      console.log(`    - ws=${ws} ${src}  | ${c.heading_path}`);
    }
  }
  if (result.semanticChunks?.length) {
    console.log("  top semantic (halfvec cosine):");
    for (const c of result.semanticChunks.slice(0, 3)) {
      const sim = Number(c.sim || 0).toFixed(3);
      const src = String(c.source_path || "").split("/").pop();
      console.log(`    - sim=${sim} ${src}  | ${c.heading_path}`);
    }
  }
}

console.log("=".repeat(78));
console.log("done.");
