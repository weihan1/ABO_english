import asyncio
import httpx

from abo.config import is_paper_ai_scoring_enabled
from abo.paper_paths import build_dated_paper_title_for_path, sanitize_paper_title_for_path
from abo.sdk import Module, Item, Card, agent_json


class SemanticScholarTracker(Module):
    """Fetch follow-up papers from Semantic Scholar API."""

    id = "semantic-scholar-tracker"
    name = "Semantic Scholar 后续论文"
    schedule = "0 9 * * *"  # Daily at 9 AM
    icon = "git-branch"
    output = ["obsidian", "ui"]

    # Semantic Scholar API base URL
    API_BASE = "https://api.semanticscholar.org/graph/v1"

    # Default queries for scheduled execution (user's research interests)
    DEFAULT_QUERIES = ["VGGT", "Gaussian Splatting", "NeRF"]

    async def fetch_paper_details(self, arxiv_id: str) -> dict | None:
        """Fetch paper details from Semantic Scholar using arXiv ID."""
        # Remove arxiv: prefix if present
        clean_id = arxiv_id.replace("arxiv:", "").strip()

        url = f"{self.API_BASE}/paper/ARXIV:{clean_id}"
        params = {
            "fields": "paperId,title,abstract,year,citationCount,referenceCount,authors,citations,references"
        }

        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(url, params=params)
                    if resp.status_code == 200:
                        return resp.json()
                    elif resp.status_code == 404:
                        # Paper not found in S2
                        return None
                    elif resp.status_code == 429:
                        wait_time = 3 * (2 ** attempt)
                        print(f"[s2] Paper details rate limited, waiting {wait_time}s...")
                        if attempt < max_retries - 1:
                            await asyncio.sleep(wait_time)
                            continue
                        print(f"S2 API rate limited after {max_retries} retries")
                        return None
                    else:
                        print(f"S2 API error: {resp.status_code} - {resp.text[:200]}")
                        return None
            except Exception as e:
                print(f"Failed to fetch paper details (attempt {attempt+1}): {e}")
                if attempt == max_retries - 1:
                    return None
                await asyncio.sleep(2 ** attempt)
        return None

    async def search_paper_by_title(self, title: str) -> dict | None:
        """Search for a paper by title using Semantic Scholar search API."""
        import asyncio
        url = f"{self.API_BASE}/paper/search"
        params = {
            "query": title,
            "fields": "paperId,title,abstract,year,citationCount,referenceCount,authors,citations,references",
            "limit": 5
        }

        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(url, params=params)
                    if resp.status_code == 200:
                        data = resp.json()
                        papers = data.get("data", [])
                        print(f"[s2] Search returned {len(papers)} papers for '{title}'")
                        # Find best match - exact or contains title
                        for paper in papers:
                            paper_title = paper.get("title", "").lower()
                            search_title = title.lower()
                            if search_title in paper_title or paper_title in search_title:
                                print(f"[s2] Best match: {paper.get('title')}")
                                return paper
                        # Return first result if no good match
                        if papers:
                            print(f"[s2] Using first result: {papers[0].get('title')}")
                            return papers[0]
                        return None
                    elif resp.status_code == 429:
                        wait_time = 2 * (2 ** attempt)  # 2, 4, 8 seconds
                        print(f"[s2] Rate limited, waiting {wait_time}s...")
                        if attempt < max_retries - 1:
                            await asyncio.sleep(wait_time)
                            continue
                        print(f"S2 search API rate limited after {max_retries} retries")
                        return None
                    else:
                        print(f"S2 search API error: {resp.status_code} - {resp.text[:200]}")
                        return None
            except Exception as e:
                print(f"Failed to search paper by title (attempt {attempt+1}): {e}")
                if attempt == max_retries - 1:
                    return None
                await asyncio.sleep(2 ** attempt)
        return None

    async def fetch_citations(self, paper_id: str, limit: int = 20) -> list[dict]:
        """Fetch papers that cite this paper."""
        url = f"{self.API_BASE}/paper/{paper_id}/citations"
        params = {
            "fields": "paperId,title,abstract,year,citationCount,authors,url",
            "limit": limit
        }

        citations = []
        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(url, params=params)
                    if resp.status_code == 200:
                        data = resp.json()
                        for item in data.get("data", []):
                            citing_paper = item.get("citingPaper", {})
                            if citing_paper.get("title"):
                                citations.append(citing_paper)
                        print(f"[s2] Fetched {len(citations)} citations")
                        break
                    elif resp.status_code == 429:
                        wait_time = 2 * (2 ** attempt)
                        print(f"[s2] Citations rate limited, waiting {wait_time}s...")
                        if attempt < max_retries - 1:
                            await asyncio.sleep(wait_time)
                            continue
                        print(f"S2 citations API rate limited")
                        break
                    else:
                        print(f"S2 citations API error: {resp.status_code}")
                        break
            except Exception as e:
                print(f"Failed to fetch citations (attempt {attempt+1}): {e}")
                if attempt == max_retries - 1:
                    break
                await asyncio.sleep(2 ** attempt)

        return citations

    async def fetch_references(self, paper_id: str, limit: int = 20) -> list[dict]:
        """Fetch papers cited by this paper."""
        url = f"{self.API_BASE}/paper/{paper_id}/references"
        params = {
            "fields": "paperId,title,abstract,year,citationCount,authors,url",
            "limit": limit
        }

        references = []
        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(url, params=params)
                    if resp.status_code == 200:
                        data = resp.json()
                        for item in data.get("data", []):
                            cited_paper = item.get("citedPaper", {})
                            if cited_paper.get("title"):
                                references.append(cited_paper)
                        print(f"[s2] Fetched {len(references)} references")
                        break
                    elif resp.status_code == 429:
                        wait_time = 2 * (2 ** attempt)
                        print(f"[s2] References rate limited, waiting {wait_time}s...")
                        if attempt < max_retries - 1:
                            await asyncio.sleep(wait_time)
                            continue
                        print(f"S2 references API rate limited")
                        break
                    else:
                        print(f"S2 references API error: {resp.status_code}")
                        break
            except Exception as e:
                print(f"Failed to fetch references (attempt {attempt+1}): {e}")
                if attempt == max_retries - 1:
                    break
                await asyncio.sleep(2 ** attempt)

        return references

    async def fetch(
        self,
        arxiv_id: str = None,
        fetch_citations: bool = True,
        fetch_references: bool = False,
        limit: int = 20,
        queries: list[str] = None,
        days_back: int = 1,
    ) -> list[Item]:
        """Fetch follow-up papers for a given arXiv ID or paper title.

        For scheduled execution, uses DEFAULT_QUERIES to track research interests.
        """
        # Use provided queries or default queries for scheduled execution
        queries_to_use = queries if queries is not None else self.DEFAULT_QUERIES

        if queries_to_use:
            all_items = []
            for query in queries_to_use:
                items = await self._fetch_single(
                    query, fetch_citations, fetch_references, limit
                )
                all_items.extend(items)
            return all_items

        if not arxiv_id:
            return []

        return await self._fetch_single(arxiv_id, fetch_citations, fetch_references, limit)

    async def _fetch_single(
        self,
        arxiv_id: str,
        fetch_citations: bool = True,
        fetch_references: bool = False,
        limit: int = 20,
    ) -> list[Item]:
        """Fetch follow-up papers for a single arXiv ID or title."""

        # Check if input looks like an arXiv ID (digits and dots, optionally with version)
        import re
        is_arxiv_id = re.match(r'^\d{4}\.\d{4,5}(v\d+)?$', arxiv_id.strip()) is not None

        if is_arxiv_id:
            # Get paper details from S2 using arXiv ID
            paper_details = await self.fetch_paper_details(arxiv_id)
        else:
            # Search by title
            print(f"[s2] Searching by title: {arxiv_id}")
            paper_details = await self.search_paper_by_title(arxiv_id)

        if not paper_details:
            print(f"[s2] Paper not found: {arxiv_id}")
            return []

        paper_id = paper_details.get("paperId")
        if not paper_id:
            print(f"[s2] No paperId found for: {arxiv_id}")
            return []

        print(f"[s2] Found paper: {paper_details.get('title')} ({paper_id})")

        # Store original query for reference
        source_query = arxiv_id.strip()

        items = []

        # Fetch citations (papers citing this paper)
        if fetch_citations:
            citations = await self.fetch_citations(paper_id, limit)
            for paper in citations:
                items.append(
                    Item(
                        id=f"s2-citation-{paper.get('paperId', '')}",
                        raw={
                            "title": paper.get("title", ""),
                            "abstract": paper.get("abstract", ""),
                            "authors": [
                                a.get("name", "") for a in paper.get("authors", [])
                            ],
                            "year": paper.get("year"),
                            "citation_count": paper.get("citationCount", 0),
                            "url": paper.get("url", ""),
                            "paper_id": paper.get("paperId"),
                            "relationship": "citation",  # This paper cites the original
                            "source_arxiv_id": source_query,
                        },
                    )
                )

        # Fetch references (papers cited by this paper)
        if fetch_references:
            references = await self.fetch_references(paper_id, limit)
            for paper in references:
                items.append(
                    Item(
                        id=f"s2-reference-{paper.get('paperId', '')}",
                        raw={
                            "title": paper.get("title", ""),
                            "abstract": paper.get("abstract", ""),
                            "authors": [
                                a.get("name", "") for a in paper.get("authors", [])
                            ],
                            "year": paper.get("year"),
                            "citation_count": paper.get("citationCount", 0),
                            "url": paper.get("url", ""),
                            "paper_id": paper.get("paperId"),
                            "relationship": "reference",  # Original paper cites this
                            "source_arxiv_id": source_query,
                        },
                    )
                )

        return items

    async def process(self, items: list[Item], prefs: dict) -> list[Card]:
        """Process Semantic Scholar papers into cards."""
        cards = []
        ai_scoring_enabled = is_paper_ai_scoring_enabled()

        for item in items:
            p = item.raw

            # Skip items without abstracts
            if not p.get("abstract"):
                continue

            result = {}
            if ai_scoring_enabled:
                prompt = (
                    f'分析以下学术论文，返回 JSON（不要有其他文字）：\n'
                    f'{{"score":<1-10整数>,"summary":"<50字以内中文摘要>",'
                    f'"tags":["<tag1>","<tag2>","<tag3>"],"contribution":"<一句话核心创新>"}}\n\n'
                    f"标题：{p['title']}\n摘要：{p['abstract'][:600]}"
                )

                try:
                    result = await agent_json(prompt, prefs=prefs)
                except Exception:
                    result = {}

            authors = p.get("authors", [])
            safe_title = build_dated_paper_title_for_path(
                p["title"],
                p,
                fallback=item.id,
                max_length=120,
            )

            # Get source arXiv ID for subfolder naming
            source_arxiv = p.get("source_arxiv_id", "unknown")
            subfolder = source_arxiv[:6] if len(source_arxiv) >= 6 else source_arxiv

            # Build relationship label
            relationship = p.get("relationship", "citation")
            rel_label = "引用" if relationship == "citation" else "参考文献"

            cards.append(
                Card(
                    id=item.id,
                    title=p["title"],
                    summary=result.get("summary", p["abstract"][:100]),
                    score=min(result.get("score", 5), 10) / 10,
                    tags=result.get("tags", []) + [f"S2-{rel_label}"],
                    source_url=p.get("url", ""),
                    obsidian_path=f"Literature/FollowUps/{subfolder}/{safe_title}/{safe_title}.md",
                    metadata={
                        "abo-type": "semantic-scholar-paper",
                        "authors": authors,
                        "paper_id": p.get("paper_id"),
                        "s2_url": p.get("url"),
                        "year": p.get("year"),
                        "citation_count": p.get("citation_count", 0),
                        "contribution": result.get("contribution", ""),
                        "abstract": p["abstract"],
                        "keywords": result.get("tags", []),
                        "relationship": relationship,
                        "source_arxiv_id": source_arxiv,
                        "relationship_label": rel_label,
                    },
                )
            )

        return cards
