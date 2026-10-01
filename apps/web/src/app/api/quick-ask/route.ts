import { NextRequest } from "next/server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { runAllSources } from "@/lib/providers/free-search";
import { callStructured } from "@/lib/agents/model-router";

interface QuickAskResult {
  answer: string;
  citedIndices: number[];
}

// Fast conversational answer with sources, distinct from the full
// research pipeline (/api/projects/[id]/research). One search fan-out
// + one AI call — meant to respond in a few seconds, not minutes.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    void user; // auth required, but the answer isn't personalized to the user
    const body = await req.json() as { question: string; language?: string };
    if (!body.question?.trim()) return err("Question required", 400);

    const { results } = await runAllSources(body.question.trim(), body.language ?? "en", "quick");
    const topSources = results.slice(0, 6);

    if (topSources.length === 0) {
      return ok({ answer: "I couldn't find any sources for that just now — try rephrasing, or use Research for a deeper pass.", sources: [] });
    }

    const sourceList = topSources
      .map((s, i) => `[${i}] ${s.title} — ${s.snippet} (${s.source})`)
      .join("\n");

    const envelope = await callStructured<QuickAskResult>(
      "You answer a question in 2-4 short sentences using ONLY the numbered sources given. " +
      "Every claim must be attributable to a source. Return JSON: " +
      '{"answer": "...", "citedIndices": [0, 2]} — citedIndices lists which source numbers you actually used. ' +
      "If the sources don't answer the question, say so plainly in the answer field.",
      `Question: ${body.question.trim()}\n\nSources:\n${sourceList}`,
      {
        maxTokens: 400,
        validate: (parsed) => {
          const p = parsed as Partial<QuickAskResult>;
          if (typeof p.answer !== "string") return null;
          return { answer: p.answer, citedIndices: Array.isArray(p.citedIndices) ? p.citedIndices : [] };
        },
      }
    );

    if (envelope.status === "failed") {
      return ok({
        answer: "The AI provider is busy right now — here are the top sources found; try again in a moment for a synthesized answer.",
        sources: topSources.map((s) => ({ title: s.title, url: s.url, source: s.source })),
      });
    }

    const cited = envelope.data!.citedIndices
      .map((i) => topSources[i])
      .filter(Boolean)
      .map((s) => ({ title: s.title, url: s.url, source: s.source }));

    return ok({ answer: envelope.data!.answer, sources: cited.length > 0 ? cited : topSources.slice(0, 3).map((s) => ({ title: s.title, url: s.url, source: s.source })) });
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}
