"""CCJ Research Worker — FastAPI entry point"""
from __future__ import annotations
import asyncio, hashlib, json, logging, os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException

from .models import ResearchRunRequest, SourceRecord, EvidenceRecord, ClaimRecord, DossierCardRecord
from .providers import DemoSearchProvider, HttpDocumentProvider, DemoTranslationProvider, DemoAIProvider
from .research_agent import ResearchAgent
from .security import SSRFError

logging.basicConfig(level=os.environ.get("LOG_LEVEL","INFO"),
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("ccj.worker")

WORKER_SECRET = os.environ.get("WORKER_SECRET")
DATABASE_URL  = os.environ.get("DATABASE_URL")

if not WORKER_SECRET:
    raise RuntimeError("WORKER_SECRET is required")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("CCJ Research Worker starting (provider-injected architecture)")
    yield

app = FastAPI(title="CCJ Research Worker", version="1.0.0",
              docs_url=None, redoc_url=None, lifespan=lifespan)

def verify_secret(x_worker_secret: str = Header(alias="X-Worker-Secret")):
    if x_worker_secret != WORKER_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    return True

@app.get("/health")
async def health():
    return {"status":"ok","service":"ccj-research-worker","ts":datetime.now(timezone.utc).isoformat()}

@app.post("/research/run", status_code=202)
async def trigger_run(
    request: ResearchRunRequest,
    bg: BackgroundTasks,
    _auth: bool = Depends(verify_secret),
):
    logger.info("Dispatching run %s: %s", request.run_id, request.topic[:60])
    bg.add_task(execute_research_run, request)
    return {"run_id": request.run_id, "status": "pending"}

async def execute_research_run(req: ResearchRunRequest) -> None:
    # Build agent with demo providers (live providers added in live mode)
    agent = ResearchAgent(
        search=DemoSearchProvider(),
        document=HttpDocumentProvider(),
        translation=DemoTranslationProvider(),
        ai=DemoAIProvider(),
    )

    try:
        await _update_status(req.run_id, "planning", 5)
        plan = await agent.plan_research(
            req.topic, req.requested_language, req.depth,
            req.date_range_start, req.date_range_end,
        )
        await _update_status(req.run_id, "searching", 20, research_plan=plan.model_dump())

        results = await agent.execute_searches(plan.queries, max_results_per_query=5)
        await _update_status(req.run_id, "fetching", 35)

        sources: list[SourceRecord] = []
        for i, r in enumerate(results[:20]):
            try:
                src = await agent.fetch_and_parse(r, req.run_id)
                if src:
                    await _save_source(src)
                    sources.append(src)
            except SSRFError as e:
                logger.warning("SSRF blocked: %s", e)
            except Exception as e:
                logger.warning("Fetch failed %s: %s", r.url, e)
            await _update_status(req.run_id, "fetching", 35 + int(i/max(len(results[:20]),1)*25))

        await _update_status(req.run_id, "extracting", 60)
        evidence: list[EvidenceRecord] = []
        for src in sources:
            for ev in await agent.extract_evidence(src):
                await _save_evidence(ev)
                evidence.append(ev)

        await _update_status(req.run_id, "analysing", 80)
        claims: list[ClaimRecord] = []
        for c in await agent.generate_claims(req.topic, evidence, req.project_id):
            await _save_claim(c)
            claims.append(c)

        card = await agent.build_dossier_card(
            req.run_id, req.project_id, req.topic,
            sources, evidence, claims, req.requested_language,
        )
        await _save_dossier_card(card)
        await _update_status(req.run_id, "complete", 100)
        logger.info("Run %s complete: %d sources, %d evidence, %d claims",
                    req.run_id, len(sources), len(evidence), len(claims))

    except Exception as e:
        logger.error("Run %s failed: %s", req.run_id, e, exc_info=True)
        await _update_status(req.run_id, "failed", error=str(e))

# ── DB helpers ────────────────────────────────────────────────

async def _update_status(run_id: str, status: str, progress: int = 0,
                          research_plan: dict | None = None, error: str | None = None) -> None:
    if not DATABASE_URL: return
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        plan_json = json.dumps(research_plan) if research_plan else None
        completed = datetime.now(timezone.utc) if status in ("complete","failed") else None
        await conn.execute(
            "UPDATE research_runs SET status=$1, progress_pct=$2, "
            "research_plan=COALESCE($3::jsonb, research_plan), "
            "error=$4, completed_at=COALESCE($5, completed_at) WHERE id=$6",
            status, progress, plan_json, error, completed, run_id,
        )
    finally:
        await conn.close()

async def _save_source(s: SourceRecord) -> None:
    if not DATABASE_URL: return
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            "INSERT INTO sources (id,research_run_id,url,canonical_url,domain,title,author,"
            "language,source_type,credibility_tier,access_method,content_hash) "
            "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING",
            s.id, s.research_run_id, s.url, s.canonical_url, s.domain, s.title,
            s.author, s.language, s.source_type, s.credibility_tier, s.access_method, s.content_hash,
        )
    finally:
        await conn.close()

async def _save_evidence(e: EvidenceRecord) -> None:
    if not DATABASE_URL: return
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            "INSERT INTO evidence (id,source_id,page_number,section,quote,confidence,language,extraction_warnings) "
            "VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
            e.id, e.source_id, e.page_number, e.section, e.quote,
            e.confidence, e.language, e.extraction_warnings,
        )
    finally:
        await conn.close()

async def _save_claim(c: ClaimRecord) -> None:
    if not DATABASE_URL: return
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            "INSERT INTO claims (id,project_id,claim_text,claim_type,status,confidence,reasoning_summary,what_is_missing) "
            "VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
            c.id, c.project_id, c.claim_text, c.claim_type,
            c.status, c.confidence, c.reasoning_summary, c.what_is_missing,
        )
    finally:
        await conn.close()

async def _save_dossier_card(d: DossierCardRecord) -> None:
    if not DATABASE_URL: return
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            "INSERT INTO dossier_cards (id,project_id,research_run_id,card_type,title,body,claim_ids,source_ids,evidence_ids,locale) "
            "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            d.id, d.project_id, d.research_run_id, d.card_type,
            d.title, d.body, d.claim_ids, d.source_ids, d.evidence_ids, d.locale,
        )
    finally:
        await conn.close()
