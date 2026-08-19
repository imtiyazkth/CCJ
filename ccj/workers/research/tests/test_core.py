"""
CCJ Research Worker — Regression Tests
Covers: SSRF, models, claim status, provider injection, redirect validation.
"""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock

from app.security import validate_fetch_url, SSRFError, resolve_redirect, is_private_ip
from app.models import ClaimRecord, EvidenceRecord, SourceRecord, ResearchRunRequest
from app.providers import (
    DemoSearchProvider, DemoAIProvider, DemoTranslationProvider,
    HttpDocumentProvider, ChatMessage,
)
from app.research_agent import ResearchAgent


# ══════════════════════════════════════════════════════════════
# SSRF — initial URL validation
# ══════════════════════════════════════════════════════════════

class TestSSRFInitialURL:
    def test_allows_public_https(self):
        assert validate_fetch_url("https://barandbench.com/article") is not None

    def test_allows_public_http(self):
        assert validate_fetch_url("http://livelaw.in/story") is not None

    def test_blocks_localhost(self):
        with pytest.raises(SSRFError, match="blocked"):
            validate_fetch_url("http://localhost/admin")

    def test_blocks_127_loopback(self):
        with pytest.raises(SSRFError):
            validate_fetch_url("http://127.0.0.1:8080/secret")

    def test_blocks_0_0_0_0(self):
        with pytest.raises(SSRFError):
            validate_fetch_url("http://0.0.0.0/internal")

    def test_blocks_private_10_range(self):
        with pytest.raises(SSRFError):
            validate_fetch_url("http://10.0.0.1/internal")

    def test_blocks_private_192_range(self):
        with pytest.raises(SSRFError):
            validate_fetch_url("http://192.168.1.1/router")

    def test_blocks_private_172_16_range(self):
        with pytest.raises(SSRFError):
            validate_fetch_url("http://172.16.0.1/internal")

    def test_blocks_aws_imds(self):
        with pytest.raises(SSRFError):
            validate_fetch_url("http://169.254.169.254/latest/meta-data/")

    def test_blocks_gcp_metadata(self):
        with pytest.raises(SSRFError):
            validate_fetch_url("http://metadata.google.internal/computeMetadata/v1/")

    def test_blocks_azure_metadata(self):
        with pytest.raises(SSRFError):
            validate_fetch_url("http://metadata.azure.internal/")

    def test_blocks_file_scheme(self):
        with pytest.raises(SSRFError, match="scheme"):
            validate_fetch_url("file:///etc/passwd")

    def test_blocks_ftp_scheme(self):
        with pytest.raises(SSRFError, match="scheme"):
            validate_fetch_url("ftp://files.example.com/data")

    def test_blocks_gopher_scheme(self):
        with pytest.raises(SSRFError, match="scheme"):
            validate_fetch_url("gopher://evil.example.com/")

    def test_rejects_invalid_url(self):
        with pytest.raises(SSRFError):
            validate_fetch_url("not_a_url_at_all")

    def test_rejects_empty_string(self):
        with pytest.raises(SSRFError):
            validate_fetch_url("")


# ══════════════════════════════════════════════════════════════
# SSRF — private IP detection (unit)
# ══════════════════════════════════════════════════════════════

class TestPrivateIPDetection:
    def test_rfc1918_10(self):      assert is_private_ip("10.0.0.1")
    def test_rfc1918_172(self):     assert is_private_ip("172.16.5.1")
    def test_rfc1918_192(self):     assert is_private_ip("192.168.1.1")
    def test_loopback(self):        assert is_private_ip("127.0.0.1")
    def test_link_local(self):      assert is_private_ip("169.254.1.1")
    def test_ipv6_loopback(self):   assert is_private_ip("::1")
    def test_ipv6_ula(self):        assert is_private_ip("fc00::1")
    def test_cgnat(self):           assert is_private_ip("100.64.0.1")

    def test_public_ip_allowed(self):       assert not is_private_ip("8.8.8.8")
    def test_cloudflare_dns_allowed(self):  assert not is_private_ip("1.1.1.1")
    def test_public_ipv6_allowed(self):     assert not is_private_ip("2001:db8::1")


