"""
CCJ Research Worker — Pydantic Models
All inputs/outputs validated at boundary.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Inbound ───────────────────────────────────────────────────

class ResearchRunRequest(BaseModel):
    run_id: str = Field(..., description="UUID of the research_runs row")
    project_id: str = Field(..., description="UUID of the parent project")
    topic: str = Field(..., min_length=3, max_length=2000)
    depth: str = Field(default="standard", pattern="^(quick|standard|deep)$")
    requested_language: str = Field(default="en", max_length=10)
    date_range_start: str | None = None
    date_range_end: str | None = None

    @field_validator("topic")
    @classmethod
    def sanitise_topic(cls, v: str) -> str:
        # Strip leading/trailing whitespace; reject obvious injection attempts
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Topic too short")
        return v


# ── Research Planning ─────────────────────────────────────────

class SearchQueryModel(BaseModel):
    query: str
    language: str = "en"
    provider: str = "searxng"
    priority: int = 1


class PlanningResult(BaseModel):
    research_questions: list[str]
    queries: list[SearchQueryModel]
    primary_source_targets: list[str]
    secondary_source_targets: list[str]
    social_source_targets: list[str]
    legal_questions: list[str]
    expected_entities: list[str]
    date_range: dict[str, str | None]
    risk_flags: list[str]


# ── Search Result ─────────────────────────────────────────────

class SearchResultModel(BaseModel):
    url: str
    title: str
    snippet: str
    domain: str
    published_at: str | None = None
    language: str | None = None
    score: float = 0.0


# ── Source Record ─────────────────────────────────────────────

VALID_SOURCE_TYPES = {
    "webpage", "pdf", "video", "news", "social",
    "legal_document", "official_statement", "academic", "user_upload",
}
VALID_CREDIBILITY_TIERS = {
    "primary", "verified", "credible", "reported", "unknown", "disputed",
}
VALID_ACCESS_METHODS = {
    "public_web", "rss", "user_upload", "api", "youtube",
}


class SourceRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    research_run_id: str
    url: str
    canonical_url: str
    domain: str
    title: str
    author: str | None = None
    published_at: datetime | None = None
    retrieved_at: datetime = Field(default_factory=lambda: datetime.utcnow())
    language: str = "en"
    source_type: str = "webpage"
    credibility_tier: str = "unknown"
    access_method: str = "public_web"
    content_hash: str  # SHA-256 hex
    raw_artifact_id: str | None = None
    extracted_artifact_id: str | None = None
    # NOT stored in DB — used only during processing
    raw_text: str = Field(default="", exclude=True)

    @field_validator("source_type")
    @classmethod
    def validate_source_type(cls, v: str) -> str:
        if v not in VALID_SOURCE_TYPES:
            return "webpage"
        return v

    @field_validator("credibility_tier")
    @classmethod
    def validate_credibility(cls, v: str) -> str:
        if v not in VALID_CREDIBILITY_TIERS:
            return "unknown"
        return v

    @field_validator("content_hash")
    @classmethod
    def validate_hash(cls, v: str) -> str:
        if len(v) != 64:
            raise ValueError("content_hash must be a 64-char SHA-256 hex string")
        return v.lower()


# ── Evidence Record ───────────────────────────────────────────

class EvidenceRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    source_id: str
    page_number: int | None = None
    section: str | None = None
    # MUST be exact quote — never paraphrased
    quote: str = Field(..., min_length=1, max_length=10_000)
    coordinates: dict[str, Any] | None = None
    captured_at: datetime = Field(default_factory=lambda: datetime.utcnow())
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    language: str = "en"
    extraction_warnings: list[str] = Field(default_factory=list)

    @field_validator("quote")
    @classmethod
    def quote_must_not_be_paraphrase(cls, v: str) -> str:
        v = v.strip()
        # Basic guard: quotes must not start with "According to" (paraphrase indicator)
        paraphrase_starts = ["According to", "The author claims", "The article states"]
        for start in paraphrase_starts:
            if v.startswith(start):
                raise ValueError(
                    f"Evidence quote appears to be a paraphrase (starts with '{start}'). "
                    "Use exact source text only."
                )
        return v


# ── Claim Record ──────────────────────────────────────────────

VALID_CLAIM_TYPES = {
    "fact", "reported", "opinion", "analysis",
    "legal_interpretation", "inference", "statistic",
}
VALID_CLAIM_STATUSES = {
    "verified", "strongly_correlated", "reported",
    "disputed", "unverified", "opinion", "inference", "outdated",
}

class ClaimRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    project_id: str
    claim_text: str = Field(..., min_length=5, max_length=5000)
    claim_type: str = "reported"
    # Default to unverified — must not be silently upgraded
    status: str = "unverified"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    supporting_evidence_ids: list[str] = Field(default_factory=list)
    contradicting_evidence_ids: list[str] = Field(default_factory=list)
    reasoning_summary: str | None = None
    what_is_missing: str | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in VALID_CLAIM_STATUSES:
            return "unverified"
        return v

    @model_validator(mode="after")
    def verified_requires_evidence(self) -> "ClaimRecord":
        """
        SPEC RULE: Never silently upgrade a reported claim to verified.
        If status is verified, there must be supporting evidence.
        """
        if self.status == "verified" and not self.supporting_evidence_ids:
            raise ValueError(
                "Claim status 'verified' requires at least one supporting_evidence_id. "
                "Use 'strongly_correlated' or 'reported' if evidence is indirect."
            )
        return self


# ── Dossier Card ──────────────────────────────────────────────

VALID_CARD_TYPES = {
    "summary", "timeline", "contradiction", "gap",
    "legal", "source_analysis", "key_claim",
}

class DossierCardRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    project_id: str
    research_run_id: str
    card_type: str = "summary"
    title: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1)
    claim_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    locale: str = "en"

    @field_validator("card_type")
    @classmethod
    def validate_card_type(cls, v: str) -> str:
        if v not in VALID_CARD_TYPES:
            return "summary"
        return v


# ── Status Update (internal) ──────────────────────────────────

class ResearchRunStatusUpdate(BaseModel):
    status: str
    progress_pct: int = Field(default=0, ge=0, le=100)
    research_plan: dict[str, Any] | None = None
    error: str | None = None
