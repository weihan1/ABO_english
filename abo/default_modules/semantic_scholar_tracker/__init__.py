"""
Semantic Scholar 论文追踪器 - 用于查找某篇论文的后续研究（引用该论文的论文）
API Key: fxlcd3addOaOHGTwYCVLF1kmJBA0hYVy62KShAP4
"""

from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx

from abo.config import is_paper_ai_scoring_enabled
from abo.paper_paths import build_dated_paper_title_for_path, sanitize_paper_title_for_path
from abo.paper_tracking import load_module_preferences, normalize_followup_monitors
from abo.sdk import Module, Item, Card, agent_json
from abo.store.cards import CardStore
from abo.store.papers import PaperStore


class SemanticScholarTracker(Module):
    id       = "semantic-scholar-tracker"
    name     = "Semantic Scholar 后续论文"
    schedule = "0 9 * * *"  # 每天早上9点
    icon     = "git-branch"
    output   = ["obsidian", "ui"]

    # Default Semantic Scholar API Key (embedded fallback)
    DEFAULT_API_KEY = "fxlcd3addOaOHGTwYCVLF1kmJBA0hYVy62KShAP4"
    BASE_URL = "https://api.semanticscholar.org/graph/v1"

    @property
    def API_KEY(self) -> str:
        """Get API key from config or use default."""
        from abo.config import get_semantic_scholar_api_key
        user_key = get_semantic_scholar_api_key()
        return user_key if user_key else self.DEFAULT_API_KEY

    # Rate limiting
    _last_request_time = 0
    _request_count = 0
    _rate_limit_reset = None

    def _load_config(self) -> dict:
        return load_module_preferences(self.id)

    def _load_existing_ids(self) -> set[str]:
        existing_ids = set(PaperStore().existing_identifiers(saved_only=True))
        try:
            existing_ids.update(
                CardStore().existing_processed_content_ids(
                    module_ids=["arxiv-tracker", self.id],
                )
            )
        except Exception as exc:
            print(f"[s2] Failed to load crawl history identifiers: {exc}")
        return existing_ids

    async def _rate_limited_request(self, client: httpx.AsyncClient, url: str, params: dict = None) -> httpx.Response:
        """Make a rate-limited request to Semantic Scholar API."""
        import time
        import asyncio

        # Semantic Scholar 限制: 100 requests/5 minutes
        # 使用保守的 1秒间隔
        min_interval = 1.0
        elapsed = time.time() - SemanticScholarTracker._last_request_time
        if elapsed < min_interval:
            await asyncio.sleep(min_interval - elapsed)

        headers = {
            "User-Agent": "ABO-SemanticScholar-Tracker/1.0",
        }
        if self.API_KEY:
            headers["x-api-key"] = self.API_KEY

        max_retries = 4
        resp: httpx.Response | None = None

        for attempt in range(max_retries):
            elapsed = time.time() - SemanticScholarTracker._last_request_time
            if elapsed < min_interval:
                await asyncio.sleep(min_interval - elapsed)

            resp = await client.get(url, headers=headers, params=params, timeout=60)
            SemanticScholarTracker._last_request_time = time.time()

            if resp.status_code not in {429, 500, 502, 503, 504}:
                break

            if attempt == max_retries - 1:
                break

            retry_after = resp.headers.get("retry-after")
            if retry_after:
                try:
                    wait_seconds = float(retry_after)
                except ValueError:
                    wait_seconds = 2.0 * (attempt + 1)
            else:
                wait_seconds = min(30.0, 2.0 * (2 ** attempt))

            print(
                f"[s2] Request retry {attempt + 1}/{max_retries - 1} "
                f"after status {resp.status_code}, waiting {wait_seconds:.1f}s"
            )
            await asyncio.sleep(wait_seconds)

        if resp is None:
            raise RuntimeError("Semantic Scholar request failed before response was created")

        remaining = resp.headers.get("x-ratelimit-remaining")
        try:
            if remaining is not None and int(remaining) < 10:
                print(f"[s2] Rate limit low: {remaining} remaining, slowing down...")
                await asyncio.sleep(3)
        except ValueError:
            pass

        return resp

    async def search_paper_by_title(self, client: httpx.AsyncClient, title: str) -> dict | None:
        """通过标题搜索论文"""
        url = f"{self.BASE_URL}/paper/search"
        params = {
            "query": title,
            "fields": "paperId,title,authors,year,citationCount,referenceCount,abstract,tldr,openAccessPdf,fieldsOfStudy,publicationDate,venue,externalIds,url",
            "limit": 5
        }

        resp = await self._rate_limited_request(client, url, params)

        if resp.status_code != 200:
            print(f"[s2] Search error: {resp.status_code} - {resp.text[:200]}")
            return None

        data = resp.json()
        papers = data.get("data", [])

        # 找到最匹配的（标题相似度最高）
        if not papers:
            return None

        # 返回第一个结果（Semantic Scholar 的相关度排序通常很好）
        return papers[0]

    async def search_paper_by_arxiv_id(self, client: httpx.AsyncClient, arxiv_id: str) -> dict | None:
        """通过 arXiv ID 搜索论文"""
        # 移除版本号
        arxiv_id_clean = arxiv_id.split("v")[0]

        url = f"{self.BASE_URL}/paper/search"
        params = {
            "query": f"arxiv:{arxiv_id_clean}",
            "fields": "paperId,title,authors,year,citationCount,referenceCount,abstract,tldr,openAccessPdf,fieldsOfStudy,publicationDate,venue,externalIds,url",
            "limit": 3
        }

        resp = await self._rate_limited_request(client, url, params)

        if resp.status_code != 200:
            print(f"[s2] Search by arxiv id error: {resp.status_code}")
            return None

        data = resp.json()
        papers = data.get("data", [])

        if papers:
            return papers[0]

        # 如果直接搜索没找到，尝试用 ArXiv 标题搜索
        arxiv_url = f"https://export.arxiv.org/api/query?id_list={arxiv_id_clean}"
        try:
            arxiv_resp = await client.get(arxiv_url, timeout=30)
            if arxiv_resp.status_code == 200:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(arxiv_resp.text)
                ns = {"a": "http://www.w3.org/2005/Atom"}
                entry = root.find("a:entry", ns)
                if entry is not None:
                    title_elem = entry.find("a:title", ns)
                    if title_elem is not None and title_elem.text:
                        title = title_elem.text.strip().replace("\n", " ")
                        return await self.search_paper_by_title(client, title)
        except Exception as e:
            print(f"[s2] Fallback to arxiv title search failed: {e}")

        return None

    async def _resolve_source_paper_with_client(self, client: httpx.AsyncClient, query: str) -> dict | None:
        if query.startswith("arxiv") or ":" in query or "/" in query:
            arxiv_id = query.replace("arxiv:", "").replace("arxiv.org/abs/", "").strip("/")
            return await self.search_paper_by_arxiv_id(client, arxiv_id)
        if len(query) < 15 and (query[0:4].isdigit() or "." in query):
            return await self.search_paper_by_arxiv_id(client, query)
        return await self.search_paper_by_title(client, query)

    async def resolve_source_paper(self, query: str) -> dict | None:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            return await self._resolve_source_paper_with_client(client, query)

    def _parse_publication_datetime(self, paper: dict) -> datetime | None:
        """Parse publication date with a year-only fallback."""
        publication_date = paper.get("publicationDate", "")
        if publication_date:
            try:
                return datetime.fromisoformat(publication_date.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                pass

        year = paper.get("year")
        if isinstance(year, int) and year > 0:
            return datetime(year, 1, 1)

        return None

    def _sort_papers(self, papers: list[dict], sort_by: Literal["recency", "citation_count"]) -> list[dict]:
        """Sort papers deterministically for presentation and filtering."""
        if sort_by == "citation_count":
            return sorted(
                papers,
                key=lambda paper: (
                    int(paper.get("citationCount") or 0),
                    self._parse_publication_datetime(paper) or datetime.min,
                    paper.get("title", "").lower(),
                ),
                reverse=True,
            )

        return sorted(
            papers,
            key=lambda paper: (
                self._parse_publication_datetime(paper) or datetime.min,
                int(paper.get("citationCount") or 0),
                paper.get("title", "").lower(),
            ),
                reverse=True,
            )

    def _normalize_source_paper(self, paper: dict) -> dict:
        """Normalize source-paper metadata so it can be persisted alongside follow-ups."""
        authors = []
        for author in paper.get("authors", []):
            if isinstance(author, dict):
                name = author.get("name", "")
            else:
                name = str(author or "")
            if name:
                authors.append(name)

        paper_id = paper.get("paperId", "") or paper.get("paper_id", "")
        external_ids = paper.get("externalIds", {}) or paper.get("external_ids", {}) or {}
        arxiv_id = external_ids.get("ArXiv", "") or paper.get("arxiv_id", "")
        s2_url = paper.get("url", "") or (f"https://www.semanticscholar.org/paper/{paper_id}" if paper_id else "")
        arxiv_url = f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else ""

        tldr_field = paper.get("tldr")
        if isinstance(tldr_field, dict):
            tldr_text = str(tldr_field.get("text") or "").strip()
        else:
            tldr_text = str(tldr_field or paper.get("tldr_text") or "").strip()
        open_access = paper.get("openAccessPdf") or paper.get("open_access_pdf") or {}
        open_access_pdf = str((open_access or {}).get("url") or "").strip() if isinstance(open_access, dict) else ""

        return {
            "title": paper.get("title", "Unknown"),
            "abstract": paper.get("abstract", ""),
            "tldr": tldr_text,
            "open_access_pdf": open_access_pdf,
            "authors": authors,
            "year": paper.get("year"),
            "venue": paper.get("venue", ""),
            "citation_count": paper.get("citationCount", paper.get("citation_count", 0)),
            "reference_count": paper.get("referenceCount", paper.get("reference_count", 0)),
            "fields_of_study": paper.get("fieldsOfStudy", paper.get("fields_of_study", [])) or [],
            "published": paper.get("publicationDate", paper.get("published", "")),
            "paper_id": paper_id,
            "arxiv_id": arxiv_id,
            "external_ids": external_ids,
            "s2_url": s2_url,
            "arxiv_url": arxiv_url,
            "url": arxiv_url or s2_url,
        }

    def source_paper_to_item(self, source_paper: dict) -> Item:
        normalized = self._normalize_source_paper(source_paper)
        item_id = normalized["arxiv_id"] or (f"s2_{normalized['paper_id']}" if normalized["paper_id"] else normalized["title"])
        return Item(
            id=item_id,
            raw={
                **normalized,
                "author_count": len(normalized["authors"]),
                "paper_tracking_role": "source",
                "source_paper_title": normalized["title"],
                "source_paper": normalized,
            },
        )

    async def get_citing_papers(
        self,
        client: httpx.AsyncClient,
        paper_id: str,
        max_results: int | None = None,
    ) -> list[dict]:
        """获取引用该论文的论文列表，自动翻完所有分页。"""
        url = f"{self.BASE_URL}/paper/{paper_id}/citations"
        papers = []
        seen_paper_ids: set[str] = set()
        offset = 0
        page_size = 100

        while True:
            remaining = None if max_results is None else max_results - len(papers)
            if remaining is not None and remaining <= 0:
                break

            params = {
                # Note: S2 /paper/{id}/citations does NOT support tldr field (400 otherwise).
                # tldr is only available on /paper/search and /paper/{id}.
                "fields": "paperId,title,authors,year,citationCount,referenceCount,abstract,openAccessPdf,fieldsOfStudy,publicationDate,venue,externalIds,url",
                "offset": offset,
                "limit": page_size if remaining is None else min(page_size, remaining),
            }

            resp = await self._rate_limited_request(client, url, params)

            if resp.status_code != 200:
                print(f"[s2] Get citations error: {resp.status_code} - {resp.text[:200]}")
                break

            data = resp.json()
            citing = data.get("data", [])
            if not citing:
                break

            for item in citing:
                paper = item.get("citingPaper", {})
                paper_id_value = paper.get("paperId", "")
                if not paper or not paper_id_value or paper_id_value in seen_paper_ids:
                    continue
                seen_paper_ids.add(paper_id_value)
                papers.append(paper)

            next_offset = data.get("next")
            if next_offset is None or next_offset == offset:
                break
            offset = next_offset

        return papers

    async def fetch_followups(
        self,
        query: str,  # arXiv ID 或论文标题
        max_results: int | None = None,
        days_back: int | None = None,
        existing_ids: set[str] | None = None,
        sort_by: Literal["recency", "citation_count"] = "recency",
        source_paper: dict | None = None,
    ) -> list[Item]:
        """
        查找某篇论文的后续研究（引用该论文的论文）

        Args:
            query: arXiv ID (如 "2501.12345") 或论文标题
            max_results: 最大结果数；为 None 或 <=0 时表示全量抓取
            days_back: 只获取最近 N 天发表的论文；为 None 或 <=0 时不限制
            existing_ids: 已存在的论文 ID 集合（用于去重）
        """
        print(f"[s2] Searching for follow-ups of: {query}")

        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            # Step 1: 找到源论文
            source_paper = source_paper or await self._resolve_source_paper_with_client(client, query)

            if not source_paper:
                print(f"[s2] Source paper not found: {query}")
                return []

            paper_id = source_paper.get("paperId")
            paper_title = source_paper.get("title", "Unknown")
            normalized_source_paper = self._normalize_source_paper(source_paper)
            print(f"[s2] Found source paper: {paper_title} (ID: {paper_id})")

            # Step 2: 获取引用该论文的论文
            normalized_max_results = max_results if max_results and max_results > 0 else None
            citing_papers = await self.get_citing_papers(client, paper_id)
            print(
                f"[s2] Found {len(citing_papers)} citing papers "
                f"(source citationCount={source_paper.get('citationCount', 'unknown')})"
            )

            # Step 3: 过滤和转换
            items = []
            cutoff = None
            if days_back and days_back > 0:
                cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days_back)
            existing_ids = existing_ids or set()
            seen_item_ids = set(existing_ids)
            filtered_papers = []
            date_matched_count = 0
            skipped_existing_count = 0
            outside_window_count = 0
            missing_date_count = 0

            for paper in citing_papers:
                paper_id_new = paper.get("paperId", "")
                external_ids = paper.get("externalIds", {}) or {}
                arxiv_id = external_ids.get("ArXiv", "")
                dedupe_key = arxiv_id if arxiv_id else (f"s2_{paper_id_new}" if paper_id_new else "")

                published_at = self._parse_publication_datetime(paper)
                if cutoff and published_at and published_at < cutoff:
                    outside_window_count += 1
                    continue
                if cutoff and not published_at:
                    missing_date_count += 1
                    continue

                date_matched_count += 1

                if paper_id_new in existing_ids or (dedupe_key and dedupe_key in seen_item_ids):
                    skipped_existing_count += 1
                    continue

                filtered_papers.append(paper)

            sorted_papers = self._sort_papers(filtered_papers, sort_by=sort_by)
            if normalized_max_results is not None:
                sorted_papers = sorted_papers[:normalized_max_results]

            for paper in sorted_papers:
                item = self._paper_to_item(paper, source_paper=normalized_source_paper)
                if item.id in seen_item_ids:
                    continue
                seen_item_ids.add(item.id)
                items.append(item)

            print(
                f"[s2] Filtered to {len(items)} follow-up papers "
                f"(days_back={days_back or 'all'}, sort_by={sort_by}, "
                f"date_matched={date_matched_count}, skipped_existing={skipped_existing_count}, "
                f"outside_window={outside_window_count}, missing_date={missing_date_count})"
            )
            return items

    def _paper_to_item(self, paper: dict, source_paper: dict | None = None) -> Item:
        """将 Semantic Scholar 论文转换为 Item"""
        paper_id = paper.get("paperId", "")
        title = paper.get("title", "Untitled")
        abstract = paper.get("abstract", "")
        source_paper = source_paper or {}
        source_paper_title = source_paper.get("title", "")

        authors = []
        for author in paper.get("authors", []):
            name = author.get("name", "")
            if name:
                authors.append(name)

        year = paper.get("year", "")
        venue = paper.get("venue", "")
        citation_count = paper.get("citationCount", 0)
        reference_count = paper.get("referenceCount", 0)
        pub_date = paper.get("publicationDate", "")
        fields = paper.get("fieldsOfStudy", [])
        tldr_field = paper.get("tldr")
        if isinstance(tldr_field, dict):
            tldr_text = str(tldr_field.get("text") or "").strip()
        else:
            tldr_text = ""
        open_access = paper.get("openAccessPdf") or {}
        open_access_pdf = str(open_access.get("url") or "").strip() if isinstance(open_access, dict) else ""

        # 构建 URL
        s2_url = f"https://www.semanticscholar.org/paper/{paper_id}"

        # 尝试获取 arXiv ID
        arxiv_id = ""
        external_ids = paper.get("externalIds", {})
        if external_ids:
            arxiv_id = external_ids.get("ArXiv", "")

        arxiv_url = f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else ""

        # 唯一 ID: 优先使用 arXiv ID，否则用 S2 ID
        item_id = arxiv_id if arxiv_id else f"s2_{paper_id}"

        return Item(
            id=item_id,
            raw={
                "title": title,
                "abstract": abstract,
                "tldr": tldr_text,
                "open_access_pdf": open_access_pdf,
                "authors": authors,
                "author_count": len(authors),
                "year": year,
                "venue": venue,
                "published": pub_date,
                "citation_count": citation_count,
                "reference_count": reference_count,
                "fields_of_study": fields,
                "paper_id": paper_id,
                "arxiv_id": arxiv_id,
                "source_paper_title": source_paper_title,  # 被引用的源论文
                "source_paper": source_paper,
                "s2_url": s2_url,
                "arxiv_url": arxiv_url,
                "url": arxiv_url if arxiv_url else s2_url,
                "external_ids": external_ids,
            },
        )

    async def fetch(self, **kwargs) -> list[Item]:
        """Module SDK 兼容的 fetch 方法"""
        if kwargs:
            return await self.fetch_followups(**kwargs)

        config = self._load_config()
        monitors = [monitor for monitor in normalize_followup_monitors(config) if monitor.get("enabled", True)]
        if not monitors:
            return []

        max_results = max(1, int(config.get("max_results", 20) or 20))
        days_back_raw = config.get("days_back")
        days_back = max(1, int(days_back_raw or 365)) if days_back_raw not in (None, "", 0, "0") else None
        sort_by = str(config.get("sort_by", "recency") or "recency").strip()
        if sort_by not in {"recency", "citation_count"}:
            sort_by = "recency"

        existing_ids = self._load_existing_ids()
        merged_items: dict[str, Item] = {}

        for monitor in monitors:
            match_info = {
                "id": monitor["id"],
                "label": monitor["label"],
                "query": monitor["query"],
                "type": "followup",
            }
            items = await self.fetch_followups(
                query=monitor["query"],
                max_results=max_results,
                days_back=days_back,
                existing_ids=existing_ids,
                sort_by=sort_by,
            )

            for item in items:
                existing_item = merged_items.get(item.id)
                if existing_item:
                    matches = existing_item.raw.setdefault("monitor_matches", [])
                    if all(existing_match.get("id") != match_info["id"] for existing_match in matches):
                        matches.append(match_info)
                    continue
                item.raw["monitor_matches"] = [match_info]
                merged_items[item.id] = item

        return list(merged_items.values())

        return await self.fetch_followups(**kwargs)

    PROCESS_CONCURRENCY = 6

    def _assemble_card(
        self,
        item: Item,
        figures: list[dict],
        introduction: str,
        agent_result: dict,
    ) -> Card:
        """Shared card assembly used by both basic (no enrichment) and enriched cards."""
        p = item.raw
        arxiv_id = p.get("arxiv_id", "")
        paper_role = p.get("paper_tracking_role", "followup")
        monitor_matches = p.get("monitor_matches", [])
        monitor_labels = [match.get("label", "") for match in monitor_matches if match.get("label")]
        source_title = p.get("source_paper_title", p.get("title", ""))

        note_name = build_dated_paper_title_for_path(
            p["title"],
            p,
            fallback=item.id,
            max_length=120,
        )
        year = p.get("year", datetime.now().year)
        source_folder = sanitize_paper_title_for_path(
            source_title,
            fallback="Unknown",
            max_length=80,
        )

        metadata = {
            "abo-type": "semantic-scholar-paper",
            "authors": p["authors"],
            "author_count": p.get("author_count", len(p["authors"])),
            "paper_id": p.get("paper_id", ""),
            "arxiv_id": arxiv_id,
            "year": year,
            "venue": p.get("venue", ""),
            "published": p.get("published", ""),
            "citation_count": p.get("citation_count", 0),
            "reference_count": p.get("reference_count", 0),
            "fields_of_study": p.get("fields_of_study", []),
            "source_paper_title": source_title,
            "source_paper": p.get("source_paper", {}),
            "contribution": agent_result.get("contribution", ""),
            "abstract": p.get("abstract", ""),
            "tldr": p.get("tldr", ""),
            "open_access_pdf": p.get("open_access_pdf", ""),
            "introduction": introduction,
            "keywords": agent_result.get("tags", []),
            "s2_url": p.get("s2_url", ""),
            "arxiv_url": p.get("arxiv_url", ""),
            "pdf-url": f"https://arxiv.org/pdf/{arxiv_id}.pdf" if arxiv_id else "",
            "html-url": f"https://arxiv.org/html/{arxiv_id}" if arxiv_id else "",
            "figures": figures,
            "paper_tracking_type": "source" if paper_role == "source" else "followup",
            "paper_tracking_role": paper_role,
            "paper_tracking_label": p["title"] if paper_role == "source" else (monitor_labels[0] if monitor_labels else source_title),
            "paper_tracking_labels": monitor_labels,
            "paper_tracking_matches": monitor_matches,
            "relationship_label": "源论文" if paper_role == "source" else "Follow Up 追踪",
        }

        role_tags = ["source-paper"] if paper_role == "source" else ["follow-up"]
        card_tags = list(dict.fromkeys([
            *agent_result.get("tags", []),
            *role_tags,
            *(p.get("fields_of_study", [])[:1]),
            *monitor_labels[:2],
        ]))
        # Basic-card summary fallback order: agent summary → S2 tldr → abstract truncation.
        summary_fallback = p.get("tldr") or (p.get("abstract", "") or "")[:150]
        return Card(
            id=f"{'source-paper' if paper_role == 'source' else 'followup-monitor'}:{item.id}",
            title=p["title"],
            summary=agent_result.get("summary") or summary_fallback,
            score=min(agent_result.get("score", 5), 10) / 10,
            tags=card_tags,
            source_url=p.get("url", p.get("s2_url", "")),
            obsidian_path=(
                f"Literature/FollowUps/{source_folder}/{note_name}.md"
                if paper_role == "source"
                else f"Literature/FollowUps/{source_folder}/{note_name}/{note_name}.md"
            ),
            metadata=metadata,
        )

    def build_basic_card(self, item: Item) -> Card:
        """Build a card purely from Semantic Scholar metadata, without any slow enrichment.

        没有 figures / introduction / agent_json 结果。前端用此卡片立刻展示初始信息，
        若用户启用了「爬取图片」再用 enrich_item 产生的更新卡片替换。
        """
        return self._assemble_card(item, figures=[], introduction="", agent_result={})

    async def enrich_item(
        self,
        item: Item,
        prefs: dict,
        arxiv_api,
        semaphore,
        ai_scoring_enabled: bool,
        *,
        fetch_figures: bool = True,
    ) -> Card:
        """Enrich a basic card with intro / agent analysis (always) and figures (optional).

        S2 API 不提供 introduction，只有 abstract 和 tldr，所以 intro 仍要走 arXiv。
        fetch_figures=False 时只跳过图片，intro 和 agent 仍然并发跑。
        """
        import asyncio

        async with semaphore:
            p = item.raw
            arxiv_id = p.get("arxiv_id", "")
            paper_role = p.get("paper_tracking_role", "followup")
            source_title = p.get("source_paper_title", p.get("title", ""))

            async def _safe_fetch_figures() -> list[dict]:
                if not arxiv_id or not fetch_figures:
                    return []
                try:
                    return await asyncio.wait_for(arxiv_api.fetch_figures(arxiv_id), timeout=15)
                except asyncio.TimeoutError:
                    print(f"[s2] arXiv figure fetch timeout for {arxiv_id}")
                except Exception as e:
                    print(f"[s2] arXiv figure fetch error for {arxiv_id}: {e}")
                return []

            async def _safe_fetch_introduction() -> str:
                if not arxiv_id:
                    return ""
                try:
                    return await asyncio.wait_for(arxiv_api.fetch_introduction(arxiv_id), timeout=20)
                except asyncio.TimeoutError:
                    print(f"[s2] arXiv introduction fetch timeout for {arxiv_id}")
                except Exception as e:
                    print(f"[s2] arXiv introduction fetch error for {arxiv_id}: {e}")
                return ""

            async def _safe_agent_json() -> dict:
                if not ai_scoring_enabled:
                    return {}
                fields_str = ", ".join(p.get("fields_of_study", [])[:3])
                citation_info = f"被引用 {p['citation_count']} 次" if p.get("citation_count") else ""
                abstract_snippet = p["abstract"][:800] if p.get("abstract") else "No abstract available"
                if paper_role == "source":
                    prompt = (
                        f'分析以下源论文，返回 JSON（不要有其他文字）：\n'
                        f'{{"score":<1-10整数>,"summary":"<50字以内中文摘要>",'
                        f'"tags":["<tag1>","<tag2>","<tag3>"],"contribution":"<一句话核心创新>"}}\n\n'
                        f"标题：{p['title']}\n"
                        f"领域：{fields_str}\n"
                        f"{citation_info}\n"
                        f"摘要：{abstract_snippet}"
                    )
                else:
                    prompt = (
                        f'分析以下后续研究论文（引用了 "{source_title}"），返回 JSON（不要有其他文字）：\n'
                        f'{{"score":<1-10整数>,"summary":"<50字以内中文摘要>",'
                        f'"tags":["<tag1>","<tag2>","<tag3>"],"contribution":"<一句话核心创新>"}}\n\n'
                        f"标题：{p['title']}\n"
                        f"领域：{fields_str}\n"
                        f"{citation_info}\n"
                        f"摘要：{abstract_snippet}"
                    )
                try:
                    return await asyncio.wait_for(agent_json(prompt, prefs=prefs), timeout=30)
                except asyncio.TimeoutError:
                    print(f"[s2] Agent timeout for {item.id}, using fallback")
                except Exception as e:
                    print(f"[s2] Agent error for {item.id}: {e}")
                return {}

            figures, introduction, agent_result = await asyncio.gather(
                _safe_fetch_figures(),
                _safe_fetch_introduction(),
                _safe_agent_json(),
            )
            return self._assemble_card(item, figures, introduction, agent_result)

    async def process(self, items: list[Item], prefs: dict) -> list[Card]:
        """Process papers into Cards with agent analysis (full enrichment).

        Backward compatible 入口：对每个 item 跑完整 enrichment（figures + intro + agent_json），
        通过 Semaphore(PROCESS_CONCURRENCY) 控制并发。/crawl 路由内部使用 build_basic_card +
        enrich_item 实现两阶段渲染。
        """
        import asyncio
        from abo.tools.arxiv_api import ArxivAPITool

        if not items:
            return []

        arxiv_api = ArxivAPITool()
        ai_scoring_enabled = is_paper_ai_scoring_enabled()
        semaphore = asyncio.Semaphore(self.PROCESS_CONCURRENCY)

        results = await asyncio.gather(
            *[
                self.enrich_item(item, prefs, arxiv_api, semaphore, ai_scoring_enabled)
                for item in items
            ],
            return_exceptions=True,
        )

        cards: list[Card] = []
        for item, outcome in zip(items, results):
            if isinstance(outcome, Exception):
                print(f"[s2] process item failed for {item.id}: {outcome}")
                continue
            cards.append(outcome)
        return cards


# 导出供前端使用
def get_default_queries() -> list[dict]:
    """获取默认的 follow-up 查询列表"""
    return [
        {"name": "VGGT", "query": "VGGT", "description": "Visual Geometry Grounded Transformer 后续研究"},
        {"name": "SAM", "query": "Segment Anything", "description": "Segment Anything Model 后续研究"},
        {"name": "GPT-4", "query": "GPT-4", "description": "GPT-4 相关后续研究"},
    ]
