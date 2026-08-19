"""
CCJ Research Agent — Provider-injected architecture

Business logic never imports concrete providers directly.
All external operations go through injected interfaces.
Swap providers without touching this file.
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from uuid import uuid4

from .models import (
    ClaimRecord, DossierCardRecord, EvidenceRecord,
    PlanningResult, SearchQueryModel, SearchResultModel, SourceRecord,
)
from .providers import (
    IAIProvider, IDocumentProvider, ISearchProvider, ITranslationProvider,
    ChatMessage, DemoSearchProvider, HttpDocumentProvider,
    DemoTranslationProvider, DemoAIProvider,
)
from .security import validate_fetch_url, SSRFError

logger = logging.getLogger("ccj.agent")

BOILERPLATE_MARKERS = frozenset([
    "cookie", "privacy policy", "terms of service", "subscribe",
    "newsletter", "advertisement", "© copyright", "all rights reserved",
    "click here", "javascript", "loading...",
])

HIGH_CREDIBILITY_DOMAINS = frozenset([
    "reuters.com", "apnews.com", "bbc.co.uk", "bbc.com",
    "thehindu.com", "ndtv.com", "livelaw.in", "barandbench.com",
    ".gov.in", ".gov", ".edu", ".ac.in",
])


def estimate_credibility(domain: str) -> str:
    d = domain.lower()
    if any(d.endswith(hd) or d == hd.lstrip(".") for hd in HIGH_CREDIBILITY_DOMAINS):
        return "credible"
    if re.search(r"\.(gov|edu|ac)\.", d):
        return "credible"
    return "unknown"


class ResearchAgent:
    """
    Orchestrates the vertical slice: Plan → Search → Fetch → Extract → Claim → Dossier.
    All external calls go through injected provider interfaces.
    """

    def __init__(
        self,
        search:      ISearchProvider      | None = None,
        document:    IDocumentProvider    | None = None,
        translation: ITranslationProvider | None = None,
        ai:          IAIProvider          | None = None,
    ) -> None:
        # Default to demo providers if none supplied
        self._search      = search      or DemoSearchProvider()
        self._document    = document    or HttpDocumentProvider()
        self._translation = translation or DemoTranslationProvider()
        self._ai          = ai          or DemoAIProvider()

    # ── 1. Plan ───────────────────────────────────────────────

    async def plan_research(
        self,
        topic: str,
        language: str,
        depth: str,
        date_range_start: str | None,
        date_range_end: str | None,
    ) -> PlanningResult:
        logger.info("Planning: %s", topic[:80])

        prompt = (
            f"Research topic: {topic}\n"
            f"Language: {language}\n"
            f"Depth: {depth}\n"
            f"Date range: {date_range_start or 'any'} to {date_range_end or 'present'}\n\n"
            "Generate a research plan. Return JSON only — no preamble."
        )

        result = await self._ai.complete(
            messages=[
                ChatMessage(role="system", content=(
                    "You are a research planning agent. "
                    "Return a JSON research plan with keys: "
                    "research_questions, queries, primary_source_targets, "
                    "secondary_source_targets, social_source_targets, "
                    "legal_questions, expected_entities, date_range, risk_flags."
                )),
                ChatMessage(role="user", content=prompt),
            ],
            max_tokens=800,
            json_mode=True,
        )

        raw = result.parsed or {}

        def _queries(raw_queries: list) -> list[SearchQueryModel]:
            out = []
            for q in raw_queries:
                if isinstance(q, dict):
                    out.append(SearchQueryModel(
                        query=str(q.get("query", topic)),
                        language=str(q.get("language", language)),
                        provider=str(q.get("provider", self._search.name)),
                        priority=int(q.get("priority", 1)),
                    ))
            # Always include a base query
            if not out:
                out.append(SearchQueryModel(query=topic, language=language,
                                            provider=self._search.name, priority=1))
            return out

        return PlanningResult(
            research_questions=list(raw.get("research_questions", [])),
            queries=_queries(raw.get("queries", [])),
            primary_source_targets=list(raw.get("primary_source_targets", [])),
            secondary_source_targets=list(raw.get("secondary_source_targets", [])),
            social_source_targets=list(raw.get("social_source_targets", [])),
            legal_questions=list(raw.get("legal_questions", [])),
            expected_entities=list(raw.get("expected_entities", [])),
            date_range=dict(raw.get("date_range", {"start": None, "end": None})),
            risk_flags=list(raw.get("risk_flags", [])),
        )

    # ── 2. Search ─────────────────────────────────────────────

    async def execute_searches(
        self,
        queries: list[SearchQueryModel],
        max_results_per_query: int = 5,
    ) -> list[SearchResultModel]:
        seen: set[str] = set()
        results: list[SearchResultModel] = []

        for q in sorted(queries, key=lambda x: x.priority):
            try:
                items = await self._search.search(
                    query=q.query,
                    language=q.language,
                    max_results=max_results_per_query,
                )
                for item in items:
                    if item.url not in seen:
                        seen.add(item.url)
                        results.append(SearchResultModel(
                            url=item.url, title=item.title, snippet=item.snippet,
                            domain=item.domain, published_at=item.published_at,
                            language=item.language, score=item.score,
                        ))
            except Exception as e:
                logger.warning("Search failed for %r: %s", q.query, e)

        logger.info("Search: %d unique results from %d queries", len(results), len(queries))
        return results

    # ── 3. Fetch + parse ──────────────────────────────────────

    async def fetch_and_parse(
        self,
        result: SearchResultModel,
        run_id: str,
    ) -> SourceRecord | None:
        page = await self._document.fetch_url(result.url)
        if not page or not page.text.strip():
            return None

        source_type = self._guess_source_type(page.canonical_url)
        credibility = estimate_credibility(page.domain if page.domain else result.domain)

        return SourceRecord(
            id=str(uuid4()),
            research_run_id=run_id,
            url=result.url,
            canonical_url=page.canonical_url,
            domain=page.domain if page.domain else result.domain,
            title=page.title or result.title,
            author=page.author,
            language=page.language or result.language or "en",
            source_type=source_type,
            credibility_tier=credibility,
            access_method="public_web",
            content_hash=page.content_hash or hashlib.sha256(page.text.encode()).hexdigest(),
            raw_text=page.text,
        )

    # ── 4. Extract evidence ───────────────────────────────────

    async def extract_evidence(self, source: SourceRecord) -> list[EvidenceRecord]:
        if not source.raw_text:
            return []

        paragraphs = [
            p.strip() for p in re.split(r"\n{2,}|\r\n{2,}", source.raw_text)
            if len(p.strip()) > 120
        ]

        items: list[EvidenceRecord] = []
        for para in paragraphs[:5]:
            if self._is_boilerplate(para):
                continue
            try:
                ev = EvidenceRecord(
                    id=str(uuid4()),
                    source_id=source.id,
                    quote=para[:2000],
                    confidence=0.6,
                    language=source.language,
                    extraction_warnings=[
                        "Heuristic extraction — not AI-verified. Review before citing."
                    ],
                )
                items.append(ev)
            except Exception as e:
                logger.debug("Evidence validation failed: %s", e)

        return items

    # ── 5. Generate claims ────────────────────────────────────

    async def generate_claims(
        self,
        topic: str,
        evidence_items: list[EvidenceRecord],
        project_id: str,
    ) -> list[ClaimRecord]:
        claims: list[ClaimRecord] = []
        for ev in evidence_items[:10]:
            claim_text = ev.quote[:500].strip()
            if len(claim_text) < 20:
                continue
            try:
                claim = ClaimRecord(
                    id=str(uuid4()),
                    project_id=project_id,
                    claim_text=claim_text,
                    claim_type="reported",
                    status="unverified",   # Never silently upgraded
                    confidence=ev.confidence * 0.5,
                    supporting_evidence_ids=[ev.id],
                    reasoning_summary=(
                        "Candidate claim from heuristic extraction. "
                        "Human review required before upgrading status."
                    ),
                    what_is_missing="Independent corroboration. Primary source confirmation.",
                )
                claims.append(claim)
            except Exception as e:
                logger.debug("Claim failed: %s", e)
        return claims

    # ── 6. Build dossier ──────────────────────────────────────

    async def build_dossier_card(
        self,
        run_id: str, project_id: str, topic: str,
        sources: list[SourceRecord],
        evidence: list[EvidenceRecord],
        claims: list[ClaimRecord],
        language: str,
    ) -> DossierCardRecord:
        body_lines = [
            f"Research Topic: {topic}", "",
            f"Sources found: {len(sources)}",
            f"Evidence items: {len(evidence)}",
            f"Candidate claims: {len(claims)}", "",
            "Source domains:",
        ]
        for s in sources[:10]:
            body_lines.append(f"  [{s.credibility_tier.upper()}] {s.domain} — {s.title[:80]}")

        body_lines += [
            "", "⚠️ All claims are 'unverified'.",
            "Review evidence chains before publishing any claim.",
        ]

        return DossierCardRecord(
            id=str(uuid4()),
            project_id=project_id,
            research_run_id=run_id,
            card_type="summary",
            title=f"Research Summary: {topic[:100]}",
            body="\n".join(body_lines),
            claim_ids=[c.id for c in claims],
            source_ids=[s.id for s in sources],
            evidence_ids=[e.id for e in evidence],
            locale=language,
        )

    # ── Helpers ───────────────────────────────────────────────

    def _is_boilerplate(self, text: str) -> bool:
        tl = text.lower()
        return any(m in tl for m in BOILERPLATE_MARKERS)

    def _guess_source_type(self, url: str) -> str:
        ul = url.lower()
        if ul.endswith(".pdf"):               return "pdf"
        if "youtube.com" in ul or "youtu.be" in ul: return "video"
        if any(x in ul for x in ["rss", "/feed", "/news"]): return "news"
        return "webpage"
