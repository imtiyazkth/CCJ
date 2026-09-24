/**
 * CCJ News & Government Agent (Module 3.2)
 *
 * Processes news outlets, government domains (.gov, .gov.in, .nic.in),
 * official press releases, and verified news agency feeds.
 */
import { BaseAgent, type AgentResult } from "./base-agent";
import type { FetchResult } from "../providers/fetcher";

export interface NewsGovtAnalysis {
  officialStatements: Array<{ statement: string; source: string; url: string; date: string | null }>;
  govtDomainHits:     Array<{ domain: string; url: string; summary: string }>;
  majorNewsLines:     string[];
  timeline:           Array<{ date: string | null; event: string; source: string }>;
  keyFacts:           string[];
  summary:            string;
}

const GOV_DOMAINS = [
  ".gov", ".gov.in", ".nic.in", ".org.in", ".mil",
  "sci.gov.in", "mca.gov.in", "ecourts.gov.in",
  "sansad.in", "irs.nic.in", "mea.gov.in",
];

function isGovtDomain(url: string): boolean {
  return GOV_DOMAINS.some(d => url.includes(d));
}

export class NewsGovtAgent extends BaseAgent {
  readonly name = "NewsGovtAgent";
  readonly systemPrompt = `
You are a senior OSINT News and Government Records Analyst.
Your job is to extract verified factual information from news outlets and government sources.
Prioritise: official statements, press releases, government records, court documents.
Identify key dates, names, organisations, and policy implications.
Flag anything that appears to be an official government or regulatory statement.
Always return valid JSON.
`;

  async run(data: FetchResult[]): Promise<AgentResult> {
    const start = Date.now();

    const newsItems = data.filter(d =>
      ["gdelt", "rss", "wikipedia", "academic", "duckduckgo"].includes(d.platform) ||
      d.credibility >= 0.70
    );
    const govItems = data.filter(d => isGovtDomain(d.url));

    const prompt = `
Analyse these ${newsItems.length} news/official sources (${govItems.length} from government domains):

GOVERNMENT/OFFICIAL:
${govItems.slice(0, 5).map((item, i) =>
  `[GOV-${i+1}] ${item.source}: ${item.title}\nURL: ${item.url}\n${item.snippet.slice(0, 300)}`
).join("\n---\n") || "None found"}

NEWS SOURCES:
${newsItems.slice(0, 10).map((item, i) =>
  `[NEWS-${i+1}] ${item.source} (credibility: ${item.credibility}):
  Title: ${item.title}
  URL: ${item.url}
  Date: ${item.timestamp ?? "unknown"}
  Content: ${item.snippet.slice(0, 300)}`
).join("\n---\n")}

Return JSON:
{
  "officialStatements": [{ "statement": "string", "source": "string", "url": "string", "date": "string|null" }],
  "govtDomainHits": [{ "domain": "string", "url": "string", "summary": "string" }],
  "majorNewsLines": ["headline 1", "headline 2"],
  "timeline": [{ "date": "string|null", "event": "string", "source": "string" }],
  "keyFacts": ["verified fact 1", "verified fact 2"],
  "summary": "3-4 sentence factual summary"
}`;

    const raw = await this.callLLM(prompt, 800);
    let analysis: NewsGovtAnalysis;

    try {
      const parsed = JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as Partial<NewsGovtAnalysis>;
      // Defensive normalization: syntactically valid JSON can still omit
      // or mistype expected array fields (e.g. a string instead of an
      // array). Never let that crash downstream code (e.g.
      // FactCheckerAgent) that assumes these are always arrays.
      analysis = {
        officialStatements: Array.isArray(parsed.officialStatements) ? parsed.officialStatements : [],
        govtDomainHits:     Array.isArray(parsed.govtDomainHits) ? parsed.govtDomainHits : [],
        majorNewsLines:     Array.isArray(parsed.majorNewsLines) ? parsed.majorNewsLines : [],
        timeline:           Array.isArray(parsed.timeline) ? parsed.timeline : [],
        keyFacts:           Array.isArray(parsed.keyFacts) ? parsed.keyFacts : [],
        summary:            typeof parsed.summary === "string" ? parsed.summary : `Analysed ${newsItems.length} news sources and ${govItems.length} government sources.`,
      };
    } catch {
      analysis = {
        officialStatements: [],
        govtDomainHits:     govItems.slice(0, 3).map(i => ({ domain: new URL(i.url).hostname, url: i.url, summary: i.snippet.slice(0, 200) })),
        majorNewsLines:     newsItems.slice(0, 5).map(i => i.title),
        timeline:           [],
        keyFacts:           newsItems.slice(0, 3).map(i => i.snippet.slice(0, 150)),
        summary:            `Analysed ${newsItems.length} news sources and ${govItems.length} government sources.`,
      };
    }

    return {
      agentName:  this.name,
      output:     analysis,
      confidence: govItems.length > 0 ? 0.88 : newsItems.length > 5 ? 0.72 : 0.55,
      sources:    [...govItems, ...newsItems].map(i => i.url).slice(0, 10),
      reasoning:  `Processed ${newsItems.length} news + ${govItems.length} govt sources`,
      duration:   Date.now() - start,
      model:      this.lastModelUsed,
    };
  }
}
