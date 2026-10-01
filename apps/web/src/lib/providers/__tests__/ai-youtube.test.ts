import { describe, it, expect, beforeEach, vi } from "vitest";

// Ensure no provider keys are present so these tests exercise the
// deterministic, non-fabricating fallback paths (no network calls made).
beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
});

import {
  verifyClaimsAgainstSources,
  extractYoutubeClaims,
  generateCreatorScript,
  type ScriptResearchInput,
} from "../ai";

describe("verifyClaimsAgainstSources — fallback safety", () => {
  it("never marks a claim 'Supported' when no AI provider is available", async () => {
    const results = await verifyClaimsAgainstSources(
      ["More than 80 people died."],
      []
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.verdict).toBe("Unverified");
    expect(results[0]?.confidence).toBe(0);
  });

  it("still returns Unverified even when independent sources are provided but no provider can process them", async () => {
    const results = await verifyClaimsAgainstSources(
      ["The government promised new embankments."],
      [{ sourceName: "The Hindu", excerpt: "Officials announced embankment repairs after the flood." }]
    );
    expect(results[0]?.verdict).toBe("Unverified");
  });

  it("returns [] for an empty claim list", async () => {
    expect(await verifyClaimsAgainstSources([], [])).toEqual([]);
  });
});

describe("extractYoutubeClaims — fallback safety", () => {
  it("returns [] rather than inventing claims when no provider is available", async () => {
    const claims = await extractYoutubeClaims("Some transcript text about floods.", 0, "Test video");
    expect(claims).toEqual([]);
  });
});

describe("generateCreatorScript — fallback safety", () => {
  const baseInput: ScriptResearchInput = {
    topic: "Assam floods 2026",
    coreConclusion: "Multiple factors contribute to annual flooding.",
    verifiedClaims: [{ id: "c1", claim: "The Brahmaputra floods seasonally.", verdict: "strongly_correlated" }],
    unverifiedClaims: [{ id: "c2", claim: "More than 80 people died." }],
    disputedClaims: [{ id: "c3", claim: "856 villages were submerged.", sides: "Source A says 856, Source B says 700." }],
    timelineEvents: [{ date: "2026-07", event: "Major flooding reported in Sivasagar." }],
    researchGaps: [{ description: "No original government casualty report was located." }],
  };

  it("builds a script directly from structured data without AI, attributing unverified claims", async () => {
    const script = await generateCreatorScript(baseInput, "explainer", "en");
    expect(script.title).toBe(baseInput.topic);

    const unverifiedSection = script.sections.find(s => s.heading === "WHAT THE SOURCE CLAIMS (UNVERIFIED)");
    expect(unverifiedSection).toBeDefined();
    expect(unverifiedSection?.narration).toContain("The source claims:");
    expect(unverifiedSection?.narration).toContain("More than 80 people died.");

    const disputedSection = script.sections.find(s => s.heading === "WHAT IS DISPUTED");
    expect(disputedSection?.narration).toContain("856 villages were submerged.");

    expect(script.disclaimer.length).toBeGreaterThan(0);
  });

  it("never presents an unverified claim as settled fact in the fallback path", async () => {
    const script = await generateCreatorScript(baseInput, "explainer", "en");
    const unverifiedSection = script.sections.find(s => s.heading === "WHAT THE SOURCE CLAIMS (UNVERIFIED)");
    expect(unverifiedSection?.narration.startsWith("The source claims:")).toBe(true);
    // The verified-claims section must exist and be distinct from the
    // unverified section, keeping the two layers separated as required.
    const verifiedSection = script.sections.find(s => s.heading === "WHAT IS VERIFIED");
    expect(verifiedSection).toBeDefined();
    expect(verifiedSection?.narration).toContain("Brahmaputra");
  });
});
