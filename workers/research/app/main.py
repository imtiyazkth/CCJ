"""
CCJ Research Worker — FastAPI
Implements the vertical slice:
  Idea → Research Plan → Search → Source → Evidence → Claim → Dossier

Security:
  - WORKER_SECRET required on every request
  - SSRF protection on all outbound fetches
  - No API keys exposed in responses
  - Input validated via Pydantic
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse

from .models import (
    ResearchRunRequest,
    ResearchRunStatusUpdate,
    PlanningResult,
    SourceRecord,
    EvidenceRecord,
    ClaimRecord,
    DossierCardRecord,
)
from .research_agent import ResearchAgent
from .providers.searxng import SearXNGProvider
from .security import validate_fetch_url, SSRFError

# ── Logging ───────────────────────────────────────────────────

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("ccj.worker")

# ── Config ────────────────────────────────────────────────────

WORKER_SECRET = os.environ.get("WORKER_SECRET")
DATABASE_URL = os.environ.get("DATABASE_URL")
SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://searxng:8080")
LIBRETRANSLATE_URL = os.environ.get("LIBRETRANSLATE_URL", "http://libretranslate:5000")

if not WORKER_SECRET:
    raise RuntimeError("WORKER_SECRET environment variable is required")

# ── App ───────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("CCJ Research Worker starting up")
    yield
    logger.info("CCJ Research Worker shutting down")


app = FastAPI(
    title="CCJ Research Worker",
    version="1.0.0",
    docs_url=None,   # Disable Swagger UI in production
    redoc_url=None,
    lifespan=lifespan,
)

# ── Auth dependency ───────────────────────────────────────────

def verify_worker_secret(x_worker_secret: str = Header(alias="X-Worker-Secret")):
    """Verify internal worker secret on every request."""
    if x_worker_secret != WORKER_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    return True


WorkerAuth = Depends(verify_worker_secret)

# ── Health ────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ccj-research-worker", "timestamp": datetime.now(timezone.utc).isoformat()}


# ── Research Run ──────────────────────────────────────────────

@app.post("/research/run", status_code=202)
async def trigger_research_run(
    request: ResearchRunRequest,
    background_tasks: BackgroundTasks,
    _auth: bool = WorkerAuth,
):
    """
    Accepts a research run request and dispatches it to the background.
    Returns 202 immediately; caller polls /research/run/{run_id}/status.
    """
    logger.info("Dispatching research run %s for topic: %s", request.run_id, request.topic[:80])

    background_tasks.add_task(
        execute_research_run,
        run_id=request.run_id,
        project_id=request.project_id,
        topic=request.topic,
        depth=request.depth,
        requested_language=request.requested_language,
        date_range_start=request.date_range_start,
        date_range_end=request.date_range_end,
    )

    return {"run_id": request.run_id, "status": "pending"}


# ── Background Research Task ──────────────────────────────────

async def execute_research_run(
    run_id: str,
    project_id: str,
    topic: str,
    depth: str,
    requested_language: str,
    date_range_start: str | None,
    date_range_end: str | None,
) -> None:
    """
    Vertical slice implementation:
    1. Plan research
    2. Generate queries
    3. Search (SearXNG)
    4. Fetch + parse each URL
    5. Extract evidence
    6. Generate claims
    7. Build dossier card
    """
    logger.info("[run:%s] Starting research for: %s", run_id, topic[:80])

    agent = ResearchAgent(
        searxng_url=SEARXNG_URL,
        libretranslate_url=LIBRETRANSLATE_URL,
    )

    try:
        # 1. Update status → planning
        await update_run_status(run_id, "planning", progress=5)

        # 2. Generate research plan
        plan = await agent.plan_research(
            topic=topic,
            language=requested_language,
            depth=depth,
            date_range_start=date_range_start,
            date_range_end=date_range_end,
        )
        logger.info("[run:%s] Plan: %d questions, %d queries", run_id, len(plan.research_questions), len(plan.queries))

        await update_run_status(run_id, "searching", progress=15, research_plan=plan.model_dump())

        # 3. Execute searches
        search_results = await agent.execute_searches(plan.queries, max_results_per_query=5)
        logger.info("[run:%s] Found %d search results", run_id, len(search_results))

        await update_run_status(run_id, "fetching", progress=30)

        # 4. Fetch and parse URLs (SSRF-safe)
        source_records: list[SourceRecord] = []
        for i, result in enumerate(search_results[:20]):  # cap at 20 URLs per run
            try:
                source = await agent.fetch_and_parse(result, run_id)
                if source:
                    source_records.append(source)
                    await save_source(source)
            except SSRFError as e:
                logger.warning("[run:%s] SSRF blocked for %s: %s", run_id, result.url, e)
            except Exception as e:
                logger.warning("[run:%s] Failed to fetch %s: %s", run_id, result.url, e)

            # Update progress incrementally
            progress = 30 + int((i / max(len(search_results[:20]), 1)) * 30)
            await update_run_status(run_id, "fetching", progress=progress)

        logger.info("[run:%s] Saved %d sources", run_id, len(source_records))
        await update_run_status(run_id, "extracting", progress=60)

        # 5. Extract evidence from sources
        evidence_records: list[EvidenceRecord] = []
        for source in source_records:
            evidence_items = await agent.extract_evidence(source)
            for ev in evidence_items:
                await save_evidence(ev)
                evidence_records.append(ev)

        logger.info("[run:%s] Extracted %d evidence items", run_id, len(evidence_records))
        await update_run_status(run_id, "analysing", progress=80)

        # 6. Generate claims from evidence
        claim_records: list[ClaimRecord] = []
        for claim in await agent.generate_claims(topic, evidence_records, project_id):
            await save_claim(claim)
            claim_records.append(claim)

        logger.info("[run:%s] Generated %d claims", run_id, len(claim_records))

        # 7. Build dossier summary card
        dossier_card = await agent.build_dossier_card(
            run_id=run_id,
            project_id=project_id,
            topic=topic,
            sources=source_records,
            evidence=evidence_records,
            claims=claim_records,
            language=requested_language,
        )
        await save_dossier_card(dossier_card)

        # 8. Mark complete
        await update_run_status(run_id, "complete", progress=100)
        logger.info("[run:%s] Research complete", run_id)

    except Exception as e:
        logger.error("[run:%s] Research failed: %s", run_id, e, exc_info=True)
        await update_run_status(run_id, "failed", error=str(e))


# ── DB Write Helpers ──────────────────────────────────────────
# These use raw asyncpg for speed; Drizzle handles schema.

async def update_run_status(
    run_id: str,
    status: str,
    progress: int = 0,
    research_plan: dict | None = None,
    error: str | None = None,
) -> None:
    """Update research_runs status in the database."""
    import asyncpg  # type: ignore
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        import json
        plan_json = json.dumps(research_plan) if research_plan else None
        completed_at = datetime.now(timezone.utc) if status in ("complete", "failed") else None
        await conn.execute(
            """
            UPDATE research_runs
            SET status = $1, progress_pct = $2, research_plan = COALESCE($3::jsonb, research_plan),
                error = $4, completed_at = COALESCE($5, completed_at)
            WHERE id = $6
            """,
            status, progress, plan_json, error, completed_at, run_id,
        )
    finally:
        await conn.close()


async def save_source(source: SourceRecord) -> None:
    import asyncpg
    import json
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            """
            INSERT INTO sources (
                id, research_run_id, url, canonical_url, domain, title, author,
                published_at, retrieved_at, language, source_type, credibility_tier,
                access_method, content_hash, raw_artifact_id, extracted_artifact_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT DO NOTHING
            """,
            source.id, source.research_run_id, source.url, source.canonical_url,
            source.domain, source.title, source.author, source.published_at,
            source.retrieved_at, source.language, source.source_type,
            source.credibility_tier, source.access_method, source.content_hash,
            source.raw_artifact_id, source.extracted_artifact_id,
        )
    finally:
        await conn.close()


async def save_evidence(ev: EvidenceRecord) -> None:
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            """
            INSERT INTO evidence (id, source_id, page_number, section, quote, confidence, language, extraction_warnings)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING
            """,
            ev.id, ev.source_id, ev.page_number, ev.section, ev.quote,
            ev.confidence, ev.language, ev.extraction_warnings,
        )
    finally:
        await conn.close()


async def save_claim(claim: ClaimRecord) -> None:
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            """
            INSERT INTO claims (id, project_id, claim_text, claim_type, status, confidence, reasoning_summary, what_is_missing)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING
            """,
            claim.id, claim.project_id, claim.claim_text, claim.claim_type,
            claim.status, claim.confidence, claim.reasoning_summary, claim.what_is_missing,
        )
    finally:
        await conn.close()


async def save_dossier_card(card: DossierCardRecord) -> None:
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            """
            INSERT INTO dossier_cards (id, project_id, research_run_id, card_type, title, body, claim_ids, source_ids, evidence_ids, locale)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            """,
            card.id, card.project_id, card.research_run_id, card.card_type,
            card.title, card.body, card.claim_ids, card.source_ids, card.evidence_ids, card.locale,
        )
    finally:
        await conn.close()