# ══════════════════════════════════════════════════════════════
# SSRF — redirect resolution
# ══════════════════════════════════════════════════════════════

class TestRedirectResolution:
    def test_absolute_redirect(self):
        result = resolve_redirect("http://example.com/page", "https://other.com/new")
        assert result == "https://other.com/new"

    def test_relative_path_redirect(self):
        result = resolve_redirect("http://example.com/page", "/new-path")
        assert result == "http://example.com/new-path"

    def test_relative_subpath_redirect(self):
        result = resolve_redirect("http://example.com/dir/page", "sibling")
        assert result == "http://example.com/dir/sibling"

    def test_scheme_relative_redirect(self):
        result = resolve_redirect("https://example.com/page", "//cdn.example.com/asset")
        assert result == "https://cdn.example.com/asset"


# ══════════════════════════════════════════════════════════════
# SSRF — redirect hop validation (integration mock)
# ══════════════════════════════════════════════════════════════

class TestRedirectHopValidation:
    """
    Ensures HttpDocumentProvider blocks SSRF at every redirect hop,
    not just the initial URL.
    """

    @pytest.mark.asyncio
    async def test_redirect_to_private_ip_blocked(self):
        """
        Scenario: public URL → redirect to 169.254.169.254 (AWS metadata)
        The fetch must fail even though the initial URL was valid.
        """
        import httpx
        from unittest.mock import patch, AsyncMock

        provider = HttpDocumentProvider()

        # Mock: first request returns a 302 to the metadata endpoint
        mock_redirect = MagicMock()
        mock_redirect.is_redirect = True
        mock_redirect.is_success  = False
        mock_redirect.headers     = {"location": "http://169.254.169.254/latest/meta-data/"}

        with patch.object(httpx.AsyncClient, "get", AsyncMock(return_value=mock_redirect)):
            result = await provider.fetch_url("http://legit.example.com/article")
        # Must return None — redirect to private IP was blocked
        assert result is None

    @pytest.mark.asyncio
    async def test_redirect_to_localhost_blocked(self):
        import httpx
        from unittest.mock import patch, AsyncMock

        provider = HttpDocumentProvider()
        mock_redirect = MagicMock()
        mock_redirect.is_redirect = True
        mock_redirect.is_success  = False
        mock_redirect.headers     = {"location": "http://localhost/admin"}

        with patch.object(httpx.AsyncClient, "get", AsyncMock(return_value=mock_redirect)):
            result = await provider.fetch_url("http://legit.example.com/page")
        assert result is None

    @pytest.mark.asyncio
    async def test_too_many_redirects_returns_none(self):
        import httpx
        from unittest.mock import patch, AsyncMock

        provider = HttpDocumentProvider()
        # Always returns a redirect to a valid public URL
        mock_r = MagicMock()
        mock_r.is_redirect = True
        mock_r.is_success  = False
        mock_r.headers     = {"location": "https://example.com/loop"}

        with patch.object(httpx.AsyncClient, "get", AsyncMock(return_value=mock_r)):
            result = await provider.fetch_url("https://example.com/start")
        assert result is None  # Exceeded MAX_REDIRECTS


# ══════════════════════════════════════════════════════════════
# Demo providers
# ══════════════════════════════════════════════════════════════

