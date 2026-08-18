"""
CCJ Research Agent
Implements the full vertical slice:
  Plan → Search → Fetch → Extract → Claim → Dossier

Design principles:
  - Never invent missing text or fill gaps with general knowledge
  - Every claim starts as 'unverified'
  - Every quote must be exact (validated by EvidenceRecord)
  - Primary sources ranked above secondary
  - SSRF-safe fetching for all outbound URLs
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4

import httpx

from .models import (
    ClaimRecord,
    DossierCardRecord,
    EvidenceRecord,
    PlanningResult,
    SearchQueryModel,
    SearchResultModel,
    SourceRecord,
)
from .security import validate_fetch_url, SSRFError

logger = logging.getLogger("ccj.agent")

# ── Constants ─────────────────────────────────────────────────

FETCH_TIMEOUT = 20.0
MAX_TEXT_LENGTH = 50_000   # chars — large bodies stored in object storage
USER_AGENT = "CCJ-Research/1.0 (research agent; not a scraper)"

# Credibility heuristics by domain suffix / known outlets
HIGH_CREDIBILITY_DOMAINS = frozenset({
    "reuters.com", "apnews.com", "bbc.co.uk", "bbc.com",
    "thehindu.com", "ndtv.com", "livelaw.in", "barandbench.com",
    "scobserver.in", "sci.gov.in",
    ".gov.in", ".gov", ".edu", ".ac.in", ".ac.uk",
})


def estimate_credibility(domain: str) -> str:
    domain_lower = domain.lower()
    if any(domain_lower.endswith(d) or domain_lower == d.lstrip(".") for d in HIGH_CREDIBILITY_DOMAINS):
        return "credible"
    if re.search(r"\.(gov|edu|ac)\.", domain_lower):
        return "credible"
    return "unknown"


class ResearchAgent:
    def __init__(self, searxng_url: str, libretranslate_url: str):
        self.searxng_url = searxng_url
        self.libretranslate_url = libretranslate_url

    # ── 1. Plan Research ──────────────────────────────────────

    async def plan_research(
        self,
        topic: str,
        language: str,
        depth: str,
        date_range_start: str | None,
        date_range_end: str | None,
    ) -> PlanningResult:
        """
        Generate a structured research plan from a topic.
        In the vertical slice, this uses rule-based expansion.
        When an LLM provider is configured, it delegates to the LLM.
        """
        logger.info("Planning research for: %s", topic[:80])

        # Base query matrix
        queries: list[SearchQueryModel] = [
            SearchQueryModel(query=topic, language=language, provider="searxng", priority=1),
            SearchQueryModel(query=f"{topic} official statement", language=language, provider="searxng", priority=2),
            SearchQueryModel(query=f"{topic} news report", language=language, provider="searxng", priority=3),
        ]

        if depth in ("standard", "deep"):
            queries += [
                SearchQueryModel(query=f"{topic} legal", language=language, provider="searxng", priority=4),
                SearchQueryModel(query=f"{topic} reaction response", language=language, provider="searxng", priority=5),
            ]

        if depth == "deep":
            queries += [
                SearchQueryModel(query=f"{topic} timeline chronology", language=language, provider="searxng", priority=6),
                SearchQueryModel(query=f"{topic} analysis opinion", language=language, provider="searxng", priority=7),
            ]

        return PlanningResult(
            research_questions=[
                f"What are the primary facts about: {topic}?",
                "Who are the key entities and stakeholders?",
                "What primary sources exist?",
                "Are there contradictory accounts?",
                "What is the legal/regulatory context?",
                "What is missing or unconfirmed?",
            ],
            queries=queries,
            primary_source_targets=[],
            secondary_source_targets=[],
            social_source_targets=[],
            legal_questions=[],
            expected_entities=[],
            date_range={"start": date_range_start, "end": date_range_end},
            risk_flags=[],
        )

    # ── 2. Execute Searches ───────────────────────────────────

    async def execute_searches(
        self,
        queries: list[SearchQueryModel],
        max_results_per_query: int = 5,
    ) -> list[SearchResultModel]:
        """
        Execute each query against SearXNG and deduplicate by URL.
        """
        seen_urls: set[str] = set()
        all_results: list[SearchResultModel] = []

        async with httpx.AsyncClient(timeout=15.0) as client:
            for q in sorted(queries, key=lambda x: x.priority):
                try:
                    results = await self._searxng_search(client, q.query, q.language, max_results_per_query)
                    for r in results:
                        if r.url not in seen_urls:
                            seen_urls.add(r.url)
                            all_results.append(r)
                except Exception as e:
                    logger.warning("Search failed for query %r: %s", q.query, e)

        logger.info("Search phase: %d unique results from %d queries", len(all_results), len(queries))
        return all_results

    async def _searxng_search(
        self,
        client: httpx.AsyncClient,
        query: str,
        language: str,
        max_results: int,
    ) -> list[SearchResultModel]:
        params = {
            "q": query,
            "format": "json",
            "language": language,
            "pageno": "1",
        }
        resp = await client.get(f"{self.searxng_url}/search", params=params, headers={"User-Agent": USER_AGENT})
        resp.raise_for_status()
        data = resp.json()

        results = []
        for r in data.get("results", [])[:max_results]:
            results.append(SearchResultModel(
                url=r.get("url", ""),
                title=r.get("title", ""),
                snippet=r.get("content", ""),
                domain=self._extract_domain(r.get("url", "")),
                published_at=r.get("publishedDate"),
                language=r.get("language"),
                score=float(r.get("score", 0)),
            ))
        return results

    # ── 3. Fetch and Parse ────────────────────────────────────

    async def fetch_and_parse(
        self,
        result: SearchResultModel,
        run_id: str,
    ) -> SourceRecord | None:
        """
        Fetch a URL safely and return a SourceRecord.
        Returns None if the URL is blocked or fetch fails.
        Never executes fetched content.
        """
        try:
            validate_fetch_url(result.url)
        except SSRFError as e:
            logger.warning("SSRF blocked %s: %s", result.url, e)
            return None

        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True, max_redirects=3) as client:
            try:
                resp = await client.get(
                    result.url,
                    headers={
                        "User-Agent": USER_AGENT,
                        "Accept": "text/html,application/xhtml+xml,text/plain",
                    },
                )
            except (httpx.TimeoutException, httpx.RequestError) as e:
                logger.warning("Fetch failed for %s: %s", result.url, e)
                return None

        if not resp.is_success:
            logger.info("Non-2xx for %s: %d", result.url, resp.status_code)
            return None

        content_type = resp.headers.get("content-type", "")
        if "text" not in content_type and "html" not in content_type:
            # Skip binary content in the vertical slice
            logger.info("Skipping non-text content type %r for %s", content_type, result.url)
            return None

        raw_text = self._extract_text(resp.text)
        if not raw_text.strip():
            return None

        # Truncate to cap — full content goes to object storage (future)
        truncated = raw_text[:MAX_TEXT_LENGTH]

        content_hash = hashlib.sha256(resp.content).hexdigest()
        canonical_url = str(resp.url)  # final URL after redirects
        domain = self._extract_domain(canonical_url)

        return SourceRecord(
            research_run_id=run_id,
            url=result.url,
            canonical_url=canonical_url,
            domain=domain,
            title=result.title or self._extract_title(resp.text),
            author=None,
            language=result.language or "en",
            source_type=self._guess_source_type(canonical_url, content_type),
            credibility_tier=estimate_credibility(domain),
            access_method="public_web",
            content_hash=content_hash,
            raw_text=truncated,
        )

    def _extract_text(self, html: str) -> str:
        """Minimal HTML-to-text extraction without executing content."""
        # Remove scripts and styles entirely
        html = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<style[^>]*>.*?</style>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        # Strip remaining tags
        text = re.sub(r"<[^>]+>", " ", html)
        # Normalise whitespace
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _extract_title(self, html: str) -> str:
        m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        if m:
            return re.sub(r"\s+", " ", m.group(1)).strip()[:300]
        return "Untitled"

    def _extract_domain(self, url: str) -> str:
        try:
            return urlparse(url).hostname or ""
        except Exception:
            return ""

    def _guess_source_type(self, url: str, content_type: str) -> str:
        url_lower = url.lower()
        if url_lower.endswith(".pdf") or "application/pdf" in content_type:
            return "pdf"
        if "youtube.com" in url_lower or "youtu.be" in url_lower:
            return "video"
        if any(d in url_lower for d in ["rss", "feed", "news"]):
            return "news"
        return "webpage"

    # ── 4. Extract Evidence ───────────────────────────────────

    async def extract_evidence(self, source: SourceRecord) -> list[EvidenceRecord]:
        """
        Extract evidence items from a source's text.
        Vertical slice: extract paragraphs above a minimum length as candidate quotes.
        LLM-backed extraction is the next upgrade step.

        NEVER invents text. Only uses exact content from source.
        """
        if not source.raw_text:
            return []

        evidence_items: list[EvidenceRecord] = []
        paragraphs = [p.strip() for p in source.raw_text.split("\n") if len(p.strip()) > 120]

        # Cap at 5 evidence items per source in the vertical slice
        for para in paragraphs[:5]:
            # Skip paragraphs that look like navigation / boilerplate
            if self._is_boilerplate(para):
                continue

            try:
                ev = EvidenceRecord(
                    source_id=source.id,
                    quote=para[:2000],  # hard cap per evidence item
                    confidence=0.7,     # heuristic — LLM will give better scores
                    language=source.language,
                    extraction_warnings=["Extracted by heuristic paragraph splitter — not LLM-verified"],
                )
                evidence_items.append(ev)
            except Exception as e:
                logger.debug("Evidence validation failed: %s", e)

        return evidence_items

    def _is_boilerplate(self, text: str) -> bool:
        boilerplate_markers = [
            "cookie", "privacy policy", "terms of service",
            "subscribe", "newsletter", "advertisement",
            "© copyright", "all rights reserved",
        ]
        text_lower = text.lower()
        return any(m in text_lower for m in boilerplate_markers)

    # ── 5. Generate Claims ────────────────────────────────────

    async def generate_claims(
        self,
        topic: str,
        evidence_items: list[EvidenceRecord],
        project_id: str,
    ) -> list[ClaimRecord]:
        """
        Generate claims from evidence.
        Vertical slice: each evidence item → one candidate claim.
        Status starts as 'unverified' — NEVER silently upgraded.
        """
        claims: list[ClaimRecord] = []
        for ev in evidence_items[:10]:  # cap in vertical slice
            # Truncate quote to form a candidate claim sentence
            claim_text = ev.quote[:500].strip()
            if len(claim_text) < 20:
                continue

            try:
                claim = ClaimRecord(
                    project_id=project_id,
                    claim_text=claim_text,
                    claim_type="reported",
                    status="unverified",  # Always start unverified
                    confidence=ev.confidence * 0.5,  # conservative
                    supporting_evidence_ids=[ev.id],
                    reasoning_summary=(
                        "Candidate claim extracted from source text by heuristic method. "
                        "Human review required before upgrading status."
                    ),
                    what_is_missing=(
                        "Independent corroboration. Primary source confirmation. "
                        "LLM-assisted claim verification."
                    ),
                )
                claims.append(claim)
            except Exception as e:
                logger.debug("Claim validation failed: %s", e)

        return claims

    # ── 6. Build Dossier Card ─────────────────────────────────

    async def build_dossier_card(
        self,
        run_id: str,
        project_id: str,
        topic: str,
        sources: list[SourceRecord],
        evidence: list[EvidenceRecord],
        claims: list[ClaimRecord],
        language: str,
    ) -> DossierCardRecord:
        """Build the initial dossier summary card from research results."""

        body_parts = [
            f"Research Topic: {topic}",
            "",
            f"Sources found: {len(sources)}",
            f"Evidence items: {len(evidence)}",
            f"Candidate claims: {len(claims)}",
            "",
            "Source domains:",
        ]

        for s in sources[:10]:
            tier = s.credibility_tier
            body_parts.append(f"  [{tier.upper()}] {s.domain} — {s.title[:80]}")

        body_parts += [
            "",
            "⚠️ All claims are currently 'unverified'.",
            "Evidence was extracted by heuristic methods — LLM verification recommended.",
            "Review each claim and its linked evidence before upgrading status.",
        ]

        return DossierCardRecord(
            project_id=project_id,
            research_run_id=run_id,
            card_type="summary",
            title=f"Research Summary: {topic[:100]}",
            body="\n".join(body_parts),
            claim_ids=[c.id for c in claims],
            source_ids=[s.id for s in sources],
            evidence_ids=[e.id for e in evidence],
            locale=language,
        )
