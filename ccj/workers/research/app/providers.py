"""
CCJ Research Worker — Provider Interfaces (Python)

Abstract base classes matching the TypeScript IProvider interfaces in @ccj/providers.
ResearchAgent depends only on these abstractions — never on concrete implementations.
Adding a new provider = new class, zero business-logic edits.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

# ── Search Provider ───────────────────────────────────────────

@dataclass
class SearchResultItem:
    url: str
    title: str
    snippet: str
    domain: str
    published_at: str | None = None
    language: str | None = None
    score: float = 0.0
    source_type: str = "web"


class ISearchProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def is_available(self) -> bool: ...

    @abstractmethod
    async def search(
        self,
        query: str,
        language: str = "en",
        max_results: int = 10,
    ) -> list[SearchResultItem]: ...


# ── Document Provider ─────────────────────────────────────────

@dataclass
class ParsedPage:
    url: str
    canonical_url: str
    title: str
    text: str
    author: str | None = None
    published_at: str | None = None
    language: str = "en"
    content_hash: str = ""
    word_count: int = 0


class IDocumentProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def is_available(self) -> bool: ...

    @abstractmethod
    async def fetch_url(self, url: str) -> ParsedPage | None: ...

    @abstractmethod
    async def parse_pdf(self, data: bytes) -> ParsedPage: ...


# ── Translation Provider ──────────────────────────────────────

@dataclass
class TranslationResult:
    source_text: str
    translated_text: str
    source_language: str
    target_language: str
    was_translated: bool = False
    confidence: float | None = None


class ITranslationProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def is_available(self) -> bool: ...

    @abstractmethod
    async def translate(
        self,
        text: str,
        target_language: str,
        source_language: str | None = None,
    ) -> TranslationResult: ...

    @abstractmethod
    async def detect_language(self, text: str) -> str: ...


# ── AI Provider ───────────────────────────────────────────────

@dataclass
class ChatMessage:
    role: str   # "system" | "user" | "assistant"
    content: str


@dataclass
class AIResult:
    content: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    finish_reason: str = "stop"
    parsed: Any = None


class IAIProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def is_available(self) -> bool: ...

    @abstractmethod
    async def complete(
        self,
        messages: list[ChatMessage],
        max_tokens: int = 1000,
        temperature: float = 0.2,
        json_mode: bool = False,
    ) -> AIResult: ...


# ── Demo implementations (zero external deps) ─────────────────

import asyncio
import hashlib
import json
import re

from .security import SSRFError, resolve_redirect, validate_fetch_url

MAX_REDIRECTS = 5
FETCH_TIMEOUT  = 20.0
USER_AGENT     = "CCJ-Research/1.0 (research agent)"


class DemoSearchProvider(ISearchProvider):
    """Returns static demo results. No network calls."""
    name = "demo-search"

    async def is_available(self) -> bool:
        return True

    async def search(
        self, query: str, language: str = "en", max_results: int = 10
    ) -> list[SearchResultItem]:
        await asyncio.sleep(0.1)
        return [
            SearchResultItem(
                url="https://demo.ccj.local/result-1",
                title=f"[DEMO] Search result for: {query[:60]}",
                snippet="This is a demo search result. Configure a live search provider to get real results.",
                domain="demo.ccj.local",
                published_at=None,
                language=language,
                score=0.9,
            ),
        ][:max_results]


class HttpDocumentProvider(IDocumentProvider):
    """
    Fetches URLs over HTTP/HTTPS with SSRF protection at EVERY redirect hop.
    Does not execute fetched content.
    """
    name = "http-document"

    async def is_available(self) -> bool:
        return True

    async def fetch_url(self, url: str) -> ParsedPage | None:
        import httpx

        # Validate the initial URL
        try:
            validate_fetch_url(url)
        except SSRFError as e:
            import logging
            logging.getLogger("ccj.provider").warning("SSRF blocked %s: %s", url, e)
            return None

        current_url = url

        async with httpx.AsyncClient(
            follow_redirects=False,      # Manual redirect handling
            timeout=FETCH_TIMEOUT,
        ) as client:
            for hop in range(MAX_REDIRECTS + 1):
                try:
                    resp = await client.get(
                        current_url,
                        headers={"User-Agent": USER_AGENT, "Accept": "text/html,text/plain"},
                    )
                except (httpx.TimeoutException, httpx.RequestError):
                    return None

                if resp.is_redirect:
                    location = resp.headers.get("location", "")
                    if not location:
                        return None
                    next_url = resolve_redirect(current_url, location)
                    # ── CRITICAL: validate each redirect destination ──
                    try:
                        validate_fetch_url(next_url)
                    except SSRFError as e:
                        import logging
                        logging.getLogger("ccj.provider").warning(
                            "SSRF blocked redirect hop %d: %s → %s (%s)",
                            hop, current_url, next_url, e,
                        )
                        return None
                    current_url = next_url
                    continue

                if not resp.is_success:
                    return None

                content_type = resp.headers.get("content-type", "")
                if "text" not in content_type and "html" not in content_type:
                    return None

                text = _extract_text(resp.text)
                title = _extract_title(resp.text)
                content_hash = hashlib.sha256(resp.content).hexdigest()
                final_url = str(resp.url)

                return ParsedPage(
                    url=url,
                    canonical_url=final_url,
                    title=title,
                    text=text[:50_000],
                    language="en",
                    content_hash=content_hash,
                    word_count=len(text.split()),
                )

        # Exceeded MAX_REDIRECTS
        import logging
        logging.getLogger("ccj.provider").warning("Too many redirects for %s", url)
        return None

    async def parse_pdf(self, data: bytes) -> ParsedPage:
        return ParsedPage(
            url="", canonical_url="", title="PDF",
            text="[PDF parsing requires Docling provider]",
            content_hash=hashlib.sha256(data).hexdigest(),
        )


class DemoTranslationProvider(ITranslationProvider):
    """Passthrough translation. No API calls."""
    name = "demo-translation"

    async def is_available(self) -> bool:
        return True

    async def translate(
        self, text: str, target_language: str, source_language: str | None = None
    ) -> TranslationResult:
        detected = source_language or await self.detect_language(text)
        if detected == target_language:
            return TranslationResult(
                source_text=text, translated_text=text,
                source_language=detected, target_language=target_language,
                was_translated=False,
            )
        return TranslationResult(
            source_text=text,
            translated_text=f"[DEMO TRANSLATION → {target_language}] {text}",
            source_language=detected, target_language=target_language,
            was_translated=True,
        )

    async def detect_language(self, text: str) -> str:
        if re.search(r"[\u0900-\u097F]", text): return "hi"
        if re.search(r"[\u0600-\u06FF]", text): return "ar"
        return "en"


class DemoAIProvider(IAIProvider):
    """Rule-based AI responses. No API key required."""
    name = "demo-ai"

    async def is_available(self) -> bool:
        return True

    async def complete(
        self, messages: list[ChatMessage],
        max_tokens: int = 1000, temperature: float = 0.2,
        json_mode: bool = False,
    ) -> AIResult:
        await asyncio.sleep(0.2)
        user_content = next(
            (m.content for m in reversed(messages) if m.role == "user"), ""
        )

        if json_mode:
            content = json.dumps({
                "research_questions": [
                    f"What are the primary facts about: {user_content[:80]}?",
                    "Who are the key stakeholders?",
                    "What primary sources exist?",
                    "Are there contradictory accounts?",
                    "What is the legal/regulatory context?",
                ],
                "queries": [
                    {"query": user_content[:100], "language": "en", "provider": "demo", "priority": 1},
                ],
                "primary_source_targets": [],
                "secondary_source_targets": [],
                "social_source_targets": [],
                "legal_questions": [],
                "expected_entities": [],
                "date_range": {"start": None, "end": None},
                "risk_flags": [
                    "[DEMO MODE] Configure OPENAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_URL for real AI planning."
                ],
            })
            parsed = json.loads(content)
        else:
            content = (
                f"[DEMO AI] Response for: {user_content[:80]}\n\n"
                "Configure a live AI provider for real research planning and evidence extraction."
            )
            parsed = None

        return AIResult(
            content=content, model="demo-rule-based-v1",
            input_tokens=len(user_content), output_tokens=len(content),
            finish_reason="stop", parsed=parsed,
        )


# ── Helper functions ──────────────────────────────────────────

def _extract_text(html: str) -> str:
    html = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style[^>]*>.*?</style>",  " ", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


def _extract_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()[:300]
    return "Untitled"
