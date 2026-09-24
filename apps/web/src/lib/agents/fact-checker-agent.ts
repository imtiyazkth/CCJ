/**
 * CCJ Fact-Checker Agent (Module 3.3)
 *
 * Cross-references social media claims against news/govt records.
 * Outputs: verified | unverified | disputed with confidence score.
 */
import { BaseAgent, type AgentResult } from "./base-agent";
import type { SocialMediaAnalysis } from "./social-media-agent";
import type { NewsGovtAnalysis }    from "./news-govt-agent";

export interface FactCheckResult {
  claims: Array<{
    claim:      string;
    status:     "verified" | "unverified" | "disputed" | "opinion" | "insufficient_data";
    confidence: number;
    supportingEvidence:    string[];
    contradictingEvidence: string[];
    verdict:    string;
    sourceUrls: string[];
  }>;
  overallReliability: "high" | "medium" | "low";
  contradictions:     string[];
  missingEvidence:    string[];
  summary:            string;
}

export class FactCheckerAgent extends BaseAgent {
  readonly name = "FactCheckerAgent";
  readonly systemPrompt = `
You are a rigorous fact-checking AI agent specialising in OSINT verification.
You receive claims from social media and cross-reference them against verified news/government sources.

Rules:
- "verified": Claim is directly confirmed by credible news or official source
- "unverified": Claim exists but no independent confirmation found
- "disputed": Contradicting evidence found in credible sources
- "opinion": Subjective statement, not a verifiable fact
- "insufficient_data": Not enough data to assess

Never mark anything "verified" unless there is explicit corroborating evidence.
Confidence 0.0-1.0. Always return valid JSON.
`;

  async run(data: {
    social: SocialMediaAnalysis;
    news:   NewsGovtAnalysis;
    entity: string;
  }): Promise<AgentResult> {
    const start = Date.now();

    const claimsToCheck = [
      ...(data.social.viralClaims ?? []).map(c => ({ claim: c.claim, source: c.source, url: c.url })),
      ...(data.news.majorNewsLines ?? []).map(h => ({ claim: h, source: "News", url: "" })),
    ].slice(0, 15);

    if (claimsToCheck.length === 0) {
      const result: FactCheckResult = {
        claims: [],
        overallReliability: "low",
        contradictions:     [],
        missingEvidence:    ["No claims identified to fact-check"],
        summary:            "Insufficient data for fact-checking.",
      };
      return {
        agentName: this.name, output: result,
        confidence: 0.0, sources: [],
        reasoning: "No claims to check",
        duration: Date.now() - start,
        model: "none",
      };
    }

    const prompt = `
Fact-check these claims about "${data.entity}":

CLAIMS TO VERIFY:
${claimsToCheck.map((c, i) => `[${i+1}] "${c.claim}" (Source: ${c.source})`).join("\n")}

VERIFIED NEWS/GOVT EVIDENCE:
Key Facts: ${(data.news.keyFacts ?? []).join("; ")}
Official Statements: ${(data.news.officialStatements ?? []).map(s => s.statement).join("; ")}
Timeline Events: ${(data.news.timeline ?? []).map(t => `${t.date}: ${t.event}`).join("; ")}

SOCIAL MEDIA CONTEXT:
Sentiment: ${data.social.sentiment}
Bot Risk: ${data.social.botRisk}
Summary: ${data.social.summary}

Return JSON:
{
  "claims": [{
    "claim": "exact claim text",
    "status": "verified|unverified|disputed|opinion|insufficient_data",
    "confidence": 0.0-1.0,
    "supportingEvidence": ["evidence 1"],
    "contradictingEvidence": ["contradiction 1"],
    "verdict": "one sentence verdict",
    "sourceUrls": ["url1"]
  }],
  "overallReliability": "high|medium|low",
  "contradictions": ["contradiction found"],
  "missingEvidence": ["what evidence is missing"],
  "summary": "3-4 sentence fact-check summary"
}`;

    const raw = await this.callLLM(prompt, 1200);
    let result: FactCheckResult;

    try {
      const parsed = JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as Partial<FactCheckResult>;
      // Defensive normalization: even when the AI returns syntactically
      // valid JSON, it may omit expected array fields entirely. Never let
      // a missing field crash downstream code that assumes arrays exist.
      result = {
        claims:             (Array.isArray(parsed.claims) ? parsed.claims : []).map(c => ({
          claim:                 c.claim ?? "",
          status:                c.status ?? "insufficient_data",
          confidence:            typeof c.confidence === "number" ? c.confidence : 0,
          supportingEvidence:    Array.isArray(c.supportingEvidence) ? c.supportingEvidence : [],
          contradictingEvidence: Array.isArray(c.contradictingEvidence) ? c.contradictingEvidence : [],
          verdict:               c.verdict ?? "",
          sourceUrls:            Array.isArray(c.sourceUrls) ? c.sourceUrls : [],
        })),
        overallReliability: parsed.overallReliability ?? "low",
        contradictions:     Array.isArray(parsed.contradictions) ? parsed.contradictions : [],
        missingEvidence:    Array.isArray(parsed.missingEvidence) ? parsed.missingEvidence : [],
        summary:            parsed.summary ?? "Fact-check completed with an incomplete response.",
      };
    } catch {
      result = {
        claims:             claimsToCheck.map(c => ({
          claim: c.claim, status: "unverified" as const,
          confidence: 0.3, supportingEvidence: [], contradictingEvidence: [],
          verdict: "Could not verify — review manually", sourceUrls: [],
        })),
        overallReliability: "low",
        contradictions:     [],
        missingEvidence:    ["AI fact-check parsing failed — manual review required"],
        summary:            "Automated fact-checking encountered an error. Manual review required.",
      };
    }

    const verifiedCount = result.claims.filter(c => c.status === "verified").length;
    const totalClaims   = result.claims.length || 1;

    return {
      agentName:  this.name,
      output:     result,
      confidence: verifiedCount / totalClaims,
      sources:    result.claims.flatMap(c => c.sourceUrls).slice(0, 10),
      reasoning:  `Checked ${result.claims.length} claims: ${verifiedCount} verified, ` +
                  `${result.claims.filter(c => c.status === "disputed").length} disputed`,
      duration:   Date.now() - start,
      model:      this.lastModelUsed,
    };
  }
}
