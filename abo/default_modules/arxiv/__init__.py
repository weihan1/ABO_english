import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Any, Literal

import httpx

from abo.config import is_paper_ai_scoring_enabled
from abo.paper_paths import build_arxiv_grouped_relative_dir, sanitize_paper_title_for_path
from abo.sdk import Module, Item, Card, agent_json
from abo.default_modules.arxiv.category import get_category_name, ALL_SUBCATEGORIES
from abo.store.papers import PaperStore
from abo.tools.arxiv_api import ArxivAPITool, arxiv_api_search, build_structured_digest_markdown


def _dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(text)
    return deduped


def _derive_year(year_value: Any, published: str) -> int | None:
    try:
        if year_value not in (None, ""):
            return int(year_value)
    except (TypeError, ValueError):
        pass

    published_text = str(published or "").strip()
    if len(published_text) >= 4:
        try:
            return int(published_text[:4])
        except ValueError:
            return None
    return None


class ArxivTracker(Module):
    id       = "arxiv-tracker"
    name     = "arXiv 论文追踪"
    schedule = "0 9 * * *"
    icon     = "book-open"
    output   = ["obsidian", "ui"]

    _NS = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}

    # Rate limiting: track last request time
    _last_request_time = 0

    def _load_config(self) -> dict:
        from abo.paper_tracking import load_module_preferences

        return load_module_preferences(self.id)

    def _load_existing_ids(self) -> set[str]:
        return PaperStore().existing_identifiers(saved_only=True)

    async def _rate_limited_request(self, client: httpx.AsyncClient, url: str, timeout: int = 60) -> httpx.Response:
        """Make a rate-limited request to arXiv."""
        import time
        import asyncio

        # Slow mode: 12 seconds between requests to avoid arXiv rate limiting
        min_interval = 12.0
        elapsed = time.time() - ArxivTracker._last_request_time
        if elapsed < min_interval:
            await asyncio.sleep(min_interval - elapsed)

        resp = await client.get(url, headers={"User-Agent": "ABO-arXiv-Tracker/1.0"}, timeout=timeout)
        ArxivTracker._last_request_time = time.time()
        return resp

    async def fetch_by_category(
        self,
        categories: list[str] = None,
        keywords: list[str] = None,
        max_results: int = 100,
        days_back: int = 60,
        sort_by: Literal["submittedDate", "lastUpdatedDate", "relevance"] = "submittedDate",
        sort_order: Literal["descending", "ascending"] = "descending",
        existing_ids: set[str] = None,
        mode: Literal["AND", "OR"] = "OR",
    ) -> list[Item]:
        """
        按子领域和/或关键词获取 arXiv 论文

        Args:
            categories: 子领域代码列表，如 ["cs.CV", "cs.LG"]
            keywords: 关键词列表
            max_results: 最大结果数
            days_back: 只获取最近 N 天的论文
            sort_by: 排序方式 - submittedDate(提交日期), lastUpdatedDate(最后更新), relevance(相关性)
            sort_order: 排序顺序
            existing_ids: 已存在的论文 ID 集合（用于去重）
            mode: 关键词匹配模式 - "AND"(所有关键词都必须在标题或摘要中), "OR"(任一关键词匹配), "AND_OR"(AND组之间用OR连接)
        """
        import asyncio
        import urllib.parse

        # 构建查询
        query_parts = []

        # 添加分类过滤
        if categories:
            cat_query = "+OR+".join(f"cat:{cat}" for cat in categories)
            query_parts.append(f"({cat_query})")

        # 添加关键词过滤 - 同时搜索标题和摘要
        if keywords:
            if mode == "AND":
                # AND 模式: 所有关键词都必须在标题或摘要中
                # 每个关键词搜索标题+摘要，关键词之间用 AND 连接
                kw_parts = []
                for kw in keywords:
                    # 搜索标题或摘要中的关键词
                    kw_escaped = urllib.parse.quote(kw)
                    kw_parts.append(f"(ti:{kw_escaped}+OR+abs:{kw_escaped})")
                kw_query = "+AND+".join(kw_parts)
                query_parts.append(f"({kw_query})")
            elif mode == "AND_OR":
                # AND-OR 组合模式: 多个AND组，组之间用OR连接
                # 格式: "vision,language | robot,manipulation" 表示 (vision AND language) OR (robot AND manipulation)
                # 先按 | 分割成不同的AND组
                keyword_str = keywords[0] if len(keywords) == 1 else " ".join(keywords)
                and_groups = [g.strip() for g in keyword_str.split("|") if g.strip()]

                or_parts = []
                for group in and_groups:
                    # 每组内按逗号或空格分割成多个关键词（AND关系）
                    group_keywords = [k.strip() for k in group.replace(",", " ").split() if k.strip()]
                    if group_keywords:
                        kw_parts = []
                        for kw in group_keywords:
                            kw_escaped = urllib.parse.quote(kw)
                            kw_parts.append(f"(ti:{kw_escaped}+OR+abs:{kw_escaped})")
                        group_query = "+AND+".join(kw_parts)
                        or_parts.append(f"({group_query})")

                if or_parts:
                    kw_query = "+OR+".join(or_parts)
                    query_parts.append(f"({kw_query})")
            else:
                # OR 模式: 任一关键词匹配 (默认)
                kw_query = "+OR+".join(f"all:{urllib.parse.quote(kw)}" for kw in keywords)
                query_parts.append(f"({kw_query})")

        # 组合查询
        if len(query_parts) > 1:
            query = "+AND+".join(query_parts)
        elif query_parts:
            query = query_parts[0]
        else:
            query = "cat:cs.*"  # 默认查询计算机科学

        url = (
            f"https://export.arxiv.org/api/query"
            f"?search_query={query}"
            f"&max_results={max_results}"
            f"&sortBy={sort_by}"
            f"&sortOrder={sort_order}"
        )

        print(f"[arxiv] Fetching: {url[:150]}...")

        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                    resp = await self._rate_limited_request(client, url)

                if resp.status_code in (429, 503):
                    wait_time = 5 * (2 ** attempt)
                    print(f"[arxiv] Rate limited (HTTP {resp.status_code}), waiting {wait_time}s...")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(wait_time)
                        continue
                    raise Exception(f"arXiv API 暂时不可用 (HTTP {resp.status_code})")

                if resp.status_code != 200:
                    error_text = resp.text[:500]
                    # Check for rate limiting even on 500 errors
                    if "rate exceeded" in error_text.lower():
                        raise Exception(f"arXiv API rate exceeded. Please wait 2-3 minutes before retrying.")
                    raise Exception(f"arXiv API returned {resp.status_code}: {error_text}")

                break
            except (httpx.ReadTimeout, httpx.ConnectTimeout) as e:
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise Exception(f"arXiv API timeout after {max_retries} retries")

        # 解析 XML
        root = ET.fromstring(resp.text)
        items = []
        cutoff = datetime.utcnow() - timedelta(days=days_back)
        existing_ids = existing_ids or set()

        for entry in root.findall("a:entry", self._NS):
            try:
                item = self._parse_entry(entry)
                if not item:
                    continue

                # 去重
                if item.id in existing_ids:
                    continue

                # 时间过滤
                published_str = item.raw.get("published", "")
                if not published_str:
                    continue
                try:
                    published = datetime.fromisoformat(published_str.replace("Z", "+00:00")).replace(tzinfo=None)
                    if published < cutoff:
                        continue
                except ValueError:
                    # 如果日期解析失败，仍然包含该论文
                    pass

                items.append(item)

                if len(items) >= max_results:
                    break
            except Exception as e:
                print(f"[arxiv] Error parsing entry: {e}")
                continue

        print(f"[arxiv] Fetched {len(items)} papers from {len(root.findall('a:entry', self._NS))} total entries")
        return items

    def _parse_entry(self, entry: ET.Element) -> Item | None:
        """解析单个 arXiv entry，获取完整信息"""
        # arXiv ID
        raw_id_elem = entry.find("a:id", self._NS)
        if raw_id_elem is None or not raw_id_elem.text:
            return None

        raw_id = raw_id_elem.text.strip()
        arxiv_id = raw_id.split("/abs/")[-1]

        # 标题
        title_elem = entry.find("a:title", self._NS)
        title = title_elem.text.strip().replace("\n", " ") if title_elem is not None and title_elem.text else "Untitled"

        # 摘要
        summary_elem = entry.find("a:summary", self._NS)
        abstract = summary_elem.text.strip() if summary_elem is not None and summary_elem.text else ""

        # 作者列表
        authors = []
        for author in entry.findall("a:author", self._NS):
            name_elem = author.find("a:name", self._NS)
            if name_elem is not None and name_elem.text:
                authors.append(name_elem.text)

        # 发布时间 (Submitted)
        published_elem = entry.find("a:published", self._NS)
        published = published_elem.text.strip() if published_elem is not None and published_elem.text else ""

        # 更新时间 (Last Updated)
        updated_elem = entry.find("a:updated", self._NS)
        updated = updated_elem.text.strip() if updated_elem is not None and updated_elem.text else published

        # 分类信息
        primary_category_elem = entry.find("arxiv:primary_category", self._NS)
        primary_category = primary_category_elem.get("term", "") if primary_category_elem is not None else ""

        categories = []
        for cat in entry.findall("a:category", self._NS):
            term = cat.get("term", "")
            if term:
                categories.append(term)

        # Comments (包含页数、会议等信息)
        comment_elem = entry.find("arxiv:comment", self._NS)
        comments = comment_elem.text.strip() if comment_elem is not None and comment_elem.text else ""

        # Journal reference
        journal_elem = entry.find("arxiv:journal_ref", self._NS)
        journal_ref = journal_elem.text.strip() if journal_elem is not None and journal_elem.text else ""

        # DOI
        doi_elem = entry.find("arxiv:doi", self._NS)
        doi = doi_elem.text.strip() if doi_elem is not None and doi_elem.text else ""

        # Links
        links = {
            "abs": f"https://arxiv.org/abs/{arxiv_id}",
            "pdf": f"https://arxiv.org/pdf/{arxiv_id}.pdf",
            "html": f"https://arxiv.org/html/{arxiv_id}",
        }

        return Item(
            id=arxiv_id,
            raw={
                "title": title,
                "abstract": abstract,
                "authors": authors,
                "author_count": len(authors),
                "published": published,
                "updated": updated,
                "primary_category": primary_category,
                "primary_category_name": get_category_name(primary_category),
                "categories": categories,
                "all_categories": [get_category_name(c) for c in categories],
                "comments": comments,
                "journal_ref": journal_ref,
                "doi": doi,
                "links": links,
                "url": links["abs"],
                "pdf_url": links["pdf"],
                "html_url": links["html"],
            },
        )

    async def fetch_figures(self, arxiv_id: str) -> list[dict]:
        """Fetch figures from arXiv HTML version."""
        tool = ArxivAPITool()
        return await tool.fetch_figures(arxiv_id)

    async def fetch(self, **kwargs) -> list[Item]:
        """Module SDK 兼容的 fetch 方法"""
        # 支持旧的调用方式
        if "custom_keywords" in kwargs:
            return await self.fetch_by_category(
                keywords=kwargs.get("custom_keywords"),
                max_results=kwargs.get("max_results", 20),
                days_back=60,
                existing_ids=kwargs.get("existing_ids"),
                mode=kwargs.get("mode", "OR"),
            )

        if kwargs:
            return await self.fetch_by_category(**kwargs)

        from abo.paper_tracking import (
            expand_arxiv_categories,
            normalize_keyword_monitors,
            split_keyword_groups,
        )

        config = self._load_config()
        monitors = [monitor for monitor in normalize_keyword_monitors(config) if monitor.get("enabled", True)]
        if not monitors:
            return []

        max_results = max(1, int(config.get("max_results", 20) or 20))
        days_back = max(1, int(config.get("days_back", 30) or 30))
        existing_ids = self._load_existing_ids()
        merged_items: dict[str, Item] = {}

        for monitor in monitors:
            monitor_categories = monitor.get("categories") or config.get("default_categories") or ["cs.*"]
            expanded_categories = expand_arxiv_categories(monitor_categories)
            mode, groups = split_keyword_groups(monitor.get("query", ""))
            if not groups:
                continue

            papers: list[dict] = []
            api_matched_count = 0
            skipped_existing_count = 0
            skipped_duplicate_count = 0
            if mode == "AND_OR":
                seen_monitor_ids: set[str] = set()
                for group in groups:
                    group_papers = await arxiv_api_search(
                        keywords=group,
                        categories=expanded_categories or None,
                        mode="AND",
                        max_results=max_results,
                        days_back=days_back,
                        sort_by="submittedDate",
                    )
                    api_matched_count += len(group_papers)
                    for paper in group_papers:
                        paper_id = str(paper.get("id", "")).strip()
                        if not paper_id:
                            continue
                        if paper_id in seen_monitor_ids:
                            skipped_duplicate_count += 1
                            continue
                        if paper_id in existing_ids:
                            skipped_existing_count += 1
                            continue
                        seen_monitor_ids.add(paper_id)
                        papers.append(paper)
            else:
                api_papers = await arxiv_api_search(
                    keywords=groups[0],
                    categories=expanded_categories or None,
                    mode="AND",
                    max_results=max_results,
                    days_back=days_back,
                    sort_by="submittedDate",
                )
                api_matched_count += len(api_papers)
                for paper in api_papers:
                    paper_id = str(paper.get("id", "")).strip()
                    if not paper_id:
                        continue
                    if paper_id in existing_ids:
                        skipped_existing_count += 1
                        continue
                    papers.append(paper)

            print(
                f"[arxiv] Monitor '{monitor['label']}' selected {len(papers)} papers "
                f"(days_back={days_back}, api_matched={api_matched_count}, "
                f"skipped_existing={skipped_existing_count}, skipped_duplicate={skipped_duplicate_count})"
            )

            match_info = {
                "id": monitor["id"],
                "label": monitor["label"],
                "query": monitor["query"],
                "categories": expanded_categories or [],
                "type": "keyword",
            }

            for paper in papers:
                item = self._paper_from_api_result(paper)
                if not item:
                    continue
                existing_item = merged_items.get(item.id)
                if existing_item:
                    matches = existing_item.raw.setdefault("monitor_matches", [])
                    if all(existing_match.get("id") != match_info["id"] for existing_match in matches):
                        matches.append(match_info)
                    continue
                item.raw["monitor_matches"] = [match_info]
                merged_items[item.id] = item

        return list(merged_items.values())

        # 新的按分类调用
        return await self.fetch_by_category(**kwargs)

    def _paper_from_api_result(self, paper: dict) -> Item | None:
        arxiv_id = str(paper.get("id", "")).strip()
        if not arxiv_id:
            return None

        categories = paper.get("categories") or []
        primary_category = paper.get("primary_category") or (categories[0] if categories else "")
        published = paper.get("published")
        updated = paper.get("updated") or published

        return Item(
            id=arxiv_id,
            raw={
                "title": paper.get("title", "Untitled"),
                "abstract": paper.get("summary", ""),
                "authors": paper.get("authors", []),
                "author_count": len(paper.get("authors", [])),
                "published": published.isoformat() if hasattr(published, "isoformat") else (published or ""),
                "updated": updated.isoformat() if hasattr(updated, "isoformat") else (updated or ""),
                "primary_category": primary_category,
                "primary_category_name": get_category_name(primary_category),
                "categories": categories,
                "all_categories": [get_category_name(c) for c in categories],
                "comments": paper.get("comment") or "",
                "journal_ref": paper.get("journal_ref") or "",
                "doi": paper.get("doi") or "",
                "url": paper.get("arxiv_url") or f"https://arxiv.org/abs/{arxiv_id}",
                "pdf_url": paper.get("pdf_url") or f"https://arxiv.org/pdf/{arxiv_id}.pdf",
                "html_url": f"https://arxiv.org/html/{arxiv_id}",
            },
        )

    def item_from_api_result(self, paper: dict) -> Item | None:
        return self._paper_from_api_result(paper)

    async def build_tracking_payload(
        self,
        item: Item,
        prefs: dict,
        *,
        arxiv_api: ArxivAPITool | None = None,
        ai_scoring_enabled: bool | None = None,
    ) -> dict[str, Any]:
        import asyncio

        p = item.raw
        arxiv_api = arxiv_api or ArxivAPITool()
        ai_scoring_enabled = is_paper_ai_scoring_enabled() if ai_scoring_enabled is None else ai_scoring_enabled

        monitor_matches_raw = p.get("monitor_matches", [])
        monitor_matches = monitor_matches_raw if isinstance(monitor_matches_raw, list) else []
        monitor_labels = _dedupe_strings(
            [
                str(match.get("label", "")).strip()
                for match in monitor_matches
                if isinstance(match, dict) and str(match.get("label", "")).strip()
            ]
        )

        explicit_tracking_labels_raw = p.get("paper_tracking_labels", [])
        explicit_tracking_labels = (
            [
                str(label).strip()
                for label in explicit_tracking_labels_raw
                if str(label or "").strip()
            ]
            if isinstance(explicit_tracking_labels_raw, list)
            else []
        )
        explicit_tracking_label = str(
            p.get("paper_tracking_label")
            or p.get("search_label")
            or "",
        ).strip()
        tracking_labels = _dedupe_strings([
            *explicit_tracking_labels,
            *monitor_labels,
            explicit_tracking_label,
        ])
        tracking_label = explicit_tracking_label or (tracking_labels[0] if tracking_labels else "")

        tracking_type = str(p.get("paper_tracking_type") or "keyword").strip() or "keyword"
        tracking_role = str(p.get("paper_tracking_role") or tracking_type).strip() or tracking_type
        relationship = str(p.get("relationship") or "keyword").strip() or "keyword"
        relationship_label = str(p.get("relationship_label") or "关键词追踪").strip() or "关键词追踪"

        figures_raw = p.get("figures", [])
        figures = figures_raw if isinstance(figures_raw, list) else []
        local_figures_raw = p.get("local_figures", [])
        local_figures = local_figures_raw if isinstance(local_figures_raw, list) else []
        introduction = str(p.get("introduction") or "").strip()

        if not figures:
            try:
                figures = await asyncio.wait_for(arxiv_api.fetch_figures(item.id), timeout=15)
            except asyncio.TimeoutError:
                print(f"[arxiv] Figure fetch timeout for {item.id}")
            except Exception as e:
                print(f"[arxiv] Figure fetch error for {item.id}: {e}")

        if not introduction:
            try:
                introduction = await asyncio.wait_for(
                    arxiv_api.fetch_introduction(item.id),
                    timeout=20,
                )
            except asyncio.TimeoutError:
                print(f"[arxiv] Introduction fetch timeout for {item.id}")
            except Exception as e:
                print(f"[arxiv] Introduction fetch error for {item.id}: {e}")

        result = {}
        if ai_scoring_enabled:
            categories_str = ", ".join(p.get("all_categories", [])[:3])
            comments_info = f"\nComments: {p['comments']}" if p.get("comments") else ""

            prompt = (
                f'分析以下 arXiv 论文，返回 JSON（不要有其他文字）：\n'
                f'{{"score":<1-10整数>,"summary":"<50字以内中文摘要>",'
                f'"tags":["<tag1>","<tag2>","<tag3>"],"contribution":"<一句话核心创新>"}}\n\n'
                f"标题：{p['title']}\n"
                f"分类：{categories_str}{comments_info}\n"
                f"摘要：{p['abstract'][:800]}"
            )

            try:
                result = await asyncio.wait_for(agent_json(prompt, prefs=prefs), timeout=30)
            except asyncio.TimeoutError:
                print(f"[arxiv] Agent timeout for {item.id}, using fallback")
            except Exception as e:
                print(f"[arxiv] Agent error for {item.id}: {e}")

        primary_cat = p.get("primary_category", "unknown")
        note_name = sanitize_paper_title_for_path(
            p["title"],
            fallback=item.id,
            max_length=120,
        )
        year = _derive_year(p.get("year"), p.get("published", ""))
        venue = str(p.get("venue") or p.get("journal_ref") or "").strip()
        abstract = str(p.get("abstract") or "").strip()
        formatted_digest = build_structured_digest_markdown(abstract, introduction)
        source_url = p.get("url", "")

        obsidian_dir = build_arxiv_grouped_relative_dir(
            {
                "id": item.id,
                "title": p["title"],
                "published": p.get("published", ""),
                "year": year,
                "metadata": {
                    "paper_tracking_label": tracking_label,
                    "paper_tracking_labels": tracking_labels,
                    "primary_category": primary_cat,
                    "published": p.get("published", ""),
                    "year": year,
                },
            },
            root_folder="Literature/arXiv",
            paper_fallback=item.id,
        )

        metadata = {
            "abo-type": "arxiv-paper",
            "authors": p.get("authors", []),
            "author_count": p.get("author_count", len(p.get("authors", []))),
            "paper_id": "",
            "arxiv_id": item.id,
            "arxiv-id": item.id,
            "year": year,
            "venue": venue,
            "published": p.get("published", ""),
            "updated": p.get("updated", ""),
            "citation_count": 0,
            "reference_count": 0,
            "fields_of_study": [],
            "source_paper_title": str(p.get("source_paper_title") or "").strip(),
            "source_paper": p.get("source_paper", {}) or {},
            "contribution": result.get("contribution", ""),
            "abstract": abstract,
            "introduction": introduction,
            "formatted-digest": formatted_digest,
            "keywords": result.get("tags", []),
            "s2_url": "",
            "arxiv_url": source_url,
            "pdf-url": p.get("pdf_url", ""),
            "html-url": p.get("html_url", ""),
            "figures": figures,
            "local_figures": local_figures,
            "paper_tracking_type": tracking_type,
            "paper_tracking_role": tracking_role,
            "paper_tracking_label": tracking_label,
            "paper_tracking_labels": tracking_labels,
            "paper_tracking_matches": monitor_matches,
            "relationship": relationship,
            "relationship_label": relationship_label,
            "saved_to_literature": bool(p.get("saved_to_literature") or p.get("literature_path")),
            "literature_path": str(p.get("literature_path") or "").strip(),
            "primary_category": primary_cat,
            "primary_category_name": p.get("primary_category_name", ""),
            "categories": p.get("categories", []),
            "all_categories": p.get("all_categories", []),
            "comments": p.get("comments", ""),
            "journal_ref": p.get("journal_ref", ""),
            "doi": p.get("doi", ""),
        }

        tags = _dedupe_strings([
            *result.get("tags", []),
            primary_cat,
            *tracking_labels[:2],
        ])

        return {
            "title": p["title"],
            "summary": result.get("summary", abstract[:150]),
            "score": min(result.get("score", 5), 10) / 10,
            "tags": tags,
            "source_url": source_url,
            "obsidian_path": str(obsidian_dir / f"{note_name}.md"),
            "metadata": metadata,
        }

    async def process(self, items: list[Item], prefs: dict) -> list[Card]:
        """Process papers into Cards with agent analysis"""
        cards = []
        arxiv_api = ArxivAPITool()
        ai_scoring_enabled = is_paper_ai_scoring_enabled()

        for item in items:
            payload = await self.build_tracking_payload(
                item,
                prefs,
                arxiv_api=arxiv_api,
                ai_scoring_enabled=ai_scoring_enabled,
            )
            cards.append(Card(
                id=f"arxiv-monitor:{item.id}",
                title=payload["title"],
                summary=payload["summary"],
                score=payload["score"],
                tags=payload["tags"],
                source_url=payload["source_url"],
                obsidian_path=payload["obsidian_path"],
                module_id=self.id,
                metadata=payload["metadata"],
            ))

        return cards


# 导出分类信息供前端使用
def get_available_categories() -> list[dict]:
    """获取所有可用的分类列表"""
    return [
        {"code": code, "name": name, "main": code.split(".")[0]}
        for code, name in ALL_SUBCATEGORIES.items()
    ]
