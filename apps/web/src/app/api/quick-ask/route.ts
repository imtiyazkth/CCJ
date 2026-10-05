import { NextRequest } from "next/server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { runAllSources } from "@/lib/providers/free-search";

interface QuickAskResult {
  answer: string;
  citedIndices: number[];
  fromGeneralKnowledge: boolean;
}

// Minimal, self-contained Groq call — deliberately NOT importing from
// lib/agents/* (model-router.ts, base-agent.ts), since those files are
// not confirmed to exist in the deployed repo (they caused a "Module
// not found" build failure previously). This keeps quick-ask working
// even if that agents/ layer is added, renamed, or removed later.
async function callGroqForAnswer(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 400,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

function stripJsonFences(text: string): string {
  return text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
}

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
      .map((s, i: number) => `[${i}] ${s.title} — ${s.snippet} (${s.source})`)
      .join("\n");

    const raw = await callGroqForAnswer(
      "You answer the user's question directly and helpfully in 2-4 short sentences. " +
      "First check the numbered sources below — if any are genuinely relevant, base your " +
      "answer on them and cite which ones in citedIndices. If none of the sources are " +
      "relevant to the question (this happens often — web search can return unrelated " +
      "results for niche or local terms), ignore them and answer from your own general " +
      "knowledge instead, setting fromGeneralKnowledge to true and citedIndices to []. " +
      "Only say you don't know if you genuinely have no relevant knowledge at all — don't " +
      "refuse just because the search results happened to be irrelevant. Return ONLY JSON, " +
      'no other text: {"answer": "...", "citedIndices": [0, 2], "fromGeneralKnowledge": false}',
      `Question: ${body.question.trim()}\n\nSources found by web search (may or may not be relevant):\n${sourceList}`
    );

    let parsed: Partial<QuickAskResult> | null = null;
    if (raw) {
      try {
        parsed = JSON.parse(stripJsonFences(raw)) as Partial<QuickAskResult>;
      } catch {
        parsed = null;
      }
    }

    if (!parsed || typeof parsed.answer !== "string") {
      return ok({
        answer: "The AI provider is busy right now — here are the top sources found; try again in a moment for a synthesized answer.",
        sources: topSources.map((s) => ({ title: s.title, url: s.url, source: s.source })),
      });
    }

    const citedIndices: number[] = Array.isArray(parsed.citedIndices) ? parsed.citedIndices : [];
    const cited = citedIndices
      .map((i: number) => topSources[i])
      .filter((s): s is typeof topSources[number] => Boolean(s))
      .map((s) => ({ title: s.title, url: s.url, source: s.source }));

    // When the model used its own knowledge instead of the search results,
    // don't attach the (irrelevant) sources it was explicitly told to
    // ignore — showing them next to a general-knowledge answer would
    // falsely imply they back it up.
    const fromGeneralKnowledge = parsed.fromGeneralKnowledge === true;
    return ok({
      answer: parsed.answer,
      sources: fromGeneralKnowledge ? [] : (cited.length > 0 ? cited : topSources.slice(0, 3).map((s) => ({ title: s.title, url: s.url, source: s.source }))),
      fromGeneralKnowledge,
    });
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}