class TestDemoProviders:
    @pytest.mark.asyncio
    async def test_demo_search_available(self):
        assert await DemoSearchProvider().is_available() is True

    @pytest.mark.asyncio
    async def test_demo_search_returns_results(self):
        results = await DemoSearchProvider().search("BCI NALSAR 2026")
        assert len(results) > 0
        assert all(r.url for r in results)

    @pytest.mark.asyncio
    async def test_demo_search_respects_max_results(self):
        results = await DemoSearchProvider().search("test", max_results=1)
        assert len(results) <= 1

    @pytest.mark.asyncio
    async def test_demo_ai_available(self):
        assert await DemoAIProvider().is_available() is True

    @pytest.mark.asyncio
    async def test_demo_ai_returns_json_plan(self):
        ai = DemoAIProvider()
        result = await ai.complete(
            messages=[ChatMessage(role="user", content="BCI NALSAR 2026")],
            json_mode=True,
        )
        assert result.parsed is not None
        assert "research_questions" in result.parsed
        assert "queries" in result.parsed

    @pytest.mark.asyncio
    async def test_demo_translation_passthrough_same_language(self):
        t = DemoTranslationProvider()
        result = await t.translate("Hello world", "en", "en")
        assert result.translated_text == "Hello world"
        assert result.was_translated is False

    @pytest.mark.asyncio
    async def test_demo_translation_different_language(self):
        t = DemoTranslationProvider()
        result = await t.translate("Hello world", "hi", "en")
        assert result.was_translated is True
        assert "DEMO TRANSLATION" in result.translated_text

    @pytest.mark.asyncio
    async def test_demo_language_detection_hindi(self):
        t = DemoTranslationProvider()
        lang = await t.detect_language("नमस्ते दुनिया")
        assert lang == "hi"

    @pytest.mark.asyncio
    async def test_demo_language_detection_arabic(self):
        t = DemoTranslationProvider()
        lang = await t.detect_language("مرحبا بالعالم")
        assert lang == "ar"

    @pytest.mark.asyncio
    async def test_demo_language_detection_english(self):
        t = DemoTranslationProvider()
        lang = await t.detect_language("Hello world this is English")
        assert lang == "en"


# ══════════════════════════════════════════════════════════════
# Research Agent — provider injection
# ══════════════════════════════════════════════════════════════

class TestResearchAgentProviderInjection:
    """Verifies agent uses injected providers, not hardcoded SearXNG."""

    @pytest.mark.asyncio
    async def test_agent_uses_injected_search_provider(self):
        mock_search = AsyncMock()
        mock_search.name = "mock-search"
        mock_search.is_available = AsyncMock(return_value=True)
        mock_search.search = AsyncMock(return_value=[])

        agent = ResearchAgent(search=mock_search)
        from app.models import SearchQueryModel
        await agent.execute_searches(
            [SearchQueryModel(query="test", language="en", provider="mock", priority=1)]
        )
        mock_search.search.assert_called_once()

    @pytest.mark.asyncio
    async def test_agent_uses_injected_ai_provider(self):
        mock_ai = AsyncMock()
        mock_ai.name = "mock-ai"
        mock_ai.is_available = AsyncMock(return_value=True)
        from app.providers import AIResult
        mock_ai.complete = AsyncMock(return_value=AIResult(
            content='{"research_questions":[],"queries":[],"primary_source_targets":[],'
                    '"secondary_source_targets":[],"social_source_targets":[],'
                    '"legal_questions":[],"expected_entities":[],'
                    '"date_range":{"start":null,"end":null},"risk_flags":[]}',
            model="mock", parsed={"research_questions":[],"queries":[],"primary_source_targets":[],
                                   "secondary_source_targets":[],"social_source_targets":[],
                                   "legal_questions":[],"expected_entities":[],
                                   "date_range":{"start":None,"end":None},"risk_flags":[]},
        ))

        agent = ResearchAgent(ai=mock_ai)
        plan = await agent.plan_research("test topic", "en", "standard", None, None)
        mock_ai.complete.assert_called_once()
        assert plan is not None

    @pytest.mark.asyncio
    async def test_agent_default_providers_are_demo(self):
        """Agent without arguments uses demo providers — no network calls."""
        agent = ResearchAgent()
        assert agent._search.name  == "demo-search"
        assert agent._ai.name      == "demo-ai"


# ══════════════════════════════════════════════════════════════
# Claim model — status policy
# ══════════════════════════════════════════════════════════════

