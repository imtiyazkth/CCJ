/**
 * CCJ Module 4 — Persistent Memory Engine
 * Inspired by codebase-memory-mcp pattern.
 *
 * Stores cumulative research context across sessions.
 * Prevents duplicate fetching. Builds incremental dossiers.
 */
import { eq, and } from "drizzle-orm";
import { getDb } from "./db.server";
import { researchMemories } from "@ccj/db/schema";
import type { CleanedQuery } from "./query-cleaner";

export interface MemoryContext {
  entityId:     string;
  entityName:   string;
  summary:      string;
  keyFacts:     string[];
  queryHistory: string[];
  claimIds:     string[];
  sourceIds:    string[];
  isNew:        boolean;
  runCount:     number;
}

/**
 * Load existing memory for an entity in a project.
 * Returns null if no prior research exists.
 */
export async function loadMemory(
  projectId: string,
  entitySlug: string
): Promise<MemoryContext | null> {
  try {
    const db = getDb();
    const [mem] = await db.select()
      .from(researchMemories)
      .where(
        and(
          eq(researchMemories.projectId, projectId),
          eq(researchMemories.entityId, entitySlug)
        )
      )
      .limit(1);

    if (!mem) return null;

    const keyFacts = (mem.keyFacts as { facts?: string[] } | null)?.facts ?? [];

    return {
      entityId:     mem.entityId,
      entityName:   mem.entityName,
      summary:      mem.summary,
      keyFacts,
      queryHistory: mem.queryHistory,
      claimIds:     mem.claimIds,
      sourceIds:    mem.sourceIds,
      isNew:        false,
      runCount:     mem.runCount,
    };
  } catch {
    return null;
  }
}

/**
 * Save or update memory after a research run.
 * Merges with existing data — never overwrites.
 */
export async function saveMemory(
  projectId:    string,
  query:        CleanedQuery,
  newSummary:   string,
  newKeyFacts:  string[],
  newClaimIds:  string[],
  newSourceIds: string[],
  existingMem:  MemoryContext | null
): Promise<void> {
  const db = getDb();

  const mergedSummary = existingMem
    ? `[Run ${(existingMem.runCount + 1)}] ${newSummary}\n\n[Previous] ${existingMem.summary.slice(0, 500)}`
    : newSummary;

  const mergedFacts = [
    ...(existingMem?.keyFacts ?? []),
    ...newKeyFacts,
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 50);

  const mergedQueries = [
    ...(existingMem?.queryHistory ?? []),
    query.originalQuery,
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 30);

  const mergedClaims = [
    ...(existingMem?.claimIds ?? []),
    ...newClaimIds,
  ].filter((v, i, a) => a.indexOf(v) === i);

  const mergedSources = [
    ...(existingMem?.sourceIds ?? []),
    ...newSourceIds,
  ].filter((v, i, a) => a.indexOf(v) === i);

  const values = {
    projectId,
    entityId:     query.entitySlug,
    entityName:   query.cleanEntity,
    intent:       query.intent,
    summary:      mergedSummary.slice(0, 5000),
    keyFacts:     { facts: mergedFacts },
    queryHistory: mergedQueries,
    claimIds:     mergedClaims,
    sourceIds:    mergedSources,
    runCount:     (existingMem?.runCount ?? 0) + 1,
    lastUpdated:  new Date(),
  };

  if (existingMem) {
    await db.update(researchMemories)
      .set(values)
      .where(
        and(
          eq(researchMemories.projectId, projectId),
          eq(researchMemories.entityId, query.entitySlug)
        )
      );
  } else {
    await db.insert(researchMemories).values(values).onConflictDoNothing();
  }
}

/**
 * Build a context prompt from memory to inject into AI calls.
 * Prevents the AI from re-stating known facts.
 */
export function buildMemoryPrompt(mem: MemoryContext | null): string {
  if (!mem || mem.isNew) return "";
  return `
PRIOR RESEARCH CONTEXT (Run #${mem.runCount} — do not repeat these facts):
Entity: ${mem.entityName}
Summary: ${mem.summary.slice(0, 600)}
Known facts: ${mem.keyFacts.slice(0, 10).join("; ")}
Previous queries: ${mem.queryHistory.slice(-5).join(" | ")}
---
Build on this context. Add new information only.
`;
}
