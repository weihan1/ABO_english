"""arXiv API tool - on-demand paper search using the official arxiv package"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from html import unescape
from io import BytesIO
from typing import Literal, Optional
import asyncio
import logging
import re
from pathlib import Path
from urllib.parse import urlsplit

import arxiv
import httpx

from .query_builder import compile_advanced_query, normalize_advanced_query

logger = logging.getLogger(__name__)

__all__ = [
    "ArxivAPITool",
    "ArxivPaper",
    "arxiv_api_search",
    "compile_advanced_query",
    "normalize_advanced_query",
    "extract_introduction_from_arxiv_html",
    "extract_introduction_from_pdf_text",
    "build_structured_digest_markdown",
    "build_arxiv_html_urls",
    "extract_figure_candidates_from_html",
]

_ARXIV_FIGURE_PATH_WITH_ID = re.compile(
    r"^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?/"
)
_ARXIV_HTML_BASES = (
    "https://arxiv.org",
    "https://ar5iv.labs.arxiv.org",
)
_FIGURE_PRIORITY_KEYWORDS = [
    ("pipeline", 30),
    ("architecture", 25),
    ("framework", 25),
    ("overview", 20),
    ("method", 20),
    ("system", 15),
    ("flowchart", 20),
    ("diagram", 15),
    ("structure", 15),
    ("model", 10),
    ("approach", 10),
    ("fig", 10),
    ("figure", 10),
]
_FIGURE_METHOD_KEYWORDS = {
    "architecture",
    "approach",
    "diagram",
    "fig",
    "figure",
    "flowchart",
    "framework",
    "illustration",
    "method",
    "model",
    "network",
    "overview",
    "pipeline",
    "proposed",
    "schematic",
    "structure",
    "system",
}
_FIGURE_SKIP_TOKENS = ("icon", "logo", "button", "spacer", "avatar", "arrow")


def build_arxiv_html_urls(arxiv_id: str) -> list[str]:
    return [f"{base}/html/{arxiv_id}" for base in _ARXIV_HTML_BASES]


def resolve_arxiv_figure_url(arxiv_id: str, src: str, html_url: str | None = None) -> str:
    """Normalize figure URLs extracted from arXiv/ar5iv HTML pages."""
    raw = (src or "").strip()
    if not raw or raw.startswith("data:"):
        return ""
    if raw.startswith(("http://", "https://")):
        return raw

    base_html_url = (html_url or f"https://arxiv.org/html/{arxiv_id}").rstrip("/")
    parsed = urlsplit(base_html_url)
    origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else "https://arxiv.org"
    if raw.startswith("/"):
        return f"{origin}{raw}"

    normalized = raw.lstrip("./")
    if _ARXIV_FIGURE_PATH_WITH_ID.match(normalized):
        return f"{origin}/html/{normalized}"
    return f"{base_html_url}/{normalized}"


def _score_figure_caption(alt: str) -> int:
    alt_lower = (alt or "").lower()
    return sum(points for keyword, points in _FIGURE_PRIORITY_KEYWORDS if keyword in alt_lower)


def extract_figure_candidates_from_html(
    html: str,
    arxiv_id: str,
    html_url: str,
    max_candidates: int = 20,
) -> list[dict]:
    if not html:
        return []

    img_pattern = r'<img[^>]+src="([^"]+)"[^>]*>'
    img_matches = list(re.finditer(img_pattern, html, re.IGNORECASE))

    figure_candidates: list[dict] = []
    found_urls: set[str] = set()

    for i, match in enumerate(img_matches[:max_candidates]):
        src = match.group(1)
        if not src:
            continue

        src_lower = src.lower()
        if src_lower.startswith("data:") or any(skip in src_lower for skip in _FIGURE_SKIP_TOKENS):
            continue

        img_tag = match.group(0)
        alt_match = re.search(r'alt="([^"]*)"', img_tag, re.IGNORECASE)
        alt = alt_match.group(1) if alt_match else ""

        normalized_src = resolve_arxiv_figure_url(arxiv_id, src, html_url=html_url)
        if not normalized_src or normalized_src in found_urls:
            continue
        found_urls.add(normalized_src)

        alt_lower = alt.lower()
        figure_candidates.append({
            "url": normalized_src,
            "caption": alt[:120] if alt else f"Figure {i + 1}",
            "score": _score_figure_caption(alt),
            "is_method": any(keyword in alt_lower for keyword in _FIGURE_METHOD_KEYWORDS),
            "type": "img",
            "index": i,
        })

    return figure_candidates


def _normalize_heading_text(text: str) -> str:
    normalized = re.sub(r"\s+", " ", unescape(text or "")).strip().casefold()
    normalized = re.sub(r"^(section|chapter)\s+", "", normalized)
    normalized = re.sub(r"^\d+(?:[.\-]\d+)*\s*", "", normalized)
    normalized = re.sub(r"^(?:[ivxlcdm]+(?:[.\-][ivxlcdm]+)*)\s+", "", normalized)
    return normalized.strip(" :.-")


def _clean_html_text(fragment: str) -> str:
    text = re.sub(r"<(?:script|style|svg|math)\b.*?</(?:script|style|svg|math)>", " ", fragment, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</div\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\[[^\]]+\]", " ", text)
    text = re.sub(r"\s+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def extract_introduction_from_arxiv_html(html: str, max_paragraphs: int = 8, max_chars: int = 6000) -> str:
    """Extract the Introduction section text from arXiv HTML."""
    if not html:
        return ""

    heading_pattern = re.compile(
        r"<h(?P<level>[1-6])\b[^>]*>(?P<content>.*?)</h(?P=level)>",
        re.IGNORECASE | re.DOTALL,
    )
    matches = list(heading_pattern.finditer(html))
    if not matches:
        return ""

    intro_index = -1
    intro_level = 0
    for index, match in enumerate(matches):
        heading_text = _normalize_heading_text(_clean_html_text(match.group("content")))
        if heading_text.startswith("introduction"):
            intro_index = index
            intro_level = int(match.group("level"))
            break

    if intro_index < 0:
        return ""

    start = matches[intro_index].end()
    end = len(html)
    for next_match in matches[intro_index + 1:]:
        if int(next_match.group("level")) <= intro_level:
            end = next_match.start()
            break

    fragment = html[start:end]
    paragraph_matches = re.findall(r"<p\b[^>]*>(.*?)</p>", fragment, flags=re.IGNORECASE | re.DOTALL)
    if not paragraph_matches:
        paragraph_matches = re.findall(r'<div\b[^>]*class="[^"]*ltx_para[^"]*"[^>]*>(.*?)</div>', fragment, flags=re.IGNORECASE | re.DOTALL)

    paragraphs: list[str] = []
    current_length = 0
    for paragraph_html in paragraph_matches:
        paragraph = _clean_html_text(paragraph_html)
        if len(paragraph) < 40:
            continue
        paragraphs.append(paragraph)
        current_length += len(paragraph)
        if len(paragraphs) >= max_paragraphs or current_length >= max_chars:
            break

    return "\n\n".join(paragraphs).strip()


def extract_introduction_from_pdf_text(text: str, max_chars: int = 6000) -> str:
    """Extract the Introduction section from PDF-extracted plain text."""
    if not text:
        return ""

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"-\n(?=\w)", "", normalized)
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)

    start_match = re.search(
        r"(?im)^\s*(?:\d+(?:\.\d+)*|[ivxlcdm]+(?:\.[ivxlcdm]+)*)[.)]?\s+introduction\s*$|^\s*introduction\s*$",
        normalized,
    )
    if not start_match:
        return ""

    remainder = normalized[start_match.end():].lstrip()
    end_match = re.search(
        r"(?im)^\s*(?:\d+(?:\.\d+)*|[ivxlcdm]+(?:\.[ivxlcdm]+)*)[.)]?\s+"
        r"(?:related work|background|preliminaries|method|methods|approach|experiments|conclusion|references)\s*$",
        remainder,
    )
    snippet = remainder[:end_match.start()] if end_match else remainder[:max_chars]
    snippet = snippet.strip()
    if not snippet:
        return ""

    paragraphs = [re.sub(r"\s+", " ", paragraph).strip() for paragraph in re.split(r"\n\s*\n", snippet) if paragraph.strip()]
    collected: list[str] = []
    current_length = 0
    for paragraph in paragraphs:
        if len(paragraph) < 40:
            continue
        collected.append(paragraph)
        current_length += len(paragraph)
        if current_length >= max_chars:
            break

    return "\n\n".join(collected).strip()


def build_structured_digest_markdown(abstract: str, introduction: str) -> str:
    """Build a predictable markdown digest block for downstream summarization."""
    abstract_text = (abstract or "").strip()
    introduction_text = (introduction or "").strip()

    parts = [
        "<!-- ABO_DIGEST_START -->",
        "## ABO Digest",
        "",
        "### Abstract",
        abstract_text or "N/A",
        "",
        "### Introduction",
        introduction_text or "N/A",
        "<!-- ABO_DIGEST_END -->",
    ]
    return "\n".join(parts).strip()


@dataclass
class ArxivPaper:
    """Standardized arXiv paper result"""
    id: str
    title: str
    authors: list[str]
    summary: str
    published: datetime
    updated: datetime
    categories: list[str]
    primary_category: str
    pdf_url: str
    arxiv_url: str
    doi: Optional[str]
    journal_ref: Optional[str]
    comment: Optional[str]


class ArxivAPITool:
    """Wrapper around the arxiv package for ABO integration"""

    _last_request_time = 0.0

    def __init__(self):
        self.client = arxiv.Client(
            page_size=100,
            delay_seconds=3.0,
            num_retries=3
        )

    async def _rate_limited_request(self, client: httpx.AsyncClient, url: str, timeout: int = 60) -> httpx.Response:
        """Make a polite request to arXiv HTML endpoints."""
        import time

        min_interval = 3.0
        elapsed = time.time() - ArxivAPITool._last_request_time
        if elapsed < min_interval:
            await asyncio.sleep(min_interval - elapsed)

        resp = await client.get(url, headers={"User-Agent": "ABO-arXiv-API/1.0"}, timeout=timeout)
        ArxivAPITool._last_request_time = time.time()
        return resp

    def _build_query(
        self,
        keywords: list[str],
        categories: Optional[list[str]] = None,
        mode: Literal["AND", "OR"] = "OR",
        author: Optional[str] = None,
        title: Optional[str] = None,
    ) -> str:
        parts = []

        if keywords:
            if mode == "AND":
                kw_query = " AND ".join(f'"{kw}"' for kw in keywords)
                parts.append(f"({kw_query})")
            else:
                kw_query = " OR ".join(f'"{kw}"' for kw in keywords)
                parts.append(f"({kw_query})")

        if categories:
            cat_query = " OR ".join(f"cat:{cat}" for cat in categories)
            parts.append(f"({cat_query})")

        if author:
            parts.append(f'au:"{author}"')

        if title:
            parts.append(f'ti:"{title}"')

        return " AND ".join(parts) if parts else "all:*"

    async def search(
        self,
        keywords: list[str] | None = None,
        categories: Optional[list[str]] = None,
        mode: Literal["AND", "OR"] = "OR",
        max_results: int | None = 50,
        days_back: Optional[int] = None,
        sort_by: Literal["submittedDate", "relevance", "lastUpdatedDate"] = "submittedDate",
        sort_order: Literal["descending", "ascending"] = "descending",
        author: Optional[str] = None,
        title: Optional[str] = None,
        advanced: dict | None = None,
    ) -> list[ArxivPaper]:
        """Search arXiv for papers matching the given criteria.

        Args:
            keywords: List of search keywords
            categories: Optional list of arXiv categories (e.g., ["cs.AI", "cs.LG"])
            mode: "AND" or "OR" for combining keywords
            max_results: Maximum number of results to return, or None for all available
            days_back: Optional filter for papers published within N days
            sort_by: Sort criterion ("submittedDate", "relevance", "lastUpdatedDate")
            sort_order: Sort direction ("descending" or "ascending")
            author: Optional author name filter
            title: Optional title filter

        Returns:
            List of ArxivPaper objects matching the search criteria
        """
        if advanced:
            normalized = normalize_advanced_query(advanced)
            if normalized:
                query = compile_advanced_query(normalized)
                if normalized.get("sort_by"):
                    sort_by = normalized["sort_by"]
                if normalized.get("sort_order"):
                    sort_order = normalized["sort_order"]
                if normalized.get("max_results"):
                    max_results = normalized["max_results"]
            else:
                query = self._build_query(keywords or [], categories, mode, author, title)
        else:
            query = self._build_query(keywords or [], categories, mode, author, title)

        sort_map = {
            "submittedDate": arxiv.SortCriterion.SubmittedDate,
            "relevance": arxiv.SortCriterion.Relevance,
            "lastUpdatedDate": arxiv.SortCriterion.LastUpdatedDate,
        }
        sort_criterion = sort_map.get(sort_by, arxiv.SortCriterion.SubmittedDate)
        if sort_by not in sort_map:
            logger.warning(f"Invalid sort_by value: {sort_by}, using 'submittedDate'")

        sort_dir_map = {
            "descending": arxiv.SortOrder.Descending,
            "ascending": arxiv.SortOrder.Ascending,
        }
        sort_direction = sort_dir_map.get(sort_order, arxiv.SortOrder.Descending)
        if sort_order not in sort_dir_map:
            logger.warning(f"Invalid sort_order value: {sort_order}, using 'descending'")

        search = arxiv.Search(
            query=query,
            max_results=max_results,
            sort_by=sort_criterion,
            sort_order=sort_direction,
        )

        try:
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(None, lambda: list(self.client.results(search)))
        except Exception as e:
            logger.error(f"[arxiv_api] Failed to search arXiv: {e}")
            return []

        papers = []
        cutoff = datetime.utcnow() - timedelta(days=days_back) if days_back else None

        for result in results:
            if cutoff and result.published.replace(tzinfo=None) < cutoff:
                continue

            papers.append(ArxivPaper(
                id=result.get_short_id(),
                title=result.title,
                authors=[str(a) for a in result.authors],
                summary=result.summary,
                published=result.published,
                updated=result.updated,
                categories=result.categories,
                primary_category=result.primary_category,
                pdf_url=result.pdf_url,
                arxiv_url=result.entry_id,
                doi=result.doi,
                journal_ref=result.journal_ref,
                comment=result.comment,
            ))

        return papers

    async def fetch_figures(self, arxiv_id: str) -> list[dict]:
        """Fetch figures from arXiv HTML version."""
        figures = []

        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                found_urls: set[str] = set()

                for html_url in build_arxiv_html_urls(arxiv_id):
                    source_added = 0
                    resp = await self._rate_limited_request(client, html_url, timeout=15)
                    if resp.status_code != 200:
                        continue

                    candidates = extract_figure_candidates_from_html(resp.text, arxiv_id, html_url)
                    for candidate in candidates:
                        src = candidate["url"]
                        if src in found_urls:
                            continue
                        found_urls.add(src)
                        figures.append({
                            "url": src,
                            "caption": candidate["caption"][:100] if candidate["caption"] else "",
                            "is_method": candidate["is_method"],
                            "type": candidate["type"],
                        })
                        source_added += 1
                        if len(figures) >= 8:
                            break

                    if source_added or len(figures) >= 8:
                        break

            # Sort: prioritize method figures, then by caption
            figures.sort(key=lambda x: (not x['is_method'], x['caption']))
            figures = figures[:4]  # Limit to top 4 figures

        except Exception as e:
            logger.warning(f"Failed to fetch figures for {arxiv_id}: {e}")

        return figures

    async def fetch_introduction(self, arxiv_id: str) -> str:
        """Fetch the Introduction section with HTML and PDF fallbacks."""
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                for html_url in build_arxiv_html_urls(arxiv_id):
                    introduction = await self._fetch_introduction_from_html(client, html_url)
                    if introduction:
                        return introduction

                return await self._fetch_introduction_from_pdf(client, arxiv_id)
        except Exception as e:
            logger.warning(f"Failed to fetch introduction for {arxiv_id}: {e}")
            return ""

    async def _fetch_introduction_from_html(self, client: httpx.AsyncClient, html_url: str) -> str:
        resp = await self._rate_limited_request(client, html_url, timeout=20)
        if resp.status_code != 200:
            return ""
        return extract_introduction_from_arxiv_html(resp.text)

    async def _fetch_introduction_from_pdf(self, client: httpx.AsyncClient, arxiv_id: str) -> str:
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        resp = await client.get(pdf_url, headers={"User-Agent": "ABO-arXiv-API/1.0"}, timeout=40)
        if resp.status_code != 200 or resp.content[:4] != b"%PDF":
            return ""

        try:
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(resp.content))
            text = "\n".join((page.extract_text() or "") for page in reader.pages[:8])
            return extract_introduction_from_pdf_text(text)
        except Exception as e:
            logger.warning(f"Failed to parse PDF introduction for {arxiv_id}: {e}")
            return ""

    def to_dict(self, paper: ArxivPaper) -> dict:
        """Convert an ArxivPaper to a dictionary.

        Args:
            paper: ArxivPaper instance to convert

        Returns:
            Dictionary representation of the paper
        """
        return {
            "id": paper.id,
            "title": paper.title,
            "authors": paper.authors,
            "summary": paper.summary,
            "published": paper.published.isoformat() if paper.published else None,
            "updated": paper.updated.isoformat() if paper.updated else None,
            "categories": paper.categories,
            "primary_category": paper.primary_category,
            "pdf_url": paper.pdf_url,
            "arxiv_url": paper.arxiv_url,
            "doi": paper.doi,
            "journal_ref": paper.journal_ref,
            "comment": paper.comment,
        }


async def arxiv_api_search(
    keywords: list[str] | None = None,
    categories: Optional[list[str]] = None,
    mode: Literal["AND", "OR"] = "OR",
    max_results: int | None = 50,
    days_back: Optional[int] = None,
    sort_by: Literal["submittedDate", "relevance", "lastUpdatedDate"] = "submittedDate",
    sort_order: Literal["descending", "ascending"] = "descending",
    author: Optional[str] = None,
    title: Optional[str] = None,
    advanced: dict | None = None,
) -> list[dict]:
    """Convenience function to search arXiv and return results as dictionaries.

    Args:
        keywords: List of search keywords
        categories: Optional list of arXiv categories (e.g., ["cs.AI", "cs.LG"])
        mode: "AND" or "OR" for combining keywords
        max_results: Maximum number of results to return, or None for all available
        days_back: Optional filter for papers published within N days
        sort_by: Sort criterion ("submittedDate", "relevance", "lastUpdatedDate")
        sort_order: Sort direction ("descending" or "ascending")
        author: Optional author name filter
        title: Optional title filter

    Returns:
        List of dictionaries containing paper information
    """
    tool = ArxivAPITool()
    papers = await tool.search(
        keywords=keywords or [],
        categories=categories,
        mode=mode,
        max_results=max_results,
        days_back=days_back,
        sort_by=sort_by,
        sort_order=sort_order,
        author=author,
        title=title,
        advanced=advanced,
    )
    return [tool.to_dict(p) for p in papers]