class TestClaimStatusPolicy:
    def test_default_is_unverified(self):
        c = ClaimRecord(project_id="p1", claim_text="Some claim text here.",
                        claim_type="reported")
        assert c.status == "unverified"

    def test_verified_with_evidence_allowed(self):
        c = ClaimRecord(project_id="p1", claim_text="Claim with evidence.",
                        claim_type="fact", status="verified",
                        supporting_evidence_ids=["ev1"], confidence=0.95)
        assert c.status == "verified"

    def test_verified_without_evidence_rejected(self):
        with pytest.raises(Exception, match="supporting_evidence_id"):
            ClaimRecord(project_id="p1", claim_text="No evidence claim.",
                        claim_type="fact", status="verified",
                        supporting_evidence_ids=[])

    def test_invalid_status_falls_back(self):
        c = ClaimRecord(project_id="p1", claim_text="Test claim text here.",
                        claim_type="fact", status="invented_status")
        assert c.status == "unverified"

    def test_confidence_out_of_range_rejected(self):
        with pytest.raises(Exception):
            ClaimRecord(project_id="p1", claim_text="Test.", claim_type="fact",
                        confidence=1.5)


# ══════════════════════════════════════════════════════════════
# Evidence model — quote integrity
# ══════════════════════════════════════════════════════════════

class TestEvidenceModel:
    def test_accepts_exact_quote(self):
        ev = EvidenceRecord(source_id="s1", quote="The letter was issued on 15 March 2026.",
                            confidence=0.9, language="en")
        assert "letter" in ev.quote

    def test_rejects_paraphrase_marker(self):
        with pytest.raises(Exception, match="paraphrase"):
            EvidenceRecord(source_id="s1",
                           quote="According to BCI, students were warned about conduct.")

    def test_confidence_must_be_0_to_1(self):
        with pytest.raises(Exception):
            EvidenceRecord(source_id="s1", quote="Valid quote from document.", confidence=1.5)

    def test_zero_confidence_accepted(self):
        ev = EvidenceRecord(source_id="s1", quote="Low confidence OCR result.", confidence=0.0)
        assert ev.confidence == 0.0


# ══════════════════════════════════════════════════════════════
# Source model
# ══════════════════════════════════════════════════════════════

class TestSourceModel:
    def test_valid_source(self):
        s = SourceRecord(research_run_id="r1", url="https://b.com", canonical_url="https://b.com",
                         domain="b.com", title="Title", source_type="news",
                         credibility_tier="credible", access_method="public_web",
                         content_hash="a"*64)
        assert s.domain == "b.com"

    def test_invalid_hash_rejected(self):
        with pytest.raises(Exception, match="content_hash"):
            SourceRecord(research_run_id="r1", url="https://b.com", canonical_url="https://b.com",
                         domain="b.com", title="T", source_type="webpage",
                         credibility_tier="unknown", access_method="public_web",
                         content_hash="short")

    def test_unknown_source_type_falls_back(self):
        s = SourceRecord(research_run_id="r1", url="https://b.com", canonical_url="https://b.com",
                         domain="b.com", title="T", source_type="blockchain_oracle",
                         credibility_tier="unknown", access_method="public_web",
                         content_hash="b"*64)
        assert s.source_type == "webpage"


# ══════════════════════════════════════════════════════════════
# ResearchRunRequest validation
# ══════════════════════════════════════════════════════════════

class TestResearchRunRequest:
    def test_valid(self):
        r = ResearchRunRequest(run_id="r1", project_id="p1",
                               topic="BCI vs NALSAR 2026", depth="standard")
        assert r.topic == "BCI vs NALSAR 2026"

    def test_short_topic_rejected(self):
        with pytest.raises(Exception):
            ResearchRunRequest(run_id="r1", project_id="p1", topic="AB")

    def test_invalid_depth_rejected(self):
        with pytest.raises(Exception):
            ResearchRunRequest(run_id="r1", project_id="p1",
                               topic="Valid topic text here", depth="extreme")

    def test_topic_whitespace_stripped(self):
        r = ResearchRunRequest(run_id="r1", project_id="p1", topic="  BCI NALSAR  ")
        assert r.topic == "BCI NALSAR"
