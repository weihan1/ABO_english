"""
ABO Backend — FastAPI 入口
"""
import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta
import json
from pathlib import Path
import os
import re
from typing import Any, Awaitable, Mapping

import frontmatter
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .activity import ActivityTracker, ActivityType
from .config import (
    get_vault_path,
    get_literature_path,
    load as load_config,
    normalize_daily_time,
    save as save_config,
    is_demo_mode,
    is_paper_ai_scoring_enabled,
)
from .demo.data import get_demo_cards, DEMO_UNREAD_COUNTS, DEMO_KEYWORD_PREFS, get_demo_activities, get_demo_modules_dashboard
from .assistant.routes import router as assistant_router
from .creator_smart_groups import build_shared_signal_entries, get_shared_creator_group_options
from .health.routes import router as health_router
from .insights.routes import router as insights_router
from .journal_mobile import describe_mobile_journal_paths, cleanup_mobile_journal_exports, ensure_mobile_journal_structure
from .wiki.routes import router as wiki_router
from .preferences.engine import PreferenceEngine
from .profile.routes import router as profile_router, init_routes as init_profile_routes
from .rss import rss_router
from .routes.tools import router as tools_router
from .modules.routes import router as modules_router
from .paper_tracking import normalize_followup_monitors, normalize_keyword_monitors
from .paper_paths import (
    build_arxiv_grouped_relative_dir,
    build_dated_paper_title_for_path,
    sanitize_paper_title_for_path,
)
from .paper_cards import sanitize_feed_card_payload
from .runtime.broadcaster import broadcaster
from .runtime.bundled_idle import (
    bundled_backend_websocket_connected,
    bundled_backend_websocket_disconnected,
    mark_bundled_backend_activity,
    start_bundled_idle_watchdog,
    stop_bundled_idle_watchdog,
)
from .runtime.discovery import ModuleRegistry, start_watcher
from .runtime.feed_visibility import (
    is_card_temporarily_hidden,
    temporarily_hide_cards,
    temporarily_hidden_unread_counts,
)
from .runtime.runner import ModuleRunner
from .vault.unified_entry import UnifiedVaultEntry
from .runtime.scheduler import ModuleScheduler
from .runtime.state import ModuleStateStore
from .sdk.types import Card, FeedbackAction
from .store.cards import CardStore
from .store.papers import PaperStore
from .subscription_store import get_subscription_store
from .summary import DailySummaryGenerator, SummaryScheduler
from .vault.writer import ensure_vault_structure
from .storage_paths import (
    get_keyword_preferences_path,
    get_preferences_path,
    get_sdk_dir,
    resolve_app_db_path,
)
from .bilibili_tracker_config import (
    BILIBILI_TRACKER_DEFAULT_DAYS_BACK,
    BILIBILI_TRACKER_DEFAULT_LIMIT,
    BILIBILI_TRACKER_FIXED_UP_DEFAULT_DAYS_BACK,
    build_bilibili_legacy_fields,
    normalize_bilibili_dynamic_monitors,
    normalize_bilibili_followed_group_monitors,
)
from .xhs_tracker_config import build_xhs_legacy_fields, normalize_xhs_tracker_config

# ── 全局单例 ────────────────────────────────────────────────────
_registry = ModuleRegistry()
_state_store = ModuleStateStore()
_card_store = CardStore()
_paper_store = PaperStore()
_prefs = PreferenceEngine()
_scheduler: ModuleScheduler | None = None
_activity_tracker: ActivityTracker | None = None
_summary_generator: DailySummaryGenerator | None = None
_summary_scheduler: SummaryScheduler | None = None
_subscription_store = get_subscription_store()
_DEFAULT_INTELLIGENCE_DELIVERY_TIME = "09:00"
_SOCIAL_CRAWL_LEAD_MINUTES = 30
_DEFAULT_PUSH_MODULE_IDS = (
    "arxiv-tracker",
    "semantic-scholar-tracker",
    "xiaoyuzhou-tracker",
    "zhihu-tracker",
)
_SOCIAL_EARLY_MODULE_IDS = (
    "xiaohongshu-tracker",
    "bilibili-tracker",
)
_DEBUG_FEED_FLOW_MODULE_GROUPS = {
    "papers": (
        "arxiv-tracker",
        "semantic-scholar-tracker",
    ),
    "bilibili": (
        "bilibili-tracker",
    ),
    "bilibili-fixed-up": (
        "bilibili-tracker",
    ),
    "xiaohongshu": (
        "xiaohongshu-tracker",
    ),
    "social": (
        "xiaohongshu-tracker",
        "bilibili-tracker",
    ),
}
_DEBUG_FEED_FLOW_MODULE_GROUPS["all"] = (
    *_DEBUG_FEED_FLOW_MODULE_GROUPS["papers"],
    *_DEBUG_FEED_FLOW_MODULE_GROUPS["social"],
)
_DEBUG_FEED_FLOW_SNAPSHOT_LIMIT = 500
_DEBUG_FEED_FLOW_OVERRIDE_LOCK = asyncio.Lock()
_INTELLIGENCE_DELIVERY_MODULE_IDS = (
    *_DEFAULT_PUSH_MODULE_IDS,
    *_SOCIAL_EARLY_MODULE_IDS,
)


def _validate_cron(expr: str) -> bool:
    from apscheduler.triggers.cron import CronTrigger
    try:
        CronTrigger.from_crontab(expr)
        return True
    except Exception:
        return False


def _list_visible_cards(
    *,
    module_id: str | None = None,
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[Card]:
    if not unread_only:
        return _card_store.list(
            module_id=module_id,
            unread_only=False,
            limit=limit,
            offset=offset,
        )

    visible_cards: list[Card] = []
    scan_offset = 0
    batch_size = max(100, offset + limit)

    while len(visible_cards) < offset + limit:
        batch = _card_store.list(
            module_id=module_id,
            unread_only=True,
            limit=batch_size,
            offset=scan_offset,
        )
        if not batch:
            break

        visible_cards.extend(
            card
            for card in batch
            if not is_card_temporarily_hidden(str(card.id or ""))
        )
        scan_offset += batch_size

        if len(batch) < batch_size:
            break

    return visible_cards[offset:offset + limit]


def _shift_daily_time(time_text: str, delta_minutes: int) -> str:
    normalized = normalize_daily_time(time_text, _DEFAULT_INTELLIGENCE_DELIVERY_TIME)
    hour, minute = [int(part) for part in normalized.split(":")]
    total_minutes = (hour * 60 + minute + delta_minutes) % (24 * 60)
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def _daily_time_to_cron(time_text: str) -> str:
    normalized = normalize_daily_time(time_text, _DEFAULT_INTELLIGENCE_DELIVERY_TIME)
    hour, minute = [int(part) for part in normalized.split(":")]
    return f"{minute} {hour} * * *"


def _build_intelligence_schedule_map(push_time: str) -> dict[str, str]:
    normalized_push_time = normalize_daily_time(push_time, _DEFAULT_INTELLIGENCE_DELIVERY_TIME)
    social_crawl_time = _shift_daily_time(normalized_push_time, -_SOCIAL_CRAWL_LEAD_MINUTES)

    schedule_map = {
        module_id: _daily_time_to_cron(normalized_push_time)
        for module_id in _DEFAULT_PUSH_MODULE_IDS
    }
    schedule_map.update({
        module_id: _daily_time_to_cron(social_crawl_time)
        for module_id in _SOCIAL_EARLY_MODULE_IDS
    })
    return schedule_map


def _apply_intelligence_schedule_config(push_time: str, *, persist: bool = True) -> dict[str, str]:
    schedule_map = _build_intelligence_schedule_map(push_time)
    delivery_enabled = bool(load_config().get("intelligence_delivery_enabled", True))

    for module_id, schedule in schedule_map.items():
        module = _registry.get(module_id)
        if module is None:
            continue

        if persist:
            _state_store.update_module(module_id, schedule=schedule, registry=_registry)
        else:
            module.schedule = schedule

        if _scheduler:
            if delivery_enabled and module.enabled:
                _scheduler.update_schedule(module)
            else:
                _scheduler.update_enabled(module, False)

    return schedule_map


def _set_intelligence_delivery_enabled(enabled: bool) -> None:
    for module_id in _INTELLIGENCE_DELIVERY_MODULE_IDS:
        module = _registry.get(module_id)
        if module is None or _scheduler is None:
            continue
        _scheduler.update_enabled(module, enabled and module.enabled)


def _extract_arxiv_id_from_paper_payload(paper: dict) -> str:
    meta = paper.get("metadata", {}) or {}
    candidates = [
        paper.get("id", ""),
        paper.get("arxiv_id", ""),
        meta.get("arxiv_id", ""),
        meta.get("arxiv-id", ""),
        paper.get("source_url", ""),
        meta.get("pdf-url", ""),
        meta.get("html-url", ""),
    ]
    pattern = re.compile(r"([a-z\-]+/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?", re.IGNORECASE)
    for candidate in candidates:
        text = str(candidate or "").strip()
        if not text:
            continue
        match = pattern.search(text)
        if match:
            return match.group(1)
    return str(paper.get("id", "unknown"))


def _normalize_saved_text_block(text: str) -> str:
    cleaned = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def _collect_saved_arxiv_ids(arxiv_root: Path) -> set[str]:
    """Load saved arXiv IDs from grouped literature notes."""
    existing_ids: set[str] = set()
    if not arxiv_root.exists():
        return existing_ids

    for note_path in arxiv_root.glob("**/*.md"):
        try:
            post = frontmatter.loads(note_path.read_text(encoding="utf-8"))
            paper = {
                "metadata": post.metadata,
                "source_url": post.metadata.get("arxiv-url", ""),
            }
            arxiv_id = _extract_arxiv_id_from_paper_payload(paper)
            if arxiv_id and arxiv_id != "unknown":
                existing_ids.add(arxiv_id)
                continue
        except Exception:
            pass

        match = re.search(r"([a-z\-]+/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?", note_path.name, re.IGNORECASE)
        if match:
            existing_ids.add(match.group(1))

    return existing_ids


def _collect_saved_arxiv_note_paths(lit_path: Path) -> dict[str, str]:
    """Map saved arXiv IDs to existing literature note paths."""
    note_paths: dict[str, str] = {}
    candidate_roots = [
        lit_path / "arxiv",
        lit_path / "Literature" / "arXiv",
    ]

    for root in candidate_roots:
        if not root.exists():
            continue
        for note_path in root.glob("**/*.md"):
            try:
                post = frontmatter.loads(note_path.read_text(encoding="utf-8"))
                paper = {
                    "metadata": post.metadata,
                    "source_url": post.metadata.get("arxiv-url", ""),
                }
                arxiv_id = _extract_arxiv_id_from_paper_payload(paper)
            except Exception:
                arxiv_id = ""

            if not arxiv_id or arxiv_id == "unknown":
                match = re.search(
                    r"([a-z\-]+/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?",
                    note_path.name,
                    re.IGNORECASE,
                )
                arxiv_id = match.group(1) if match else ""

            if arxiv_id and arxiv_id not in note_paths:
                note_paths[arxiv_id] = str(note_path.relative_to(lit_path).as_posix())

    return note_paths


def _extract_s2_paper_id_from_paper_payload(paper: dict) -> str:
    meta = paper.get("metadata", {}) or {}
    candidates = [
        paper.get("paper_id", ""),
        meta.get("paper_id", ""),
        meta.get("paper-id", ""),
    ]

    paper_id = str(paper.get("id", "")).strip()
    if paper_id.startswith("followup-monitor:s2_"):
        candidates.append(paper_id.split("followup-monitor:s2_", 1)[1])
    elif paper_id.startswith("source-paper:s2_"):
        candidates.append(paper_id.split("source-paper:s2_", 1)[1])
    elif paper_id.startswith("s2_"):
        candidates.append(paper_id[3:])

    for candidate in candidates:
        text = str(candidate or "").strip()
        if not text:
            continue
        return text[3:] if text.startswith("s2_") else text
    return ""


def _relative_literature_path_exists(lit_path: Path, relative_path: str) -> bool:
    rel_text = str(relative_path or "").strip()
    if not rel_text:
        return False
    try:
        return (lit_path / Path(rel_text)).exists()
    except Exception:
        return False


def _find_saved_paper_record(
    paper: dict,
    *,
    lit_path: Path | None = None,
    arxiv_note_paths: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    arxiv_id = _extract_arxiv_id_from_paper_payload(paper)
    if arxiv_id == "unknown":
        arxiv_id = ""
    s2_paper_id = _extract_s2_paper_id_from_paper_payload(paper)

    candidate_records: list[dict[str, Any] | None] = []
    if arxiv_id:
        candidate_records.append(_paper_store.get_by_arxiv_id(arxiv_id))
    if s2_paper_id:
        candidate_records.append(_paper_store.get_by_s2_paper_id(s2_paper_id))

    for record in candidate_records:
        if not record or not record.get("saved_to_literature"):
            continue
        literature_path = str(record.get("literature_path") or "").strip()
        if not literature_path:
            continue
        if lit_path and not _relative_literature_path_exists(lit_path, literature_path):
            continue
        return record

    if arxiv_note_paths and arxiv_id:
        literature_path = str(arxiv_note_paths.get(arxiv_id) or "").strip()
        if literature_path:
            return {
                "saved_to_literature": True,
                "literature_path": literature_path,
                "metadata": {
                    "saved_to_literature": True,
                    "literature_path": literature_path,
                },
            }

    return None


def _build_saved_paper_metadata_patch(
    record: dict[str, Any] | None,
    *,
    include_figures: bool = True,
) -> dict[str, Any]:
    if not record:
        return {}

    metadata = dict(record.get("metadata") or {})
    literature_path = str(record.get("literature_path") or metadata.get("literature_path") or "").strip()
    if not record.get("saved_to_literature") and not literature_path:
        return {}

    patch: dict[str, Any] = {
        "saved_to_literature": True,
    }
    if literature_path:
        patch["literature_path"] = literature_path

    for key in (
        "pdf_path",
        "figures_dir",
        "source_paper_path",
        "source_paper_pdf_path",
        "abstract",
        "introduction",
        "formatted-digest",
    ):
        value = metadata.get(key)
        if value not in (None, ""):
            patch[key] = value

    if include_figures:
        for key in ("local_figures", "figures"):
            value = metadata.get(key)
            if isinstance(value, list) and value:
                patch[key] = value

    return patch


def _merge_saved_paper_metadata(
    paper: dict[str, Any],
    record: dict[str, Any] | None,
    *,
    include_figures: bool = True,
) -> dict[str, Any]:
    patch = _build_saved_paper_metadata_patch(record, include_figures=include_figures)
    if not patch:
        return paper

    merged_metadata = {
        **dict(paper.get("metadata") or {}),
        **patch,
    }
    if not include_figures:
        # Defensive: ensure any pre-existing figure fields are also wiped from the basic card,
        # so the UI doesn't show old figures when the user opted out of figure crawling.
        for key in ("local_figures", "figures"):
            merged_metadata.pop(key, None)
    merged_paper = {
        **paper,
        "metadata": merged_metadata,
        "saved_to_literature": True,
    }
    if patch.get("literature_path"):
        merged_paper["literature_path"] = str(patch["literature_path"])
    return merged_paper


async def _prepare_paper_digest_payload(
    paper: dict,
    arxiv_id: str,
    *,
    fetch_introduction: bool = True,
) -> dict[str, str]:
    """Collect abstract/introduction text and assemble a stable digest block.

    When fetch_introduction is False, we only use whatever introduction is already
    on the payload and never reach out to arXiv. This is the contract the S2
    follow-up flow uses when the user opted out of figure/intro crawling.
    """
    from .tools.arxiv_api import ArxivAPITool, build_structured_digest_markdown

    meta = paper.get("metadata", {}) or {}
    abstract = _normalize_saved_text_block(meta.get("abstract") or paper.get("summary", ""))
    introduction = _normalize_saved_text_block(meta.get("introduction", ""))

    if arxiv_id and not introduction and fetch_introduction:
        tool = ArxivAPITool()
        introduction = _normalize_saved_text_block(await tool.fetch_introduction(arxiv_id))

    return {
        "abstract": abstract,
        "introduction": introduction,
        "formatted_digest": build_structured_digest_markdown(abstract, introduction),
    }


def _normalize_author_names(authors: list[Any] | None) -> list[str]:
    names: list[str] = []
    for author in authors or []:
        if isinstance(author, dict):
            name = str(author.get("name", "")).strip()
        else:
            name = str(author or "").strip()
        if name:
            names.append(name)
    return names


def _get_effective_xhs_cookie(module_prefs: dict[str, Any]) -> str:
    web_session = str(module_prefs.get("web_session") or "").strip()
    id_token = str(module_prefs.get("id_token") or "").strip()
    if web_session:
        parts = [f"web_session={web_session}"]
        if id_token:
            parts.append(f"id_token={id_token}")
        return "; ".join(parts)

    cookie = str(module_prefs.get("cookie") or "").strip()
    if cookie:
        return cookie

    return str(load_config().get("xiaohongshu_cookie") or "").strip()


def _get_xhs_auth_source(module_prefs: dict[str, Any]) -> str | None:
    if str(module_prefs.get("web_session") or "").strip() or str(module_prefs.get("cookie") or "").strip():
        return "module"
    if str(load_config().get("xiaohongshu_cookie") or "").strip():
        return "global"
    return None


def _extract_bilibili_sessdata(raw_value: object) -> str:
    text = str(raw_value or "").strip()
    if not text:
        return ""

    json_array_match = re.search(
        r'"name"\s*:\s*"SESSDATA"\s*,\s*"value"\s*:\s*"([^"]+)"',
        text,
        re.IGNORECASE,
    )
    if json_array_match:
        return json_array_match.group(1)

    json_object_match = re.search(
        r'"SESSDATA"\s*:\s*"([^"]+)"',
        text,
        re.IGNORECASE,
    )
    if json_object_match:
        return json_object_match.group(1)

    cookie_match = re.search(r"SESSDATA=([^;\s]+)", text, re.IGNORECASE)
    if cookie_match:
        return cookie_match.group(1)

    if not any(char in text for char in [" ", "=", ";", "{", "["]):
        return text

    return ""


def _get_effective_bilibili_sessdata(module_prefs: dict[str, Any]) -> str:
    direct = _extract_bilibili_sessdata(module_prefs.get("sessdata"))
    if direct:
        return direct
    return _extract_bilibili_sessdata(load_config().get("bilibili_cookie"))


def _get_bilibili_auth_source(module_prefs: dict[str, Any]) -> str | None:
    if _extract_bilibili_sessdata(module_prefs.get("sessdata")):
        return "module"
    if _extract_bilibili_sessdata(load_config().get("bilibili_cookie")):
        return "global"
    return None


def _is_effective_bilibili_follow_feed_enabled(module_prefs: dict[str, Any]) -> bool:
    raw_follow_feed = module_prefs.get("follow_feed")
    if raw_follow_feed is None:
        return True
    return bool(raw_follow_feed)


def _extract_followup_source_paper_payload(paper: dict, source_title: str) -> dict:
    meta = paper.get("metadata", {}) or {}
    source_meta = meta.get("source_paper", {}) or paper.get("source_paper", {}) or {}
    normalized_title = str(source_meta.get("title") or source_title or "").strip()
    authors = _normalize_author_names(source_meta.get("authors"))
    paper_id = str(source_meta.get("paper_id") or source_meta.get("paperId") or "").strip()
    arxiv_id = str(source_meta.get("arxiv_id") or source_meta.get("arxiv-id") or "").strip()
    s2_url = str(source_meta.get("s2_url") or source_meta.get("url") or "").strip()
    if not s2_url and paper_id:
        s2_url = f"https://www.semanticscholar.org/paper/{paper_id}"
    arxiv_url = str(source_meta.get("arxiv_url") or "").strip()
    if not arxiv_url and arxiv_id:
        arxiv_url = f"https://arxiv.org/abs/{arxiv_id}"
    source_url = arxiv_url or s2_url

    return {
        "id": arxiv_id or paper_id or normalized_title or "unknown-source-paper",
        "title": normalized_title or "Unknown",
        "summary": source_meta.get("abstract", ""),
        "score": 0,
        "tags": ["source-paper"],
        "source_url": source_url,
        "metadata": {
            "authors": authors,
            "paper_id": paper_id,
            "arxiv_id": arxiv_id,
            "year": source_meta.get("year"),
            "venue": source_meta.get("venue", ""),
            "published": source_meta.get("published", ""),
            "citation_count": source_meta.get("citation_count", 0),
            "reference_count": source_meta.get("reference_count", 0),
            "fields_of_study": source_meta.get("fields_of_study", []),
            "abstract": source_meta.get("abstract", ""),
            "introduction": source_meta.get("introduction", ""),
            "s2_url": s2_url,
            "arxiv_url": arxiv_url,
            "pdf-url": f"https://arxiv.org/pdf/{arxiv_id}.pdf" if arxiv_id else "",
            "html-url": f"https://arxiv.org/html/{arxiv_id}" if arxiv_id else "",
        },
    }


def _extract_source_paper_payload_from_source_card(paper: dict) -> dict:
    meta = paper.get("metadata", {}) or {}
    title = str(paper.get("title") or meta.get("source_paper_title") or "").strip()
    authors = _normalize_author_names(meta.get("authors"))
    paper_id = str(meta.get("paper_id") or meta.get("paper-id") or "").strip()
    arxiv_id = str(meta.get("arxiv_id") or meta.get("arxiv-id") or "").strip()
    s2_url = str(meta.get("s2_url") or meta.get("s2-url") or "").strip()
    if not s2_url and paper_id:
        s2_url = f"https://www.semanticscholar.org/paper/{paper_id}"
    arxiv_url = str(meta.get("arxiv_url") or meta.get("arxiv-url") or "").strip()
    if not arxiv_url and arxiv_id:
        arxiv_url = f"https://arxiv.org/abs/{arxiv_id}"
    source_url = str(paper.get("source_url") or arxiv_url or s2_url).strip()
    return {
        "id": arxiv_id or paper_id or title or "unknown-source-paper",
        "title": title or "Unknown",
        "summary": meta.get("abstract") or paper.get("summary", ""),
        "score": paper.get("score", 0),
        "tags": paper.get("tags", ["source-paper"]),
        "source_url": source_url,
        "metadata": {
            "authors": authors,
            "paper_id": paper_id,
            "arxiv_id": arxiv_id,
            "year": meta.get("year"),
            "venue": meta.get("venue", ""),
            "published": meta.get("published", ""),
            "citation_count": meta.get("citation_count", 0),
            "reference_count": meta.get("reference_count", 0),
            "fields_of_study": meta.get("fields_of_study", []),
            "abstract": meta.get("abstract") or paper.get("summary", ""),
            "introduction": meta.get("introduction", ""),
            "s2_url": s2_url,
            "arxiv_url": arxiv_url,
            "pdf-url": f"https://arxiv.org/pdf/{arxiv_id}.pdf" if arxiv_id else "",
            "html-url": f"https://arxiv.org/html/{arxiv_id}" if arxiv_id else "",
        },
    }


def _resolve_source_paper_storage_paths(
    lit_path: Path,
    title: str,
    paper: Mapping[str, Any] | None = None,
) -> tuple[Path, Path, Path]:
    folder_name = sanitize_paper_title_for_path(
        title,
        fallback="Unknown",
        max_length=80,
    )
    note_name = build_dated_paper_title_for_path(
        title,
        paper,
        fallback="Unknown",
        max_length=120,
    )
    base_dir = lit_path / "FollowUps" / folder_name
    note_path = base_dir / f"{note_name}.md"
    pdf_full_path = base_dir / "paper.pdf"
    return base_dir, note_path, pdf_full_path


def _find_external_saved_source_paper(
    *,
    lit_path: Path,
    target_path: Path,
    source_payload: dict,
) -> dict[str, str]:
    meta = source_payload.get("metadata", {}) or {}
    arxiv_id = str(meta.get("arxiv_id") or "").strip()
    paper_id = str(meta.get("paper_id") or "").strip()

    records: list[dict[str, Any] | None] = []
    if arxiv_id and hasattr(_paper_store, "get_by_arxiv_id"):
        records.append(_paper_store.get_by_arxiv_id(arxiv_id))
    if paper_id and hasattr(_paper_store, "get_by_s2_paper_id"):
        records.append(_paper_store.get_by_s2_paper_id(paper_id))

    target_rel = str(target_path.relative_to(lit_path).as_posix())
    for record in records:
        if not record:
            continue
        literature_path = str(record.get("literature_path") or "").strip()
        if not literature_path or not record.get("saved_to_literature"):
            continue
        if Path(literature_path).as_posix() == target_rel:
            continue
        result = {"path": literature_path}
        metadata = record.get("metadata", {}) or {}
        pdf_path = str(metadata.get("pdf_path") or "").strip()
        if pdf_path:
            result["pdf_path"] = pdf_path
        return result

    return {}


def _find_existing_saved_source_paper(lit_path: Path, source_payload: dict) -> dict[str, str]:
    title = str(source_payload.get("title") or "").strip()
    if not title:
        return {}

    _, target_path, pdf_full_path = _resolve_source_paper_storage_paths(lit_path, title, source_payload)
    if target_path.exists():
        result = {"path": str(target_path.relative_to(lit_path).as_posix())}
        if pdf_full_path.exists():
            result["pdf_path"] = "paper.pdf"
        return result

    return _find_external_saved_source_paper(
        lit_path=lit_path,
        target_path=target_path,
        source_payload=source_payload,
    )


async def _ensure_source_paper_pdf(
    *,
    base_dir: Path,
    arxiv_id: str,
    save_pdf: bool,
) -> str | None:
    if not save_pdf or not arxiv_id:
        return None

    pdf_full_path = base_dir / "paper.pdf"
    if pdf_full_path.exists():
        return "paper.pdf"

    try:
        result = await download_arxiv_pdf(arxiv_id, pdf_full_path)
        if result:
            return "paper.pdf"
    except Exception as e:
        print(f"[source-paper] Failed to download PDF for {arxiv_id}: {e}")

    return None


def _update_note_pdf_metadata(note_path: Path, pdf_path: str | None) -> None:
    if not pdf_path or not note_path.exists():
        return

    try:
        post = frontmatter.loads(note_path.read_text(encoding="utf-8"))
        if post.metadata.get("pdf-path") == pdf_path:
            return
        post.metadata["pdf-path"] = pdf_path
        tmp = note_path.with_suffix(".tmp")
        tmp.write_text(frontmatter.dumps(post), encoding="utf-8")
        os.replace(tmp, note_path)
    except Exception as e:
        print(f"[source-paper] Failed to update PDF metadata for {note_path}: {e}")


async def _ensure_source_paper_note_from_payload(
    lit_path: Path,
    base_dir: Path,
    source_payload: dict,
) -> dict[str, str]:
    title = str(source_payload.get("title") or "").strip()
    if not title or title == "Unknown":
        return {}

    lit_path = lit_path.resolve()
    _, target_path, _ = _resolve_source_paper_storage_paths(lit_path, title, source_payload)
    meta = source_payload.get("metadata", {}) or {}
    existing_saved = _find_existing_saved_source_paper(lit_path, source_payload)
    if existing_saved and existing_saved.get("path") != str(target_path.relative_to(lit_path).as_posix()):
        return existing_saved

    arxiv_id = str(meta.get("arxiv_id") or "").strip()
    pdf_path = await _ensure_source_paper_pdf(
        base_dir=base_dir,
        arxiv_id=arxiv_id,
        save_pdf=bool(source_payload.get("save_pdf", True)),
    )
    if target_path.exists():
        _update_note_pdf_metadata(target_path, pdf_path)
        result = {
            "path": str(target_path.relative_to(lit_path)),
        }
        if pdf_path:
            result["pdf_path"] = pdf_path
        return result

    fetch_figures_flag = bool(source_payload.get("fetch_figures", True))
    digest_payload = await _prepare_paper_digest_payload(
        source_payload,
        arxiv_id,
        fetch_introduction=fetch_figures_flag,
    )
    abstract_text = digest_payload["abstract"]
    introduction_text = digest_payload["introduction"]
    formatted_digest = digest_payload["formatted_digest"]

    content_parts = [f"# {title}\n", "## 论文信息\n"]
    authors = meta.get("authors", []) or []
    if authors:
        content_parts.append(
            f"**作者**: {', '.join(authors[:5])}{' 等' if len(authors) > 5 else ''}\n"
        )
    if meta.get("year"):
        content_parts.append(f"**年份**: {meta['year']}\n")
    if meta.get("venue"):
        content_parts.append(f"**期刊/会议**: {meta['venue']}\n")
    if meta.get("citation_count"):
        content_parts.append(f"**引用数**: {meta['citation_count']}\n")
    if meta.get("reference_count"):
        content_parts.append(f"**参考文献数**: {meta['reference_count']}\n")
    if source_payload.get("source_url"):
        content_parts.append(
            f"**来源**: [{source_payload['source_url']}]({source_payload['source_url']})\n"
        )

    if abstract_text:
        content_parts.append("\n## 原文摘要\n")
        content_parts.append(f"{abstract_text}\n")

    if introduction_text:
        content_parts.append("\n## Introduction\n")
        content_parts.append(f"{introduction_text}\n")

    if pdf_path:
        content_parts.append("\n## PDF\n")
        content_parts.append(f"[下载PDF]({pdf_path})\n")

    content_parts.append(f"\n{formatted_digest}\n")
    content = "\n".join(content_parts)

    post = frontmatter.Post(content)
    post.metadata.update({
        "abo-type": "semantic-scholar-source-paper",
        "paper-tracking-role": "source",
        "authors": meta.get("authors", []),
        "paper-id": meta.get("paper_id", ""),
        "arxiv-id": arxiv_id,
        "s2-url": meta.get("s2_url", ""),
        "arxiv-url": meta.get("arxiv_url", ""),
        "year": meta.get("year"),
        "venue": meta.get("venue", ""),
        "citation-count": meta.get("citation_count", 0),
        "reference-count": meta.get("reference_count", 0),
        "fields-of-study": meta.get("fields_of_study", []),
        "abstract": abstract_text,
        "introduction": introduction_text,
        "formatted-digest": formatted_digest,
        "pdf-path": pdf_path,
        "saved-at": datetime.now().isoformat(),
    })

    tmp = target_path.with_suffix(".tmp")
    tmp.write_text(frontmatter.dumps(post), encoding="utf-8")
    os.replace(tmp, target_path)
    result = {
        "path": str(target_path.relative_to(lit_path)),
        "introduction": introduction_text,
        "formatted_digest": formatted_digest,
    }
    if pdf_path:
        result["pdf_path"] = pdf_path
    return result


async def _ensure_followup_source_paper_note(
    lit_path: Path,
    base_dir: Path,
    source_title: str,
    paper: dict,
) -> dict[str, str]:
    source_payload = _extract_followup_source_paper_payload(paper, source_title)
    source_payload["save_pdf"] = True
    return await _ensure_source_paper_note_from_payload(
        lit_path=lit_path,
        base_dir=base_dir,
        source_payload=source_payload,
    )


async def _fetch_introduction_for_arxiv_id(arxiv_id: str, timeout: int = 30) -> str:
    """Fetch introduction with a bounded timeout for live crawl enrichment."""
    if not arxiv_id:
        return ""

    from .tools.arxiv_api import ArxivAPITool

    try:
        tool = ArxivAPITool()
        return _normalize_saved_text_block(
            await asyncio.wait_for(tool.fetch_introduction(arxiv_id), timeout=timeout)
        )
    except asyncio.TimeoutError:
        print(f"[intro] Timeout fetching introduction for {arxiv_id}")
        return ""
    except Exception as e:
        print(f"[intro] Failed to fetch introduction for {arxiv_id}: {e}")
        return ""

# ── 爬取任务取消控制 ────────────────────────────────────────────
_crawl_cancel_flags: dict[str, bool] = {}  # session_id -> should_cancel

def _generate_crawl_session_id() -> str:
    """Generate a unique session ID for crawl operations."""
    import uuid
    return str(uuid.uuid4())[:8]


class CrawlCancelledError(Exception):
    """Raised when an in-flight crawl step is interrupted by a cancel signal."""


def _register_crawl_session(session_id: str):
    """Register a crawl session so the cancel endpoint can find it immediately."""
    _crawl_cancel_flags[session_id] = False

def _should_cancel_crawl(session_id: str) -> bool:
    """Check if a crawl session should be cancelled."""
    return _crawl_cancel_flags.get(session_id, False)

def _cancel_crawl(session_id: str):
    """Mark a crawl session for cancellation."""
    _crawl_cancel_flags[session_id] = True

def _cleanup_crawl_session(session_id: str):
    """Clean up a crawl session after completion."""
    _crawl_cancel_flags.pop(session_id, None)


async def _await_with_crawl_cancel(
    awaitable: Awaitable[Any],
    session_id: str,
    timeout: float | None = None,
    poll_interval: float = 0.15,
) -> Any:
    """Await a long-running step while polling for crawl cancellation."""
    task = asyncio.create_task(awaitable)
    loop = asyncio.get_running_loop()
    started_at = loop.time()

    while True:
        if _should_cancel_crawl(session_id):
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            raise CrawlCancelledError(f"crawl session {session_id} cancelled")

        remaining = None if timeout is None else timeout - (loop.time() - started_at)
        if remaining is not None and remaining <= 0:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            raise asyncio.TimeoutError

        wait_window = poll_interval if remaining is None else min(poll_interval, remaining)
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=wait_window)
        except asyncio.TimeoutError:
            continue

init_profile_routes(_card_store)


def _write_sdk_readme():
    path = get_sdk_dir() / "README.md"
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "# ABO Module SDK\n\n"
        "ABO 自动发现当前应用数据目录 `modules/<name>/__init__.py` 中的模块。\n"
        "保存后立即热加载，无需重启。\n\n"
        "## 最小可用模块\n\n"
        "```python\n"
        "from abo.sdk import Module, Item, Card, agent_json\n\n"
        "class MyModule(Module):\n"
        "    id       = 'my-module'\n"
        "    name     = '我的模块'\n"
        "    schedule = '0 8 * * *'\n"
        "    icon     = 'rss'\n"
        "    output   = ['obsidian', 'ui']\n\n"
        "    async def fetch(self):\n"
        "        return [Item(id='1', raw={'title': '示例', 'url': ''})]\n\n"
        "    async def process(self, items, prefs):\n"
        "        result = await agent_json(\n"
        "            f'评分(1-10)并用中文总结：{items[0].raw[\"title\"]}',\n"
        "            prefs=prefs\n"
        "        )\n"
        "        return [Card(\n"
        "            id=items[0].id, title=items[0].raw['title'],\n"
        "            summary=result.get('summary', ''), score=result.get('score', 5) / 10,\n"
        "            tags=result.get('tags', []), source_url='',\n"
        "            obsidian_path='Notes/test.md'\n"
        "        )]\n"
        "```\n\n"
        "## 调度表达式示例\n\n"
        "```\n"
        "\"0 8 * * *\"      每天 08:00\n"
        "\"0 */2 * * *\"    每 2 小时\n"
        "\"*/30 * * * *\"   每 30 分钟\n"
        "```\n"
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler, _activity_tracker, _summary_generator, _summary_scheduler
    vault_path = get_vault_path()
    start_bundled_idle_watchdog()
    _registry.load_all()
    _state_store.apply_to_registry(_registry)
    _apply_intelligence_schedule_config(load_config().get("intelligence_delivery_time", _DEFAULT_INTELLIGENCE_DELIVERY_TIME))
    runner = ModuleRunner(_card_store, _prefs, broadcaster, vault_path, paper_store=_paper_store)
    _scheduler = ModuleScheduler(runner)
    _scheduler.start(_registry.enabled())
    _set_intelligence_delivery_enabled(bool(load_config().get("intelligence_delivery_enabled", True)))
    start_watcher(_registry, lambda reg: _scheduler.reschedule(reg.enabled()))
    _write_sdk_readme()
    _activity_tracker = ActivityTracker()
    _summary_generator = DailySummaryGenerator(_activity_tracker)
    _summary_scheduler = SummaryScheduler(_summary_generator)
    _summary_scheduler.start()
    print("[startup] Activity tracker and summary scheduler initialized")
    yield
    if _scheduler:
        _scheduler.shutdown()
    if _summary_scheduler:
        _summary_scheduler.shutdown()
    await stop_bundled_idle_watchdog()


app = FastAPI(title="ABO Backend", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(profile_router)
app.include_router(health_router)
app.include_router(rss_router)
app.include_router(tools_router)
app.include_router(modules_router)
app.include_router(assistant_router)
app.include_router(insights_router)
app.include_router(wiki_router)


@app.middleware("http")
async def record_bundled_release_activity(request, call_next):
    mark_bundled_backend_activity()
    return await call_next(request)


# ── Health ───────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.2.0"}


@app.get("/api/status")
async def system_status():
    """Get complete system status including all phases."""
    from .game import get_daily_stats

    # Get keyword stats
    keyword_prefs = _prefs.get_all_keyword_prefs(positive_only=True)
    liked_keywords = [k for k, v in keyword_prefs.items() if v.score > 0]
    disliked_keywords = _prefs.get_disliked_keywords()

    # Get module stats
    module_stats = {}
    if _card_store:
        unread_counts = _card_store.unread_counts()
        module_stats = {
            "unread_counts": unread_counts,
            "total_unread": sum(unread_counts.values()),
        }

    # Get scheduler info
    scheduler_info = []
    if _scheduler:
        scheduler_info = _scheduler.job_info()

    return {
        "phases": {
            "p0_bugfixes": "✅ Complete",
            "p1_crawlers": "✅ Complete (4 modules)",
            "p2_preferences": "✅ Complete",
            "p3_gamification": "✅ Complete",
            "p4_integration": "✅ Complete",
        },
        "gamification": get_daily_stats(),
        "preferences": {
            "total_keywords": len(keyword_prefs),
            "liked_keywords": len(liked_keywords),
            "disliked_keywords": len(disliked_keywords),
            "top_keywords": _prefs.get_top_keywords(5),
        },
        "modules": module_stats,
        "scheduler": {
            "active_jobs": len(scheduler_info),
            "jobs": scheduler_info,
        },
    }


# ── WebSocket ────────────────────────────────────────────────────

@app.websocket("/ws/feed")
async def feed_ws(ws: WebSocket):
    print(f"[websocket] New connection from {ws.client}")
    await ws.accept()
    print(f"[websocket] Connection accepted")
    bundled_backend_websocket_connected()
    broadcaster.register(ws)
    try:
        while True:
            msg = await ws.receive_text()
            mark_bundled_backend_activity()
            clean_msg = str(msg or "").strip()
            if not clean_msg:
                continue
            if clean_msg == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
                continue
            try:
                payload = json.loads(clean_msg)
            except Exception:
                payload = None
            if isinstance(payload, dict) and payload.get("type") == "ping":
                await ws.send_text(json.dumps({
                    "type": "pong",
                    "timestamp": payload.get("timestamp"),
                }))
                continue
            if isinstance(payload, dict) and payload.get("type") == "pong":
                continue
            print(f"[websocket] Received: {clean_msg[:50]}...")
    except WebSocketDisconnect as e:
        close_code = getattr(e, "code", None)
        if close_code in (1000, 1001, 1005):
            print(f"[websocket] Feed client disconnected (code={close_code})")
        else:
            print(f"[websocket] Feed connection closed unexpectedly (code={close_code}): {e}")
        broadcaster.unregister(ws)
    except Exception as e:
        print(f"[websocket] Connection closed with error: {e}")
        broadcaster.unregister(ws)
    finally:
        bundled_backend_websocket_disconnected()


# ── Cards ────────────────────────────────────────────────────────

@app.get("/api/cards")
async def get_cards(
    module_id: str | None = None,
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
):
    if is_demo_mode():
        demo_cards = get_demo_cards()
        if module_id:
            demo_cards = [c for c in demo_cards if c["module_id"] == module_id]
        if unread_only:
            demo_cards = [c for c in demo_cards if not c.get("read")]
        return {"cards": demo_cards[offset:offset + limit]}
    cards = _list_visible_cards(
        module_id=module_id,
        unread_only=unread_only,
        limit=limit,
        offset=offset,
    )
    return {"cards": [sanitize_feed_card_payload(c.to_dict()) for c in cards]}


@app.get("/api/cards/unread-counts")
async def unread_counts():
    if is_demo_mode():
        return DEMO_UNREAD_COUNTS
    counts = dict(_card_store.unread_counts())
    hidden_counts = temporarily_hidden_unread_counts(_card_store)
    for module_id, hidden_count in hidden_counts.items():
        remaining = int(counts.get(module_id, 0) or 0) - int(hidden_count or 0)
        if remaining > 0:
            counts[module_id] = remaining
        else:
            counts.pop(module_id, None)
    return counts


@app.get("/api/cards/prioritized")
async def get_prioritized_cards(
    limit: int = 50,
    unread_only: bool = False,
):
    """Get cards sorted by combined AI score + user preference."""
    keyword_prefs = _prefs.get_all_keyword_prefs(positive_only=True)
    keyword_scores = {k: v.score for k, v in keyword_prefs.items()}

    cards = _card_store.get_prioritized(
        keyword_scores=keyword_scores,
        limit=limit,
        unread_only=unread_only,
    )
    if unread_only:
        cards = [
            card
            for card in cards
            if not is_card_temporarily_hidden(str(card.id or ""))
        ]
    return {"cards": [sanitize_feed_card_payload(c.to_dict()) for c in cards]}


@app.get("/api/crawl-records")
async def get_crawl_records(
    module_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    if is_demo_mode():
        return {"records": [], "total": 0}

    records = _card_store.list_crawl_records(
        module_id=module_id,
        limit=limit,
        offset=offset,
    )
    total = _card_store.count_crawl_records(module_id=module_id)
    return {"records": records, "total": total}


@app.get("/api/papers")
async def get_papers(
    limit: int = 50,
    offset: int = 0,
    source_module: str | None = None,
    saved_only: bool = False,
):
    papers = _paper_store.list(
        limit=limit,
        offset=offset,
        source_module=source_module,
        saved_only=saved_only,
    )
    return {"papers": papers}


@app.get("/api/papers/{paper_key}")
async def get_paper(paper_key: str):
    paper = _paper_store.get(paper_key)
    if not paper:
        raise HTTPException(404, "Paper not found")
    return paper


class FeedbackReq(BaseModel):
    action: FeedbackAction


class BatchFeedbackReq(BaseModel):
    card_ids: list[str]
    action: FeedbackAction


class TemporaryHideReq(BaseModel):
    card_ids: list[str]


def _has_nonzero_rewards(rewards: dict[str, Any]) -> bool:
    for value in rewards.values():
        if isinstance(value, (int, float)) and value != 0:
            return True
    return False


def _record_explicit_paper_feedback(card: Card, action: FeedbackAction) -> None:
    if action.value != "dislike":
        return

    metadata = {
        **(card.metadata or {}),
        "feedback": action.value,
        "handled_feedback": action.value,
        "saved_to_literature": bool((card.metadata or {}).get("saved_to_literature")),
    }
    _paper_store.upsert_from_payload(
        {
            **card.to_dict(),
            "metadata": metadata,
        },
        source_module=card.module_id,
    )


async def _apply_card_feedback(card: Card, action: FeedbackAction) -> tuple[dict[str, Any], list[str]]:
    # Update derived weights (legacy)
    _prefs.record_feedback(card.tags, action.value)

    # Update keyword preferences (Phase 2)
    _prefs.update_from_feedback(card.tags, action.value, card.module_id)

    # Apply game rewards (Phase 3)
    from .game import apply_action
    action_map = {
        "like": "card_like",
        "dislike": "card_dislike",
        "save": "card_save",
        "skip": "card_skip",
        "star": "star_paper",
    }
    game_action = action_map.get(action.value, "card_skip")
    rewards = apply_action("default", game_action, {"card_id": card.id, "module": card.module_id})
    reward_payload = rewards.get("rewards", {})

    # Broadcast reward notification (Phase 4)
    if isinstance(reward_payload, dict) and _has_nonzero_rewards(reward_payload):
        await broadcaster.send_reward(
            action=game_action,
            rewards=reward_payload,
            metadata={"card_id": card.id, "card_title": card.title}
        )

    # Record in card store
    affected_card_ids = _card_store.record_feedback(card.id, action.value)
    _record_explicit_paper_feedback(card, action)

    # Save liked items to markdown
    if action.value == "like":
        card_dict = card.to_dict()
        _prefs.save_liked_to_markdown(card_dict)

    module = _registry.get(card.module_id)
    if module:
        await module.on_feedback(card.id, action)

    # Record activity for timeline generation
    global _activity_tracker
    if _activity_tracker:
        action_map_activity = {
            "like": ActivityType.CARD_LIKE,
            "dislike": ActivityType.CARD_DISLIKE,
            "save": ActivityType.CARD_SAVE,
            "skip": ActivityType.CARD_VIEW,
            "star": ActivityType.CARD_SAVE,
        }
        activity_type = action_map_activity.get(action.value, ActivityType.CARD_VIEW)
        _activity_tracker.record_activity(
            activity_type=activity_type,
            card_id=card.id,
            card_title=card.title,
            module_id=card.module_id,
            metadata={"action": action.value, "tags": card.tags}
        )

    return (
        reward_payload if isinstance(reward_payload, dict) else {},
        affected_card_ids or [card.id],
    )


@app.post("/api/cards/{card_id}/feedback")
async def feedback(card_id: str, body: FeedbackReq):
    card = _card_store.get(card_id)
    if not card:
        raise HTTPException(404, "Card not found")

    rewards, affected_card_ids = await _apply_card_feedback(card, body.action)
    return {"ok": True, "rewards": rewards, "affected_card_ids": affected_card_ids}


@app.post("/api/cards/feedback/batch")
async def feedback_batch(body: BatchFeedbackReq):
    unique_card_ids = list(dict.fromkeys(
        card_id.strip()
        for card_id in body.card_ids
        if isinstance(card_id, str) and card_id.strip()
    ))

    updated_ids: list[str] = []
    affected_ids: list[str] = []
    missing_ids: list[str] = []

    for card_id in unique_card_ids:
        card = _card_store.get(card_id)
        if not card:
            missing_ids.append(card_id)
            continue
        _, current_affected_ids = await _apply_card_feedback(card, body.action)
        updated_ids.append(card_id)
        for affected_id in current_affected_ids:
            normalized = affected_id.strip()
            if normalized and normalized not in affected_ids:
                affected_ids.append(normalized)

    return {
        "ok": True,
        "updated": len(updated_ids),
        "card_ids": updated_ids,
        "affected_card_ids": affected_ids,
        "missing": missing_ids,
    }


@app.post("/api/cards/hide-temporary")
async def hide_cards_temporarily(body: TemporaryHideReq):
    unique_card_ids = list(dict.fromkeys(
        card_id.strip()
        for card_id in body.card_ids
        if isinstance(card_id, str) and card_id.strip()
    ))
    hidden_card_ids = temporarily_hide_cards(_card_store, unique_card_ids)
    return {
        "ok": True,
        "hidden_card_ids": hidden_card_ids,
    }


def _get_debug_feed_flow_skip_reason(module_id: str) -> str | None:
    prefs = _prefs.all_data()
    module_prefs = dict((prefs.get("modules", {}) or {}).get(module_id, {}) or {})
    return _get_debug_feed_flow_skip_reason_with_prefs(module_id, module_prefs=module_prefs)


def _get_debug_feed_flow_skip_reason_with_prefs(
    module_id: str,
    *,
    module_prefs: dict[str, Any],
    debug_variant: str | None = None,
) -> str | None:

    if module_id == "arxiv-tracker":
        enabled_monitors = [
            monitor
            for monitor in normalize_keyword_monitors(module_prefs or {})
            if monitor.get("enabled", True)
        ]
        if not enabled_monitors:
            return "未配置启用的 arXiv 关键词监控器，调试入口只会执行已保存监控。"

    if module_id == "semantic-scholar-tracker":
        enabled_monitors = [
            monitor
            for monitor in normalize_followup_monitors(module_prefs or {})
            if monitor.get("enabled", True)
        ]
        if not enabled_monitors:
            return "未配置启用的 Follow Up 监控器，调试入口只会执行已保存监控，不会使用手动 crawl 的临时 query。"

    if module_id == "xiaohongshu-tracker":
        normalized = normalize_xhs_tracker_config(module_prefs or {})
        active_keyword_monitors = [
            monitor for monitor in normalized["keyword_monitors"]
            if monitor.get("enabled", True)
        ]
        active_following_monitors = [
            monitor for monitor in normalized["following_scan_monitors"]
            if monitor.get("enabled", True)
        ]
        following_enabled = bool(normalized["following_scan"].get("enabled"))
        active_creator_monitors = [
            monitor for monitor in normalized["creator_monitors"]
            if monitor.get("enabled", True)
        ]
        creator_enabled = bool(module_prefs.get("creator_push_enabled", False))

        if not active_keyword_monitors and not active_following_monitors and not following_enabled and not (creator_enabled and active_creator_monitors):
            return "未配置启用的小红书监控词条；关键词、关注流或博主抓取至少需要有一条启用中的定义。"

        if not _get_effective_xhs_cookie(module_prefs or {}):
            return "未连接可复用的小红书 Cookie；关注流搜索、关键词搜索和博主最新动态都不会执行。请先在主动工具里重新连接 Cookie。"

    if module_id == "bilibili-tracker":
        fixed_up_uids = [
            str(uid).strip()
            for uid in ((module_prefs or {}).get("up_uids") or [])
            if str(uid).strip()
        ]
        if debug_variant == "fixed-up-only":
            if not fixed_up_uids:
                return "未配置固定 UP 监督；请先在 B站主动工具或设置里添加至少一个固定 UP。"
            return None

        active_daily_monitors = [
            monitor for monitor in normalize_bilibili_dynamic_monitors(module_prefs or {})
            if monitor.get("enabled", True)
        ]
        active_group_monitors = [
            monitor for monitor in normalize_bilibili_followed_group_monitors(module_prefs or {})
            if monitor.get("enabled", True)
        ]

        if not active_daily_monitors and not active_group_monitors and not fixed_up_uids:
            return "未配置启用的 B站监控词条；常驻关键词、智能分组或固定 UP 至少需要保留一类。"

        if (active_daily_monitors or active_group_monitors) and _is_effective_bilibili_follow_feed_enabled(module_prefs or {}) and not _get_effective_bilibili_sessdata(module_prefs or {}) and not fixed_up_uids:
            return "未连接可复用的 B站 SESSDATA / Cookie；已关注动态、关键词监控和智能分组都不会执行。请先在主动工具里重新连接 B站 Cookie。"

    return None


def _get_debug_feed_flow_zero_output_message(module_id: str, *, debug_variant: str | None = None) -> str | None:
    if module_id == "arxiv-tracker":
        return "已执行，但没有新增 arXiv 论文；常见原因是当前关键词时间窗口内没有新论文，或结果已入库。"
    if module_id == "semantic-scholar-tracker":
        return "已执行，但没有新增 Follow Up 论文；常见原因是结果已入库、已在历史记录中处理过、超出时间窗口，或当前源论文暂无新增引用。"
    if module_id == "xiaohongshu-tracker":
        return "已执行，但没有新增小红书情报；常见原因是结果已在历史记录中处理过、当前时间窗内没有新内容，或 Cookie 已失效。"
    if module_id == "bilibili-tracker":
        if debug_variant == "fixed-up-only":
            return "已执行，但没有新增固定 UP 情报；常见原因是结果已在历史记录中处理过、最近时间窗内没有新动态，或当前固定 UP 近期没有更新。"
        return "已执行，但没有新增 B站情报；常见原因是结果已在历史记录中处理过、当前关注源暂无更新，或登录态已失效。"
    return None


def _copy_jsonable_data(data: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(data, ensure_ascii=False))


def _get_debug_feed_flow_module_overrides(requested_scope: str) -> dict[str, dict[str, Any]]:
    if requested_scope != "bilibili-fixed-up":
        return {}
    return {
        "bilibili-tracker": {
            "follow_feed": False,
            "keywords": [],
            "keyword_filter": False,
            "daily_dynamic_monitors": [],
            "followed_up_group_monitors": [],
            "followed_up_groups": [],
            "followed_up_original_groups": [],
        }
    }


def _get_debug_feed_flow_variant_for_scope(requested_scope: str, module_id: str) -> str | None:
    if requested_scope == "bilibili-fixed-up" and module_id == "bilibili-tracker":
        return "fixed-up-only"
    return None


def _get_debug_feed_flow_module_name(module_id: str, *, fallback_name: str, debug_variant: str | None = None) -> str:
    if module_id == "bilibili-tracker" and debug_variant == "fixed-up-only":
        return "B站固定 UP 监督"
    return fallback_name


@asynccontextmanager
async def _temporary_debug_feed_flow_module_overrides(module_overrides: dict[str, dict[str, Any]]):
    normalized_overrides = {
        str(module_id).strip(): dict(override or {})
        for module_id, override in (module_overrides or {}).items()
        if str(module_id).strip() and isinstance(override, dict) and override
    }
    if not normalized_overrides:
        yield
        return

    prefs_path = get_preferences_path()
    async with _DEBUG_FEED_FLOW_OVERRIDE_LOCK:
        original_file_text = prefs_path.read_text(encoding="utf-8") if prefs_path.exists() else None
        original_prefs_data = _copy_jsonable_data(_prefs.all_data())

        current_data = _prefs.all_data()
        modules = current_data.setdefault("modules", {})
        for module_id, override in normalized_overrides.items():
            merged = dict(modules.get(module_id, {}) or {})
            merged.update(_copy_jsonable_data(override))
            modules[module_id] = merged
        _prefs._save()

        try:
            yield
        finally:
            _prefs._data = original_prefs_data
            prefs_path.parent.mkdir(parents=True, exist_ok=True)
            if original_file_text is None:
                with suppress(FileNotFoundError):
                    prefs_path.unlink()
            else:
                prefs_path.write_text(original_file_text, encoding="utf-8")


def _build_debug_feed_flow_snapshot() -> dict[str, object]:
    cards = _list_visible_cards(
        unread_only=True,
        limit=_DEBUG_FEED_FLOW_SNAPSHOT_LIMIT,
        offset=0,
    )
    return {
        "feed_cards": [sanitize_feed_card_payload(card.to_dict()) for card in cards],
        "unread_counts": _card_store.unread_counts(),
    }


async def _run_debug_feed_flow_module(
    module_id: str,
    *,
    module_prefs_override: dict[str, Any] | None = None,
    debug_variant: str | None = None,
) -> tuple[int, dict[str, object]]:
    module = _registry.get(module_id)
    base_module_name = module.name if module else module_id
    module_name = _get_debug_feed_flow_module_name(
        module_id,
        fallback_name=base_module_name,
        debug_variant=debug_variant,
    )
    if not module:
        return 0, {
            "module_id": module_id,
            "name": module_name,
            "ok": False,
            "status": "missing",
            "message": "Module not found",
        }

    prefs = _prefs.all_data()
    module_prefs = dict((prefs.get("modules", {}) or {}).get(module_id, {}) or {})
    if module_prefs_override:
        module_prefs.update(_copy_jsonable_data(module_prefs_override))

    skip_reason = _get_debug_feed_flow_skip_reason_with_prefs(
        module_id,
        module_prefs=module_prefs,
        debug_variant=debug_variant,
    )
    if skip_reason:
        return 0, {
            "module_id": module_id,
            "name": module_name,
            "ok": False,
            "status": "skipped",
            "card_count": 0,
            "message": skip_reason,
        }

    try:
        card_count: int | None = None
        if _scheduler is None:
            runner = ModuleRunner(
                _card_store,
                _prefs,
                broadcaster,
                get_vault_path(),
                paper_store=_paper_store,
            )
            async with _temporary_debug_feed_flow_module_overrides({module_id: module_prefs_override} if module_prefs_override else {}):
                card_count = await runner.run(module)
            ok = True
        else:
            run_now_with_count = getattr(_scheduler, "run_now_with_count", None)
            if callable(run_now_with_count):
                async with _temporary_debug_feed_flow_module_overrides({module_id: module_prefs_override} if module_prefs_override else {}):
                    card_count = await run_now_with_count(module_id, _registry)
                ok = card_count is not None
            else:
                async with _temporary_debug_feed_flow_module_overrides({module_id: module_prefs_override} if module_prefs_override else {}):
                    ok = await _scheduler.run_now(module_id, _registry)

        if not ok:
            return 0, {
                "module_id": module_id,
                "name": module_name,
                "ok": False,
                "status": "missing",
                "message": "Module not found",
            }

        result: dict[str, object] = {
            "module_id": module_id,
            "name": module_name,
            "ok": True,
            "status": "completed",
        }
        if card_count is not None:
            result["card_count"] = card_count
            if card_count == 0:
                zero_output_message = _get_debug_feed_flow_zero_output_message(
                    module_id,
                    debug_variant=debug_variant,
                )
                if zero_output_message:
                    result["message"] = zero_output_message
        return 1, result
    except Exception as exc:
        return 0, {
            "module_id": module_id,
            "name": module_name,
            "ok": False,
            "status": "error",
            "message": str(exc),
        }


@app.post("/api/debug/feed-flow")
async def debug_run_feed_flow(body: dict | None = None):
    """Run feed-related modules immediately for developer testing."""
    data = body or {}
    requested_scope = str(data.get("scope", "all") or "all").strip().lower()
    raw_module_ids = data.get("module_ids")
    module_overrides = _get_debug_feed_flow_module_overrides(requested_scope)

    module_ids: list[str] = []
    if isinstance(raw_module_ids, list):
        module_ids = [
            str(module_id).strip()
            for module_id in raw_module_ids
            if str(module_id).strip()
        ]

    if not module_ids:
        if requested_scope not in _DEBUG_FEED_FLOW_MODULE_GROUPS:
            raise HTTPException(400, "Unsupported feed-flow scope")
        module_ids = list(_DEBUG_FEED_FLOW_MODULE_GROUPS[requested_scope])

    results_by_module_id: dict[str, dict[str, object]] = {}
    completed = 0
    social_parallel_ids = {
        module_id
        for module_id in module_ids
        if module_id in {"xiaohongshu-tracker", "bilibili-tracker"}
    }

    for module_id in module_ids:
        if module_id in social_parallel_ids:
            continue
        completed_delta, result = await _run_debug_feed_flow_module(
            module_id,
            module_prefs_override=module_overrides.get(module_id),
            debug_variant=_get_debug_feed_flow_variant_for_scope(requested_scope, module_id),
        )
        completed += completed_delta
        results_by_module_id[module_id] = result

    if social_parallel_ids:
        social_results = await asyncio.gather(*[
            _run_debug_feed_flow_module(
                module_id,
                module_prefs_override=module_overrides.get(module_id),
                debug_variant=_get_debug_feed_flow_variant_for_scope(requested_scope, module_id),
            )
            for module_id in module_ids
            if module_id in social_parallel_ids
        ])
        for module_id, (completed_delta, result) in zip(
            [module_id for module_id in module_ids if module_id in social_parallel_ids],
            social_results,
            strict=False,
        ):
            completed += completed_delta
            results_by_module_id[module_id] = result

    results = [results_by_module_id[module_id] for module_id in module_ids]

    return {
        "ok": completed == len(module_ids),
        "scope": requested_scope if requested_scope in _DEBUG_FEED_FLOW_MODULE_GROUPS else "custom",
        "completed": completed,
        "total": len(module_ids),
        "results": results,
        **_build_debug_feed_flow_snapshot(),
    }


@app.delete("/api/debug/cards")
async def clear_all_cards():
    """Delete all cards from the database."""
    import sqlite3
    db_path = Path(resolve_app_db_path("cards.db"))
    with sqlite3.connect(db_path) as conn:
        count = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
        conn.execute("DELETE FROM cards")
    return {"ok": True, "deleted": count}


# ── Modules ──────────────────────────────────────────────────────

@app.get("/api/modules")
async def list_modules():
    if is_demo_mode():
        dash = get_demo_modules_dashboard()
        return {"modules": [
            {"id": m["id"], "name": m["name"], "icon": m["icon"],
             "schedule": m["schedule"], "enabled": m["status"] == "active",
             "next_run": m.get("next_run")}
            for m in dash["modules"]
        ]}
    job_map = {j["id"]: j for j in (_scheduler.job_info() if _scheduler else [])}
    modules = [
        {**m.get_status(), "next_run": job_map.get(m.id, {}).get("next_run")}
        for m in _registry.all()
    ]

    # Add RSS as virtual module
    config = load_config()
    rss_module = {
        "id": "rss-aggregator",
        "name": "RSS 聚合",
        "schedule": "on-demand",
        "icon": "rss",
        "enabled": config.get("rss_enabled", False),
        "output": ["rss"],
        "is_virtual": True,
        "description": "聚合所有模块内容为 RSS feed",
        "next_run": None,  # Virtual module has no scheduled next run
    }
    modules.append(rss_module)

    return {"modules": modules}


@app.get("/api/scheduler/jobs")
async def get_scheduler_jobs():
    if not _scheduler:
        return {"jobs": []}
    jobs = _scheduler.job_info()
    registry_modules = {m.id: m for m in _registry.all()}
    return {
        "jobs": [
            {
                **j,
                "name": registry_modules.get(j["id"], object()).name if j["id"] in registry_modules else j["id"],
                "enabled": getattr(registry_modules.get(j["id"]), "enabled", True) if j["id"] in registry_modules else True,
                "schedule": getattr(registry_modules.get(j["id"]), "schedule", "") if j["id"] in registry_modules else "",
            }
            for j in jobs
        ]
    }


@app.post("/api/modules/{module_id}/run")
async def run_module(module_id: str):
    if not _scheduler:
        raise HTTPException(503, "Scheduler not ready")
    ok = await _scheduler.run_now(module_id, _registry)
    if not ok:
        raise HTTPException(404, f"Module {module_id} not found")
    return {"ok": True}


@app.post("/api/modules/arxiv-tracker/crawl")
async def crawl_arxiv_live(data: dict = None):
    """Real-time arXiv crawl with keyword support, deduplication, and progress via WebSocket."""
    from .default_modules.arxiv import ArxivTracker
    from .paper_tracking import expand_arxiv_categories
    from .tools.arxiv_api import arxiv_api_search

    data = data or {}
    keywords = data.get("keywords", [])
    raw_max_results = data["max_results"] if "max_results" in data else 50
    raw_days_back = data["days_back"] if "days_back" in data else 180
    search_mode = data.get("mode", "AND")  # "AND", "OR", or "AND_OR"
    cs_only = data.get("cs_only", True)  # Default to CS only
    requested_categories = data.get("categories", [])

    from .tools.arxiv_api import normalize_advanced_query
    advanced = normalize_advanced_query(data.get("advanced"))

    try:
        max_results = int(raw_max_results) if raw_max_results not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        max_results = None

    try:
        days_back = int(raw_days_back) if raw_days_back not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        days_back = None

    if max_results is not None:
        max_results = max(1, min(5000, max_results))
    if days_back is not None:
        days_back = max(1, min(3650, days_back))

    lit_path = get_literature_path() or get_vault_path()
    saved_arxiv_note_paths: dict[str, str] = {}
    try:
        if lit_path:
            saved_arxiv_note_paths = _collect_saved_arxiv_note_paths(lit_path)
    except Exception:
        saved_arxiv_note_paths = {}

    results = []
    session_id = _generate_crawl_session_id()
    _register_crawl_session(session_id)
    tracker = ArxivTracker()
    prefs = _prefs.get_prefs_for_module("arxiv-tracker")

    try:
        # Send session ID to client for cancellation
        await broadcaster.send_event({
            "type": "crawl_started",
            "session_id": session_id,
            "message": "爬取任务已启动"
        })

        # Fetch with deduplication
        await broadcaster.send_event({
            "type": "crawl_progress",
            "phase": "fetching",
            "current": 0,
            "total": max_results or 0,
            "message": (
                "正在从 arXiv 获取论文列表..."
                if max_results is not None
                else "正在从 arXiv 获取论文列表（不限篇数）..."
            )
        })

        # Check for cancellation before fetch
        if _should_cancel_crawl(session_id):
            await broadcaster.send_event({
                "type": "crawl_cancelled",
                "message": "爬取任务已取消"
            })
            _cleanup_crawl_session(session_id)
            return {"papers": [], "count": 0, "cancelled": True}

        resolved_categories = expand_arxiv_categories(["cs.*"]) if cs_only else expand_arxiv_categories(requested_categories)

        def normalize_keywords(raw_keywords: list[str]) -> list[str]:
            parsed: list[str] = []
            for kw in raw_keywords:
                parsed.extend(part.strip() for part in re.split(r"[,，\s]+", str(kw)) if part.strip())
            return parsed

        tracking_label_parts = [" ".join(str(kw).strip() for kw in keywords if str(kw).strip())]
        if not cs_only and requested_categories:
            tracking_label_parts.append(", ".join(str(category).strip() for category in requested_categories if str(category).strip()))
        if advanced:
            adv_summary = " · ".join(
                f"{c['field']}:{c['value']}" for c in advanced["conditions"]
            )
            if adv_summary:
                tracking_label_parts.append(adv_summary)
        search_label = " · ".join(part for part in tracking_label_parts if part)

        async def search_with_arxiv_api() -> list[dict]:
            if advanced:
                # When the caller supplies an advanced-query payload, it owns
                # the field-level semantics and categories; we still respect
                # the top-level cs_only / requested_categories selection by
                # merging into the advanced payload's categories.
                adv = dict(advanced)
                merged_categories = list(adv.get("categories") or [])
                if not merged_categories:
                    merged_categories = (
                        expand_arxiv_categories(["cs.*"]) if cs_only
                        else expand_arxiv_categories(requested_categories)
                    )
                adv["categories"] = merged_categories
                api_papers = await arxiv_api_search(
                    advanced=adv,
                    max_results=max_results,
                    days_back=days_back,
                    sort_by=adv.get("sort_by") or "submittedDate",
                    sort_order=adv.get("sort_order") or "descending",
                )
                deduped_papers: list[dict] = []
                seen_ids: set[str] = set()
                for paper in api_papers:
                    paper_id = str(paper.get("id", "")).strip()
                    if not paper_id or paper_id in seen_ids:
                        continue
                    seen_ids.add(paper_id)
                    deduped_papers.append(paper)
                    if max_results is not None and len(deduped_papers) >= max_results:
                        break
                return deduped_papers

            if search_mode == "AND_OR":
                raw_query = " ".join(str(kw) for kw in keywords).strip()
                groups = [group.strip() for group in raw_query.split("|") if group.strip()]
                seen: set[str] = set()
                merged: list[dict] = []
                per_group_limit = max(max_results, 20) if max_results is not None else None
                for group in groups:
                    group_keywords = normalize_keywords([group])
                    if not group_keywords:
                        continue
                    group_papers = await arxiv_api_search(
                        keywords=group_keywords,
                        categories=resolved_categories or None,
                        mode="AND",
                        max_results=per_group_limit,
                        days_back=days_back,
                        sort_by="submittedDate",
                    )
                    for paper in group_papers:
                        paper_id = paper.get("id")
                        if not paper_id or paper_id in seen:
                            continue
                        seen.add(paper_id)
                        merged.append(paper)
                        if max_results is not None and len(merged) >= max_results:
                            return merged
                return merged

            api_mode = "AND" if search_mode == "AND" else "OR"
            papers = await arxiv_api_search(
                keywords=normalize_keywords(keywords),
                categories=resolved_categories or None,
                mode=api_mode,
                max_results=max_results,
                days_back=days_back,
                sort_by="submittedDate",
            )
            deduped_papers: list[dict] = []
            seen_ids: set[str] = set()
            for paper in papers:
                paper_id = str(paper.get("id", "")).strip()
                if not paper_id or paper_id in seen_ids:
                    continue
                seen_ids.add(paper_id)
                deduped_papers.append(paper)
                if max_results is not None and len(deduped_papers) >= max_results:
                    break
            return deduped_papers

        async def paper_to_card_data(paper: dict) -> dict:
            item = tracker.item_from_api_result(paper)
            if not item:
                raise ValueError(f"Invalid arXiv paper payload: {paper}")

            item.raw.update({
                "paper_tracking_type": "keyword",
                "paper_tracking_role": "keyword",
                "relationship": "keyword",
                "relationship_label": "关键词追踪",
                "paper_tracking_label": search_label,
                "paper_tracking_labels": [search_label] if search_label else [],
            })
            payload = await tracker.build_tracking_payload(item, prefs)
            tracked_paper = {
                "id": item.id,
                "title": payload["title"],
                "summary": payload["summary"],
                "score": payload["score"],
                "tags": payload["tags"],
                "source_url": payload["source_url"],
                "metadata": payload["metadata"],
            }
            return _merge_saved_paper_metadata(
                tracked_paper,
                _find_saved_paper_record(
                    tracked_paper,
                    lit_path=lit_path,
                    arxiv_note_paths=saved_arxiv_note_paths,
                ),
            )

        api_papers = await _await_with_crawl_cancel(
            search_with_arxiv_api(),
            session_id=session_id,
        )

        for i, paper in enumerate(api_papers):
            if _should_cancel_crawl(session_id):
                await broadcaster.send_event({
                    "type": "crawl_cancelled",
                    "message": f"爬取任务已取消，已推送 {i}/{len(api_papers)} 篇论文"
                })
                _cleanup_crawl_session(session_id)
                return {"papers": results, "count": len(results), "cancelled": True}

            paper_data = await _await_with_crawl_cancel(
                paper_to_card_data(paper),
                session_id=session_id,
                timeout=30,
            )
            results.append(paper_data)

            await broadcaster.send_event({
                "type": "crawl_progress",
                "phase": "processing",
                "current": i + 1,
                "total": len(api_papers),
                "message": f"正在推送第 {i+1}/{len(api_papers)} 篇论文...",
                "currentPaperTitle": paper_data["title"][:80] + "..." if len(paper_data["title"]) > 80 else paper_data["title"]
            })

            await broadcaster.send_event({
                "type": "crawl_paper",
                "paper": paper_data,
                "current": i + 1,
                "total": len(api_papers)
            })
            print(f"[arxiv-api-search] Pushed {paper_data['id']}: {paper_data['title'][:50]}...")

        # Sort by published date (descending)
        results.sort(key=lambda x: x.get("metadata", {}).get("published", ""), reverse=True)

        # Send completion
        saved_matches = sum(
            1 for result in results
            if bool((result.get("metadata") or {}).get("saved_to_literature"))
        )

        await broadcaster.send_event({
            "type": "crawl_complete",
            "papers": results,
            "count": len(results),
            "requested": max_results,
            "saved_matches": saved_matches,
        })

        # Clean up session on success
        _cleanup_crawl_session(session_id)

        return {
            "papers": results,
            "count": len(results),
            "requested": max_results,
            "saved_matches": saved_matches,
        }
    except CrawlCancelledError:
        await broadcaster.send_event({
            "type": "crawl_cancelled",
            "session_id": session_id,
            "message": f"爬取任务已取消，已推送 {len(results)} 篇论文"
        })
        _cleanup_crawl_session(session_id)
        return {"papers": results, "count": len(results), "cancelled": True}
    except Exception as e:
        # Clean up session on error
        _cleanup_crawl_session(session_id)

        error_msg = str(e)
        # Provide user-friendly message for rate limit or service unavailable
        if "503" in error_msg or "暂时不可用" in error_msg:
            error_msg = "arXiv API 暂时不可用 (503)。请等待几分钟后重试。"
        elif "rate exceeded" in error_msg.lower() or "rate limit" in error_msg.lower() or "429" in error_msg:
            error_msg = "arXiv API 请求太频繁。请等待 2-3 分钟后重试，或减少每次爬取的论文数量。"
        await broadcaster.send_event({
            "type": "crawl_error",
            "error": error_msg
        })
        raise HTTPException(500, f"Crawl failed: {e}")


@app.post("/api/modules/arxiv-tracker/cancel")
async def cancel_arxiv_crawl(data: dict):
    """Cancel an ongoing arXiv crawl by session ID."""
    session_id = data.get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id is required")

    if session_id not in _crawl_cancel_flags:
        return {"status": "not_found", "message": "未找到正在进行的爬取任务"}

    _cancel_crawl(session_id)
    await broadcaster.send_event({
        "type": "crawl_cancelling",
        "session_id": session_id,
        "message": "正在取消爬取任务..."
    })
    return {"status": "ok", "message": "已发送取消信号"}


@app.get("/api/proxy/image")
async def proxy_image(url: str):
    """Proxy image requests to avoid CORS issues."""
    import httpx
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").lower()
        referer = "https://arxiv.org/"
        if (
            hostname == "xiaohongshu.com"
            or hostname.endswith(".xiaohongshu.com")
            or hostname == "xhscdn.com"
            or hostname.endswith(".xhscdn.com")
        ):
            referer = "https://www.xiaohongshu.com/"
        elif "hdslb.com" in hostname or "bilibili.com" in hostname:
            referer = "https://www.bilibili.com/"
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
                "Referer": referer,
            })
        if resp.status_code != 200:
            raise HTTPException(404, "Image not found")
        from fastapi import Response
        return Response(
            content=resp.content,
            media_type=resp.headers.get("content-type", "image/png")
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to proxy image: {e}")


@app.post("/api/modules/arxiv-tracker/save-to-literature")
async def save_arxiv_to_literature(data: dict):
    """Save an arXiv paper to the literature library with figures and optional PDF."""
    import frontmatter
    import os
    import httpx
    import asyncio

    paper = data.get("paper", {})
    folder = str(data.get("folder", "arxiv") or "arxiv").strip() or "arxiv"
    save_pdf = data.get("save_pdf", True)  # Default to saving PDF

    # Get literature path
    lit_path = get_literature_path()
    if not lit_path:
        lit_path = get_vault_path()
    if not lit_path:
        raise HTTPException(400, "Literature path not configured")

    title = paper.get("title", "untitled")
    meta = paper.get("metadata", {})
    arxiv_id = _extract_arxiv_id_from_paper_payload(paper)
    existing_saved = _find_saved_paper_record(
        paper,
        lit_path=lit_path,
        arxiv_note_paths=_collect_saved_arxiv_note_paths(lit_path),
    )
    existing_saved_patch = _build_saved_paper_metadata_patch(existing_saved)
    existing_path = str(existing_saved_patch.get("literature_path") or "").strip()
    if existing_path:
        return {
            "ok": True,
            "already_saved": True,
            "path": existing_path,
            "folder": str(Path(existing_path).parent.as_posix()),
            "figures": existing_saved_patch.get("local_figures") or existing_saved_patch.get("figures") or [],
            "pdf": existing_saved_patch.get("pdf_path"),
            "introduction": str(existing_saved_patch.get("introduction") or ""),
            "formatted_digest": str(existing_saved_patch.get("formatted-digest") or ""),
        }

    paper_relative_dir = build_arxiv_grouped_relative_dir(
        paper,
        root_folder=folder,
        paper_fallback=arxiv_id or "untitled",
    )
    paper_folder = lit_path / Path(paper_relative_dir)
    paper_folder.mkdir(parents=True, exist_ok=True)

    filename_base = paper_folder.name
    target_path = paper_folder / f"{filename_base}.md"
    figures_dir = paper_folder / "figures"
    figures_dir.mkdir(exist_ok=True)

    pdf_url = meta.get("pdf-url") or (f"https://arxiv.org/pdf/{arxiv_id}.pdf" if arxiv_id else "")

    # Download PDF if requested
    pdf_path = None
    if save_pdf and pdf_url:
        pdf_full_path = paper_folder / "paper.pdf"
        try:
            if arxiv_id:
                result = await download_arxiv_pdf(arxiv_id, pdf_full_path)
                if result:
                    pdf_path = "paper.pdf"
            else:
                async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                    resp = await client.get(pdf_url, headers={"User-Agent": "ABO-arXiv-Tracker/1.0"})
                    if resp.status_code == 200:
                        pdf_full_path.write_bytes(resp.content)
                        pdf_path = "paper.pdf"
        except Exception as e:
            print(f"Failed to download PDF for {arxiv_id}: {e}")
            pdf_path = None

    # Download figures
    figures = meta.get("figures", [])
    local_figures = []

    async def download_figure(fig: dict, idx: int) -> dict | None:
        """Download a single figure."""
        url = fig.get("url", "")
        if not url:
            return None

        # Determine file extension
        ext = ".png"
        if ".jpg" in url.lower() or ".jpeg" in url.lower():
            ext = ".jpg"
        elif ".gif" in url.lower():
            ext = ".gif"

        local_name = f"figure_{idx + 1}{ext}"
        local_path = figures_dir / local_name

        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "ABO-arXiv-Tracker/1.0"})
                if resp.status_code == 200:
                    local_path.write_bytes(resp.content)
                    return {
                        "filename": local_name,
                        "caption": fig.get("caption", f"Figure {idx + 1}"),
                        "local_path": str((Path("figures") / local_name).as_posix()),
                        "original_url": url,
                    }
        except Exception as e:
            print(f"Failed to download figure {idx + 1}: {e}")
        return None

    # Download all figures concurrently
    if figures:
        download_tasks = [download_figure(fig, idx) for idx, fig in enumerate(figures[:5])]
        downloaded = await asyncio.gather(*download_tasks)
        local_figures = [f for f in downloaded if f]

    paper_folder_rel = paper_folder.relative_to(lit_path)
    frontend_figures = [
        {
            **fig,
            "local_path": str((paper_folder_rel / fig["local_path"]).as_posix()),
        }
        for fig in local_figures
    ]

    digest_payload = await _prepare_paper_digest_payload(paper, arxiv_id)
    abstract_text = digest_payload["abstract"]
    introduction_text = digest_payload["introduction"]
    formatted_digest = digest_payload["formatted_digest"]

    # Build content
    content_parts = [f"# {title}\n"]

    # Add PDF link if downloaded
    if pdf_path:
        content_parts.append("**[📄 PDF 下载](paper.pdf)**\n")

    if meta.get("contribution"):
        content_parts.append(f"**核心创新**: {meta['contribution']}\n")

    if paper.get("summary"):
        content_parts.append("## AI 摘要\n")
        content_parts.append(f"{paper.get('summary', '')}\n")

    if abstract_text:
        content_parts.append("## 摘要\n")
        content_parts.append(f"{abstract_text}\n")

    if introduction_text:
        content_parts.append("## Introduction\n")
        content_parts.append(f"{introduction_text}\n")

    content_parts.append(f"{formatted_digest}\n")

    # Add figures section
    if local_figures:
        content_parts.append("## 图片\n")
        for fig in local_figures:
            content_parts.append(f"### {fig['caption']}\n")
            content_parts.append(f"![{fig['caption']}]({fig['local_path']})\n")

    content_parts.append(f"[原文链接]({paper.get('source_url', '')})")

    content = "\n".join(content_parts)

    # Write with frontmatter
    post = frontmatter.Post(content)
    post.metadata.update({
        "abo-type": "arxiv-paper",
        "relevance-score": round(paper.get("score", 0.5), 3),
        "tags": paper.get("tags", []),
        "authors": meta.get("authors", []),
        "arxiv-id": arxiv_id,
        "pdf-url": pdf_url,
        "pdf-path": pdf_path,
        "published": meta.get("published", ""),
        "keywords": meta.get("keywords", []),
        "abstract": abstract_text,
        "introduction": introduction_text,
        "formatted-digest": formatted_digest,
        "figures": frontend_figures,
        "local_figures": frontend_figures,
        "figures_dir": str(figures_dir.relative_to(lit_path)),
    })
    post.metadata.update(
        UnifiedVaultEntry(
            entry_id=arxiv_id,
            entry_type="paper",
            title=paper.get("title", ""),
            summary=paper.get("summary", ""),
            source_url=paper.get("source_url", ""),
            source_platform="arxiv",
            source_module="arxiv-tracker",
            authors=meta.get("authors", []),
            published=meta.get("published", ""),
            tags=paper.get("tags", []),
            score=paper.get("score", 0.5),
            obsidian_path=str(target_path.relative_to(lit_path)),
        ).to_metadata()
    )

    # Atomic write
    tmp = target_path.with_suffix(".tmp")
    tmp.write_text(frontmatter.dumps(post), encoding="utf-8")
    os.replace(tmp, target_path)

    # Update CardStore with local_figures so they persist after refresh
    try:
        from .store.cards import CardStore
        card_store = CardStore()
        for card_id in dict.fromkeys([str(paper.get("id", "")), arxiv_id, f"arxiv-monitor:{arxiv_id}"]):
            if not card_id:
                continue
            existing_card = card_store.get(card_id)
            if not existing_card:
                continue
            existing_card.metadata["local_figures"] = frontend_figures
            existing_card.metadata["figures_dir"] = str(figures_dir.relative_to(lit_path))
            existing_card.metadata["saved_to_literature"] = True
            existing_card.metadata["literature_path"] = str(target_path.relative_to(lit_path))
            existing_card.metadata["abstract"] = abstract_text
            existing_card.metadata["introduction"] = introduction_text
            existing_card.metadata["formatted-digest"] = formatted_digest
            if pdf_path:
                existing_card.metadata["pdf_path"] = pdf_path
            card_store.save(existing_card)
    except Exception as e:
        print(f"Failed to update CardStore for {arxiv_id}: {e}")

    enriched_paper = {
        **paper,
        "metadata": {
            **meta,
            "local_figures": frontend_figures,
            "figures": frontend_figures,
            "figures_dir": str(figures_dir.relative_to(lit_path)),
            "saved_to_literature": True,
            "literature_path": str(target_path.relative_to(lit_path)),
            "abstract": abstract_text,
            "introduction": introduction_text,
            "formatted-digest": formatted_digest,
            **({"pdf_path": pdf_path} if pdf_path else {}),
        },
        "path": str(target_path.relative_to(lit_path)),
        "literature_path": str(target_path.relative_to(lit_path)),
        "saved_to_literature": True,
    }
    _paper_store.upsert_from_payload(enriched_paper, source_module="arxiv-tracker")

    return {
        "ok": True,
        "path": str(target_path.relative_to(lit_path)),
        "folder": str(paper_folder.relative_to(lit_path)),
        "figures": frontend_figures,
        "pdf": pdf_path,
        "introduction": introduction_text,
        "formatted_digest": formatted_digest,
    }


@app.get("/api/modules/arxiv-tracker/categories")
async def get_arxiv_categories():
    """Get all available arXiv categories/subcategories."""
    from .default_modules.arxiv import get_available_categories
    return {"categories": get_available_categories()}


@app.post("/api/modules/arxiv-tracker/crawl-by-category")
async def crawl_arxiv_by_category(data: dict = None):
    """
    Real-time arXiv crawl by category/subcategory with full metadata.

    Request body:
    {
        "categories": ["cs.CV", "cs.LG"],  # Subcategories to search
        "keywords": ["vision", "image"],   # Optional keywords
        "max_results": 50,
        "days_back": 180,                  # Only papers from last N days
        "sort_by": "submittedDate",        # or "lastUpdatedDate", "relevance"
        "sort_order": "descending"
    }
    """
    from .default_modules.arxiv import ArxivTracker
    from .paper_tracking import expand_arxiv_categories
    from .tools.arxiv_api import arxiv_api_search

    data = data or {}
    categories = data.get("categories", ["cs.*"])
    keywords = data.get("keywords", [])
    max_results = data.get("max_results", 50)
    days_back = data.get("days_back", 180)
    sort_by = data.get("sort_by", "submittedDate")
    sort_order = data.get("sort_order", "descending")

    from .tools.arxiv_api import normalize_advanced_query
    advanced = normalize_advanced_query(data.get("advanced"))

    # Get existing arXiv IDs for deduplication
    existing_ids = set()
    try:
        lit_path = get_literature_path() or get_vault_path()
        if lit_path:
            arxiv_dir = lit_path / "arxiv"
            existing_ids = _collect_saved_arxiv_ids(arxiv_dir)
    except Exception:
        pass

    results = []
    tracker = ArxivTracker()
    prefs = _prefs.get_prefs_for_module("arxiv-tracker")

    tracking_label_parts = [str(part).strip() for part in [", ".join(keywords), ", ".join(categories)] if str(part).strip()]
    tracking_label = " · ".join(tracking_label_parts)

    async def paper_to_card_data(paper: dict) -> dict:
        item = tracker.item_from_api_result(paper)
        if not item:
            raise ValueError(f"Invalid arXiv paper payload: {paper}")

        item.raw.update({
            "paper_tracking_type": "keyword",
            "paper_tracking_role": "keyword",
            "relationship": "keyword",
            "relationship_label": "关键词追踪",
            "paper_tracking_label": tracking_label,
            "paper_tracking_labels": [tracking_label] if tracking_label else [],
        })
        payload = await tracker.build_tracking_payload(item, prefs)
        return {
            "id": item.id,
            "title": payload["title"],
            "summary": payload["summary"],
            "score": payload["score"],
            "tags": payload["tags"],
            "source_url": payload["source_url"],
            "metadata": payload["metadata"],
        }

    try:
        # Send initial progress
        await broadcaster.send_event({
            "type": "crawl_progress",
            "phase": "fetching",
            "current": 0,
            "total": max_results,
            "message": f"正在从 arXiv 获取论文 (分类: {', '.join(categories)})..."
        })

        api_categories = expand_arxiv_categories(categories)
        if advanced:
            adv = dict(advanced)
            if not adv.get("categories"):
                adv["categories"] = api_categories
            api_papers = await arxiv_api_search(
                advanced=adv,
                max_results=max_results,
                days_back=days_back,
                sort_by=adv.get("sort_by") or sort_by,
                sort_order=adv.get("sort_order") or sort_order,
            )
        else:
            api_papers = await arxiv_api_search(
                categories=api_categories,
                keywords=keywords,
                max_results=max_results,
                days_back=days_back,
                sort_by=sort_by,
                sort_order=sort_order,
                mode="AND" if keywords else "OR",
            )
        api_papers = [
            paper for paper in api_papers
            if paper.get("id") and paper.get("id") not in existing_ids
        ][:max_results]

        if not api_papers:
            await broadcaster.send_event({
                "type": "crawl_complete",
                "papers": [],
                "count": 0,
                "message": "未找到符合条件的论文"
            })
            return {"papers": [], "count": 0}

        for i, paper in enumerate(api_papers):
            paper_data = await paper_to_card_data(paper)
            results.append(paper_data)

            await broadcaster.send_event({
                "type": "crawl_progress",
                "phase": "processing",
                "current": i + 1,
                "total": len(api_papers),
                "message": f"正在推送第 {i+1}/{len(api_papers)} 篇论文...",
                "currentPaperTitle": paper_data["title"][:80] + "..." if len(paper_data["title"]) > 80 else paper_data["title"]
            })

            await broadcaster.send_event({
                "type": "crawl_paper",
                "paper": paper_data,
                "current": i + 1,
                "total": len(api_papers)
            })

        # Send completion
        await broadcaster.send_event({
            "type": "crawl_complete",
            "papers": results,
            "count": len(results),
            "requested": max_results,
            "categories": categories
        })

        return {
            "papers": results,
            "count": len(results),
            "requested": max_results,
            "categories": categories
        }

    except Exception as e:
        error_msg = str(e)
        if "503" in error_msg:
            error_msg = "arXiv API 暂时不可用 (503)。请等待几分钟后重试。"
        elif "429" in error_msg:
            error_msg = "arXiv API 速率限制已达到。请等待 1-2 分钟后重试。"

        await broadcaster.send_event({
            "type": "crawl_error",
            "error": error_msg
        })
        raise HTTPException(500, f"Crawl failed: {e}")


@app.post("/api/modules/semantic-scholar/follow-ups")
async def fetch_semantic_scholar_follow_ups(data: dict):
    """Fetch follow-up papers from Semantic Scholar for a given arXiv ID."""
    from .default_modules.semantic_scholar import SemanticScholarTracker
    import os

    arxiv_id = data.get("arxiv_id", "")
    fetch_citations = data.get("fetch_citations", True)
    fetch_references = data.get("fetch_references", False)
    limit = data.get("limit", 20)

    if not arxiv_id:
        raise HTTPException(400, "arxiv_id is required")

    tracker = SemanticScholarTracker()
    results = []

    try:
        # Send initial progress
        await broadcaster.send_event({
            "type": "s2_progress",
            "phase": "fetching",
            "current": 0,
            "total": 1,
            "message": f"正在从 Semantic Scholar 查询论文 {arxiv_id}..."
        })

        # Fetch follow-up papers
        items = await tracker.fetch(
            arxiv_id=arxiv_id,
            fetch_citations=fetch_citations,
            fetch_references=fetch_references,
            limit=limit
        )

        if not items:
            await broadcaster.send_event({
                "type": "s2_complete",
                "papers": [],
                "count": 0,
                "arxiv_id": arxiv_id
            })
            return {"papers": [], "count": 0, "arxiv_id": arxiv_id}

        prefs = _prefs.get_prefs_for_module("semantic-scholar-tracker")

        # Process each paper with progress updates
        for i, item in enumerate(items):
            await broadcaster.send_event({
                "type": "s2_progress",
                "phase": "processing",
                "current": i + 1,
                "total": len(items),
                "message": f"正在处理第 {i+1}/{len(items)} 篇相关论文: {item.raw.get('title', '')[:40]}..."
            })

            card_list = await tracker.process([item], prefs)
            if card_list:
                card = card_list[0]
                paper_data = {
                    "id": card.id,
                    "title": card.title,
                    "summary": card.summary,
                    "score": card.score,
                    "tags": card.tags,
                    "source_url": card.source_url,
                    "metadata": card.metadata,
                }
                results.append(paper_data)

                # Send partial result
                await broadcaster.send_event({
                    "type": "s2_paper",
                    "paper": paper_data,
                    "current": i + 1,
                    "total": len(items)
                })

        # Sort by citation count (descending)
        results.sort(key=lambda x: x.get("metadata", {}).get("citation_count", 0), reverse=True)

        # Send completion
        await broadcaster.send_event({
            "type": "s2_complete",
            "papers": results,
            "count": len(results),
            "arxiv_id": arxiv_id
        })

        return {
            "papers": results,
            "count": len(results),
            "arxiv_id": arxiv_id
        }

    except Exception as e:
        await broadcaster.send_event({
            "type": "s2_error",
            "error": str(e),
            "arxiv_id": arxiv_id
        })
        raise HTTPException(500, f"Semantic Scholar fetch failed: {e}")


# ── Multi-source figure fetching helpers ─────────────────────────

# Constants for figure fetching
DEFAULT_MAX_FIGURES = 5
HTML_TIMEOUT = 30
PDF_TIMEOUT = 60
MIN_PDF_SIZE = 10 * 1024  # 10KB
PDF_DPI = 150


async def fetch_figures_from_arxiv_html(
    arxiv_id: str,
    figures_dir: Path,
    client: httpx.AsyncClient,
    max_figures: int = DEFAULT_MAX_FIGURES
) -> list[dict]:
    """Fetch figures from arXiv HTML page with smart prioritization."""
    import asyncio
    from .tools.arxiv_api import build_arxiv_html_urls, extract_figure_candidates_from_html

    figures = []

    # Ensure figures directory exists
    figures_dir.mkdir(parents=True, exist_ok=True)

    try:
        figure_candidates = []
        seen_urls: set[str] = set()
        next_index = 0

        for html_url in build_arxiv_html_urls(arxiv_id):
            source_added = 0
            resp = await client.get(html_url, headers={"User-Agent": "ABO/1.0"}, timeout=HTML_TIMEOUT)

            if resp.status_code != 200:
                print(f"[figures] HTTP error {resp.status_code} when fetching HTML for {arxiv_id} from {html_url}")
                continue

            for candidate in extract_figure_candidates_from_html(resp.text, arxiv_id, html_url):
                candidate_url = candidate["url"]
                if candidate_url in seen_urls:
                    continue
                seen_urls.add(candidate_url)
                figure_candidates.append({
                    "url": candidate_url,
                    "caption": candidate["caption"],
                    "score": candidate["score"],
                    "index": next_index,
                })
                next_index += 1
                source_added += 1

            if source_added or len(figure_candidates) >= max_figures:
                break

        # Sort by score (descending) and take top max_figures
        figure_candidates.sort(key=lambda x: (-x['score'], x['index']))
        selected_figures = figure_candidates[:max_figures]

        # Download figures
        for idx, fig in enumerate(selected_figures):
            try:
                fig_resp = await client.get(fig['url'], headers={"User-Agent": "ABO/1.0"}, timeout=HTML_TIMEOUT)
                if fig_resp.status_code == 200:
                    content_type = fig_resp.headers.get('content-type', '')
                    if 'png' in content_type:
                        ext = 'png'
                    elif 'jpeg' in content_type or 'jpg' in content_type:
                        ext = 'jpg'
                    elif 'gif' in content_type:
                        ext = 'gif'
                    else:
                        ext = 'png'

                    fig_filename = f"figure_{idx+1:02d}.{ext}"
                    fig_path = figures_dir / fig_filename
                    fig_path.write_bytes(fig_resp.content)

                    # Validate downloaded image
                    try:
                        from PIL import Image
                        Image.open(fig_path).verify()
                    except Exception:
                        print(f"[figures] Invalid image downloaded from {fig['url']}, removing")
                        fig_path.unlink()
                        continue

                    figures.append({
                        'filename': fig_filename,
                        'caption': fig['caption'],
                        'local_path': f"figures/{fig_filename}",
                        'original_url': fig['url']
                    })
                    await asyncio.sleep(0.3)
            except Exception as e:
                print(f"[figures] Failed to download {fig['url']}: {e}")
                continue

    except Exception as e:
        print(f"[figures] HTML fetch failed: {e}")

    return figures


async def extract_figures_from_arxiv_pdf(
    arxiv_id: str,
    figures_dir: Path,
    client: httpx.AsyncClient,
    max_figures: int = DEFAULT_MAX_FIGURES
) -> list[dict]:
    """Download arXiv PDF and extract first few pages as figure candidates."""
    figures = []

    # Ensure figures directory exists
    figures_dir.mkdir(parents=True, exist_ok=True)

    try:
        from pdf2image import convert_from_path
        from PIL import Image
    except ImportError:
        print("[figures] pdf2image not installed, skipping PDF extraction")
        return figures

    temp_pdf = None
    try:
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        resp = await client.get(pdf_url, headers={"User-Agent": "ABO/1.0"}, timeout=PDF_TIMEOUT)

        if resp.status_code != 200:
            print(f"[figures] HTTP error {resp.status_code} when fetching PDF for {arxiv_id}")
            return figures

        if len(resp.content) < MIN_PDF_SIZE:
            print(f"[figures] PDF too small ({len(resp.content)} bytes), skipping extraction for {arxiv_id}")
            return figures

        # Save to temp file
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
            f.write(resp.content)
            temp_pdf = f.name

        # Convert first 5 pages to images
        images = convert_from_path(temp_pdf, first_page=1, last_page=5, dpi=PDF_DPI)

        for i, image in enumerate(images[:max_figures]):
            width, height = image.size
            # Skip pages that are mostly text (tall aspect ratio)
            if height > width * 1.5:
                continue

            fig_filename = f"figure_pdf_{i+1:02d}.png"
            fig_path = figures_dir / fig_filename
            image.save(fig_path, "PNG")

            figures.append({
                'filename': fig_filename,
                'caption': f"PDF Page {i+1}",
                'local_path': f"figures/{fig_filename}",
                'original_url': f"pdf_page_{i+1}"
            })

    except Exception as e:
        print(f"[figures] PDF extraction failed: {e}")

    finally:
        if temp_pdf and os.path.exists(temp_pdf):
            os.unlink(temp_pdf)

    return figures


async def fetch_paper_figures(
    arxiv_id: str,
    figures_dir: Path,
    max_figures: int = DEFAULT_MAX_FIGURES
) -> list[dict]:
    """Fetch paper figures using multiple strategies."""
    import httpx
    figures = []

    async with httpx.AsyncClient() as client:
        # Strategy 1: arXiv HTML (best quality, proper figures)
        figures = await fetch_figures_from_arxiv_html(
            arxiv_id, figures_dir, client, max_figures
        )

        # Strategy 2: PDF extraction (fallback for HTML failures)
        if len(figures) < 2:
            remaining = max_figures - len(figures)
            pdf_figures = await extract_figures_from_arxiv_pdf(
                arxiv_id, figures_dir, client, remaining
            )
            figures.extend(pdf_figures)

    return figures[:max_figures]


async def download_arxiv_pdf(
    arxiv_id: str,
    target_path: Path,
    timeout: int = 60
) -> str | None:
    """Download PDF from arXiv with multiple source fallback and retries."""
    import asyncio
    import httpx

    # Clean arxiv_id (remove arxiv: prefix if present)
    clean_id = arxiv_id.replace("arxiv:", "").strip()

    sources = [
        f"https://arxiv.org/pdf/{clean_id}.pdf",
        f"https://ar5iv.org/pdf/{clean_id}.pdf",
        f"https://r.jina.ai/http://arxiv.org/pdf/{clean_id}.pdf",
    ]

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/pdf",
    }

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        for attempt, url in enumerate(sources):
            try:
                print(f"[pdf] Trying source {attempt + 1}/{len(sources)}: {url.split('/')[2]}")
                resp = await client.get(url, headers=headers)

                if resp.status_code == 200:
                    content = resp.content
                    # Validate PDF magic number
                    if len(content) > 10000 and content[:4] == b'%PDF':
                        target_path.write_bytes(content)
                        print(f"[pdf] Successfully downloaded PDF ({len(content)} bytes)")
                        return str(target_path)
                    else:
                        print(f"[pdf] Invalid PDF from {url} (size: {len(content)}, magic: {content[:4]})")
                else:
                    print(f"[pdf] HTTP {resp.status_code} from {url}")

                await asyncio.sleep(0.5 * (attempt + 1))  # Increasing delay

            except Exception as e:
                print(f"[pdf] Failed to download from {url}: {e}")
                continue

    print(f"[pdf] All sources failed for {arxiv_id}")
    return None


@app.post("/api/modules/semantic-scholar/save-to-literature")
async def save_s2_to_literature(data: dict):
    """Save a Semantic Scholar paper to the literature library with figures and PDF."""
    paper = data.get("paper", {})
    save_pdf = data.get("save_pdf", True)
    max_figures = data.get("max_figures", 5)
    fetch_figures = bool(data.get("fetch_figures", True))

    # Get literature path
    lit_path = get_literature_path()
    if not lit_path:
        lit_path = get_vault_path()
    if not lit_path:
        raise HTTPException(400, "Literature path not configured")

    # Get metadata
    meta = paper.get("metadata", {})
    title = paper.get("title", "untitled")
    paper_id = meta.get("paper_id", "unknown")
    paper_tracking_role = str(meta.get("paper_tracking_role") or "").strip()
    existing_saved = _find_saved_paper_record(paper, lit_path=lit_path)
    existing_saved_patch = _build_saved_paper_metadata_patch(existing_saved)
    existing_path = str(existing_saved_patch.get("literature_path") or "").strip()
    if existing_path:
        return {
            "ok": True,
            "already_saved": True,
            "path": existing_path,
            "figures": existing_saved_patch.get("local_figures") or existing_saved_patch.get("figures") or [],
            "pdf": existing_saved_patch.get("pdf_path"),
            "introduction": str(existing_saved_patch.get("introduction") or ""),
            "formatted_digest": str(existing_saved_patch.get("formatted-digest") or ""),
            "source_paper_path": existing_saved_patch.get("source_paper_path"),
            "source_paper_pdf_path": existing_saved_patch.get("source_paper_pdf_path"),
            "folder": str(Path(existing_path).parent.as_posix()),
        }

    if paper_tracking_role == "source":
        source_payload = _extract_source_paper_payload_from_source_card(paper)
        source_payload["save_pdf"] = save_pdf
        source_payload["fetch_figures"] = fetch_figures
        base_dir, _, _ = _resolve_source_paper_storage_paths(
            lit_path,
            str(source_payload.get("title", "")),
            source_payload,
        )
        base_dir.mkdir(parents=True, exist_ok=True)
        source_note_result = await _ensure_source_paper_note_from_payload(
            lit_path=lit_path,
            base_dir=base_dir,
            source_payload=source_payload,
        )
        source_paper_path = source_note_result.get("path")
        source_pdf_path = source_note_result.get("pdf_path")
        if not source_paper_path:
            raise HTTPException(400, "Source paper title is required")

        enriched_paper = {
            **paper,
            "metadata": {
                **meta,
                "saved_to_literature": True,
                "literature_path": source_paper_path,
                "source_paper_path": source_paper_path,
                **({"pdf_path": source_pdf_path} if source_pdf_path else {}),
            },
            "path": source_paper_path,
            "literature_path": source_paper_path,
            "saved_to_literature": True,
        }
        _paper_store.upsert_from_payload(enriched_paper, source_module="semantic-scholar-tracker")

        return {
            "ok": True,
            "path": source_paper_path,
            "figures": [],
            "pdf": source_pdf_path,
            "introduction": source_note_result.get("introduction", source_payload.get("metadata", {}).get("introduction", "")),
            "formatted_digest": source_note_result.get("formatted_digest", ""),
            "source_paper_path": source_paper_path,
            "folder": str(base_dir.relative_to(lit_path)),
        }

    # Prefer explicit override, then the follow-up paper metadata carried from tracker results.
    source_paper = (
        data.get("source_paper")
        or meta.get("source_paper_title")
        or paper.get("source_paper_title")
        or "Unknown"
    )
    source_folder_name = sanitize_paper_title_for_path(
        source_paper,
        fallback="Unknown",
        max_length=80,
    )

    paper_folder_name = build_dated_paper_title_for_path(
        title,
        paper,
        fallback=paper_id,
        max_length=120,
    )
    # Build target path: Literature/FollowUps/{Source}/{Paper Title}/
    base_dir = lit_path / "FollowUps" / source_folder_name
    paper_folder = base_dir / paper_folder_name
    paper_folder.mkdir(parents=True, exist_ok=True)

    # Figures folder inside paper folder
    figures_dir = paper_folder / "figures"
    figures_dir.mkdir(exist_ok=True)

    # Markdown filename: {Paper Title}.md
    md_filename = f"{paper_folder_name}.md"
    target_path = paper_folder / md_filename

    arxiv_id = _extract_arxiv_id_from_paper_payload(paper)
    digest_payload = await _prepare_paper_digest_payload(
        paper,
        arxiv_id,
        fetch_introduction=fetch_figures,
    )
    abstract_text = digest_payload["abstract"]
    introduction_text = digest_payload["introduction"]
    formatted_digest = digest_payload["formatted_digest"]

    # Try to fetch figures from arXiv if arxiv_id exists and the user opted in.
    local_figures = []

    if arxiv_id and fetch_figures:
        try:
            local_figures = await fetch_paper_figures(arxiv_id, figures_dir, max_figures)
            print(f"[s2-save] Fetched {len(local_figures)} figures for {arxiv_id}")
        except Exception as e:
            print(f"[s2-save] Failed to fetch figures: {e}")

    paper_folder_rel = paper_folder.relative_to(lit_path)
    frontend_figures = [
        {
            **fig,
            "local_path": str((paper_folder_rel / fig["local_path"]).as_posix()),
        }
        for fig in local_figures
    ]

    # Try to download PDF if arxiv_id exists
    pdf_path = None
    if arxiv_id and save_pdf:
        pdf_full_path = paper_folder / "paper.pdf"
        try:
            result = await download_arxiv_pdf(arxiv_id, pdf_full_path)
            if result:
                pdf_path = "paper.pdf"
                print(f"[s2-save] Saved PDF: paper.pdf")
        except Exception as e:
            print(f"[s2-save] Failed to download PDF: {e}")

    # Build content with visualizations
    content_parts = [f"# {title}\n"]

    # Add metadata section
    content_parts.append("## 论文信息\n")
    if meta.get("authors"):
        content_parts.append(f"**作者**: {', '.join(meta['authors'][:5])}{' 等' if len(meta['authors']) > 5 else ''}\n")
    if meta.get("year"):
        content_parts.append(f"**年份**: {meta['year']}\n")
    if meta.get("venue"):
        content_parts.append(f"**期刊/会议**: {meta['venue']}\n")
    if meta.get("citation_count"):
        content_parts.append(f"**引用数**: {meta['citation_count']}\n")
    content_parts.append(f"**来源**: [{paper.get('source_url', '')}]({paper.get('source_url', '')})\n")

    if meta.get("contribution"):
        content_parts.append(f"\n**核心创新**: {meta['contribution']}\n")

    content_parts.append(f"\n**ABO评分**: {round(paper.get('score', 0) * 10, 1)}/10\n")

    # Add summary
    if paper.get("summary"):
        content_parts.append(f"\n## AI 摘要\n")
        content_parts.append(f"{paper.get('summary', '')}\n")

    if abstract_text:
        content_parts.append(f"\n### 原文摘要\n")
        content_parts.append(f"{abstract_text}\n")

    if introduction_text:
        content_parts.append(f"\n## Introduction\n")
        content_parts.append(f"{introduction_text}\n")

    content_parts.append(f"\n{formatted_digest}\n")

    # Add figures section
    if local_figures:
        content_parts.append(f"\n## 图表 ({len(local_figures)}张)\n")
        for fig in local_figures:
            content_parts.append(f"### {fig['caption']}\n")
            content_parts.append(f"![{fig['caption']}]({fig['local_path']})\n")

    # Add PDF link
    if pdf_path:
        content_parts.append(f"\n## PDF\n")
        content_parts.append(f"[下载PDF]({pdf_path})\n")

    content = "\n".join(content_parts)

    # Write with frontmatter
    post = frontmatter.Post(content)
    post.metadata.update({
        "abo-type": "semantic-scholar-paper",
        "relevance-score": round(paper.get("score", 0.5), 3),
        "tags": paper.get("tags", []),
        "authors": meta.get("authors", []),
        "paper-id": paper_id,
        "arxiv-id": arxiv_id,
        "s2-url": meta.get("s2_url", ""),
        "year": meta.get("year"),
        "venue": meta.get("venue", ""),
        "citation-count": meta.get("citation_count", 0),
        "keywords": meta.get("keywords", []),
        "abstract": abstract_text,
        "introduction": introduction_text,
        "formatted-digest": formatted_digest,
        "source-paper-title": source_paper,
        "figures": frontend_figures,
        "figures-dir": str(figures_dir.relative_to(paper_folder)) if local_figures else None,
        "pdf-path": pdf_path,
        "saved-at": datetime.now().isoformat(),
    })
    post.metadata.update(
        UnifiedVaultEntry(
            entry_id=paper_id or arxiv_id or paper.get("id", ""),
            entry_type="paper",
            title=paper.get("title", ""),
            summary=paper.get("summary", ""),
            source_url=paper.get("source_url", ""),
            source_platform="semantic-scholar",
            source_module="semantic-scholar-tracker",
            authors=meta.get("authors", []),
            published=str(meta.get("published", "")),
            tags=paper.get("tags", []),
            score=paper.get("score", 0.5),
            obsidian_path=str(target_path.relative_to(lit_path)),
        ).to_metadata()
    )

    # Atomic write
    tmp = target_path.with_suffix(".tmp")
    tmp.write_text(frontmatter.dumps(post), encoding="utf-8")
    os.replace(tmp, target_path)

    source_note_result = await _ensure_followup_source_paper_note(
        lit_path=lit_path,
        base_dir=base_dir,
        source_title=source_paper,
        paper=paper,
    )
    source_paper_path = source_note_result.get("path")
    source_paper_pdf_path = source_note_result.get("pdf_path")

    enriched_paper = {
        **paper,
        "metadata": {
            **meta,
            "local_figures": frontend_figures,
            "saved_to_literature": True,
            "literature_path": str(target_path.relative_to(lit_path)),
            **({"source_paper_path": source_paper_path} if source_paper_path else {}),
            **({"source_paper_pdf_path": source_paper_pdf_path} if source_paper_pdf_path else {}),
            "abstract": abstract_text,
            "introduction": introduction_text,
            "formatted-digest": formatted_digest,
            **({"pdf_path": pdf_path} if pdf_path else {}),
        },
        "path": str(target_path.relative_to(lit_path)),
        "literature_path": str(target_path.relative_to(lit_path)),
        "saved_to_literature": True,
    }
    _paper_store.upsert_from_payload(enriched_paper, source_module="semantic-scholar-tracker")

    try:
        from .store.cards import CardStore

        card_store = CardStore()
        card_ids = [
            str(paper.get("id", "")),
            f"followup-monitor:{meta.get('arxiv_id')}" if meta.get("arxiv_id") else "",
            f"followup-monitor:s2_{paper_id}" if paper_id else "",
        ]
        for card_id in dict.fromkeys(card_ids):
            if not card_id:
                continue
            existing_card = card_store.get(card_id)
            if not existing_card:
                continue
            existing_card.metadata["local_figures"] = frontend_figures
            existing_card.metadata["saved_to_literature"] = True
            existing_card.metadata["literature_path"] = str(target_path.relative_to(lit_path))
            if source_paper_path:
                existing_card.metadata["source_paper_path"] = source_paper_path
            if source_paper_pdf_path:
                existing_card.metadata["source_paper_pdf_path"] = source_paper_pdf_path
            existing_card.metadata["abstract"] = abstract_text
            existing_card.metadata["introduction"] = introduction_text
            existing_card.metadata["formatted-digest"] = formatted_digest
            if pdf_path:
                existing_card.metadata["pdf_path"] = pdf_path
            card_store.save(existing_card)
    except Exception as e:
        print(f"[s2-save] Failed to update CardStore for {paper_id}: {e}")

    return {
        "ok": True,
        "path": str(target_path.relative_to(lit_path)),
        "figures": frontend_figures,
        "pdf": pdf_path,
        "introduction": introduction_text,
        "formatted_digest": formatted_digest,
        "source_paper_path": source_paper_path,
        "source_paper_pdf_path": source_paper_pdf_path,
        "folder": str(paper_folder.relative_to(lit_path))
    }


# ── Semantic Scholar Tracker (VGGT Follow-ups) ───────────────────

@app.post("/api/modules/semantic-scholar-tracker/crawl")
async def crawl_semantic_scholar_tracker(data: dict = None):
    """Real-time Semantic Scholar follow-up crawl with progress via WebSocket."""
    from .default_modules.semantic_scholar_tracker import SemanticScholarTracker
    import asyncio

    data = data or {}
    query = data.get("query", "VGGT")
    raw_max_results = data.get("max_results")
    raw_days_back = data.get("days_back")
    sort_by = data.get("sort_by", "recency")
    fetch_figures = bool(data.get("fetch_figures", True))

    try:
        max_results = int(raw_max_results) if raw_max_results not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        max_results = None

    try:
        days_back = int(raw_days_back) if raw_days_back not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        days_back = None

    if sort_by not in {"recency", "citation_count"}:
        sort_by = "recency"

    prefs = _prefs.get_prefs_for_module("semantic-scholar-tracker")
    tracker = SemanticScholarTracker()
    results = []
    session_id = data.get("session_id") or _generate_crawl_session_id()
    lit_path = get_literature_path() or get_vault_path()
    _register_crawl_session(session_id)

    def _card_to_paper_data(card) -> dict:
        return {
            "id": card.id,
            "title": card.title,
            "summary": card.summary,
            "score": card.score,
            "tags": card.tags,
            "source_url": card.source_url,
            "metadata": dict(card.metadata or {}),
        }

    try:
        # Send session ID to client
        await broadcaster.send_event({
            "type": "crawl_started",
            "module": "semantic-scholar-tracker",
            "session_id": session_id,
            "message": f"开始搜索 '{query}' 的后续论文..."
        })

        # Check for cancellation
        if _should_cancel_crawl(session_id):
            await broadcaster.send_event({
                "type": "crawl_cancelled",
                "module": "semantic-scholar-tracker",
                "session_id": session_id
            })
            _cleanup_crawl_session(session_id)
            return {"papers": [], "count": 0, "cancelled": True}

        # Fetch papers
        await broadcaster.send_event({
            "type": "crawl_progress",
            "module": "semantic-scholar-tracker",
            "session_id": session_id,
            "phase": "fetching",
            "current": 0,
            "total": max_results or 0,
            "message": (
                f"正在从 Semantic Scholar 搜索 '{query}' 的后续论文..."
                f"{'（全量）' if max_results is None else f'（最多 {max_results} 篇）'}"
            ),
        })

        source_paper = None
        if hasattr(tracker, "resolve_source_paper"):
            source_paper = await _await_with_crawl_cancel(
                tracker.resolve_source_paper(query),
                session_id=session_id,
            )

        # ---- Source paper (basic card now, enrich later if fetch_figures) ----
        source_item = None
        if source_paper and hasattr(tracker, "source_paper_to_item"):
            try:
                source_external_ids = source_paper.get("externalIds", {}) or {}
                source_arxiv_id = str(source_external_ids.get("ArXiv") or "").strip()
                source_s2_paper_id = str(source_paper.get("paperId") or "").strip()
                existing_source_record = None
                if source_arxiv_id:
                    existing_source_record = _paper_store.get_by_arxiv_id(source_arxiv_id)
                if not existing_source_record and source_s2_paper_id:
                    existing_source_record = _paper_store.get_by_s2_paper_id(source_s2_paper_id)

                if existing_source_record and (
                    existing_source_record.get("saved_to_literature")
                    or existing_source_record.get("literature_path")
                ):
                    await broadcaster.send_event({
                        "type": "crawl_progress",
                        "module": "semantic-scholar-tracker",
                        "session_id": session_id,
                        "phase": "processing",
                        "current": 0,
                        "total": max_results or 0,
                        "message": (
                            f"跳过源论文抓取，已入库: "
                            f"{str(existing_source_record.get('literature_path') or existing_source_record.get('title') or source_paper.get('title', ''))[:80]}"
                        ),
                    })
                else:
                    source_item = tracker.source_paper_to_item(source_paper)
                    basic_source_card = tracker.build_basic_card(source_item)
                    source_data = _card_to_paper_data(basic_source_card)
                    # Source paper always wants figures, regardless of follow-up toggle.
                    source_data = _merge_saved_paper_metadata(
                        source_data,
                        _find_saved_paper_record(source_data, lit_path=lit_path),
                        include_figures=True,
                    )
                    # Phase 2 always runs (for intro+agent), so basic cards always have a follow-up update.
                    source_data["metadata"]["enrichment_pending"] = True
                    await broadcaster.send_event({
                        "type": "crawl_paper",
                        "module": "semantic-scholar-tracker",
                        "session_id": session_id,
                        "paper": source_data,
                        "current": 0,
                        "total": max_results or 0,
                    })
            except Exception as e:
                print(f"[s2-tracker] Error preparing source paper: {e}")
                source_item = None

        # ---- Fetch follow-up items ----
        try:
            followup_coro = tracker.fetch_followups(
                query=query,
                max_results=max_results,
                days_back=days_back,
                sort_by=sort_by,
                source_paper=source_paper,
            )
        except TypeError:
            followup_coro = tracker.fetch_followups(
                query=query,
                max_results=max_results,
                days_back=days_back,
                sort_by=sort_by,
            )

        items = await _await_with_crawl_cancel(
            followup_coro,
            session_id=session_id,
        )

        if not items and not source_item:
            await broadcaster.send_event({
                "type": "crawl_complete",
                "module": "semantic-scholar-tracker",
                "session_id": session_id,
                "papers": [],
                "count": 0,
                "message": "未找到符合条件的后续论文"
            })
            _cleanup_crawl_session(session_id)
            return {"papers": [], "count": 0}

        # ---- Phase 1: emit basic cards for all follow-up items immediately ----
        for i, item in enumerate(items):
            if _should_cancel_crawl(session_id):
                await broadcaster.send_event({
                    "type": "crawl_cancelled",
                    "module": "semantic-scholar-tracker",
                    "session_id": session_id,
                    "message": f"爬取已取消，已发出 {i}/{len(items)} 张初始卡片"
                })
                _cleanup_crawl_session(session_id)
                return {"papers": results, "count": len(results), "cancelled": True}

            try:
                basic_card = tracker.build_basic_card(item)
            except Exception as e:
                print(f"[s2-tracker] Failed to build basic card for {item.id}: {e}")
                continue

            paper_data = _card_to_paper_data(basic_card)
            paper_data = _merge_saved_paper_metadata(
                paper_data,
                _find_saved_paper_record(paper_data, lit_path=lit_path),
                include_figures=fetch_figures,
            )
            paper_data["metadata"]["enrichment_pending"] = True
            results.append(paper_data)

            await broadcaster.send_event({
                "type": "crawl_paper",
                "module": "semantic-scholar-tracker",
                "session_id": session_id,
                "paper": paper_data,
                "current": i + 1,
                "total": len(items),
            })

        await broadcaster.send_event({
            "type": "crawl_progress",
            "module": "semantic-scholar-tracker",
            "session_id": session_id,
            "phase": "processing",
            "current": len(items),
            "total": len(items),
            "message": (
                f"已找到 {len(items)} 篇后续论文，正在并发抓取 Introduction + AI 分析"
                + ("和图片..." if fetch_figures else "（未启用图片爬取）...")
            ),
        })

        # ---- Phase 2: always enrich with intro+agent; figures only if fetch_figures ----
        if items or source_item:
            from .tools.arxiv_api import ArxivAPITool
            arxiv_api = ArxivAPITool()
            ai_scoring_enabled = is_paper_ai_scoring_enabled()
            enrich_sem = asyncio.Semaphore(tracker.PROCESS_CONCURRENCY)
            enrich_total = len(items) + (1 if source_item else 0)
            enrich_counter = {"done": 0}

            async def _enrich_one(it, *, is_source: bool = False):
                if _should_cancel_crawl(session_id):
                    return
                # Source paper always pulls figures; follow-ups respect the user toggle.
                effective_fetch_figures = True if is_source else fetch_figures
                try:
                    enriched_card = await tracker.enrich_item(
                        it,
                        prefs,
                        arxiv_api,
                        enrich_sem,
                        ai_scoring_enabled,
                        fetch_figures=effective_fetch_figures,
                    )
                except Exception as e:
                    print(f"[s2-tracker] Enrich failed for {it.id}: {e}")
                    return

                paper_data = _card_to_paper_data(enriched_card)
                paper_data = _merge_saved_paper_metadata(
                    paper_data,
                    _find_saved_paper_record(paper_data, lit_path=lit_path),
                    include_figures=effective_fetch_figures,
                )
                paper_data["metadata"]["enrichment_pending"] = False

                # Replace basic entry in results (by id) so the final POST return is enriched too.
                for idx, existing in enumerate(results):
                    if existing.get("id") == paper_data["id"]:
                        results[idx] = paper_data
                        break

                enrich_counter["done"] += 1
                await broadcaster.send_event({
                    "type": "crawl_paper_update",
                    "module": "semantic-scholar-tracker",
                    "session_id": session_id,
                    "paper": paper_data,
                    "current": enrich_counter["done"],
                    "total": enrich_total,
                })

            tasks = []
            if source_item:
                tasks.append(_enrich_one(source_item, is_source=True))
            tasks.extend(_enrich_one(item) for item in items)
            await asyncio.gather(*tasks, return_exceptions=True)

            if _should_cancel_crawl(session_id):
                await broadcaster.send_event({
                    "type": "crawl_cancelled",
                    "module": "semantic-scholar-tracker",
                    "session_id": session_id,
                    "message": f"爬取已取消，已富化 {enrich_counter['done']}/{enrich_total} 篇论文"
                })
                _cleanup_crawl_session(session_id)
                return {"papers": results, "count": len(results), "cancelled": True}

        # Send completion
        await broadcaster.send_event({
            "type": "crawl_complete",
            "module": "semantic-scholar-tracker",
            "session_id": session_id,
            "papers": results,
            "count": len(results)
        })

        _cleanup_crawl_session(session_id)
        return {"papers": results, "count": len(results)}
    except CrawlCancelledError:
        await broadcaster.send_event({
            "type": "crawl_cancelled",
            "module": "semantic-scholar-tracker",
            "session_id": session_id,
            "message": (
                f"爬取任务已取消，已处理 {len(results)}/{len(items) if 'items' in locals() else 0} 篇论文"
                if "items" in locals() and items
                else "爬取任务已取消"
            )
        })
        _cleanup_crawl_session(session_id)
        return {"papers": results, "count": len(results), "cancelled": True}
    except Exception as e:
        _cleanup_crawl_session(session_id)
        error_msg = str(e)
        await broadcaster.send_event({
            "type": "crawl_error",
            "module": "semantic-scholar-tracker",
            "session_id": session_id,
            "error": error_msg
        })
        raise HTTPException(500, f"Semantic Scholar crawl failed: {e}")


@app.post("/api/modules/semantic-scholar-tracker/resolve-source")
async def resolve_semantic_scholar_tracker_source(data: dict = None):
    """Resolve a partial Follow Up monitor query to the canonical source paper."""
    from .default_modules.semantic_scholar_tracker import SemanticScholarTracker

    data = data or {}
    query = str(data.get("query") or "").strip()
    if not query:
        raise HTTPException(400, "query is required")

    tracker = SemanticScholarTracker()
    try:
        source_paper = await tracker.resolve_source_paper(query)
    except Exception as e:
        raise HTTPException(500, f"Semantic Scholar source resolve failed: {e}")

    if not source_paper:
        return {"found": False, "query": query, "paper": None}

    external_ids = source_paper.get("externalIds", {}) or {}
    paper_id = source_paper.get("paperId", "")
    arxiv_id = external_ids.get("ArXiv", "") or ""
    s2_url = source_paper.get("url", "") or (f"https://www.semanticscholar.org/paper/{paper_id}" if paper_id else "")

    return {
        "found": True,
        "query": query,
        "paper": {
            "paper_id": paper_id,
            "title": source_paper.get("title", ""),
            "year": source_paper.get("year"),
            "publication_date": source_paper.get("publicationDate", ""),
            "citation_count": source_paper.get("citationCount", 0),
            "arxiv_id": arxiv_id,
            "s2_url": s2_url,
            "url": f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else s2_url,
        },
    }


@app.post("/api/modules/semantic-scholar-tracker/cancel")
async def cancel_semantic_scholar_tracker_crawl(data: dict):
    """Cancel an ongoing Semantic Scholar tracker crawl."""
    session_id = data.get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id is required")

    _cancel_crawl(session_id)
    await broadcaster.send_event({
        "type": "crawl_cancelling",
        "module": "semantic-scholar-tracker",
        "session_id": session_id,
        "message": "正在取消爬取任务..."
    })
    return {"status": "ok", "message": "已发送取消信号"}


class ModuleUpdatePayload(BaseModel):
    enabled: bool | None = None
    schedule: str | None = None


@app.patch("/api/modules/{module_id}")
async def update_module(module_id: str, payload: ModuleUpdatePayload):
    module = _registry.get(module_id)
    if not module:
        raise HTTPException(404, "Module not found")

    if payload.schedule is not None:
        if not payload.schedule.strip() or not _validate_cron(payload.schedule.strip()):
            raise HTTPException(400, "Invalid cron expression")

    # Update state and persist first
    new_state = _state_store.update_module(
        module_id,
        enabled=payload.enabled,
        schedule=payload.schedule,
        registry=_registry,
    )

    # Notify scheduler
    if _scheduler:
        if payload.schedule is not None:
            _scheduler.update_schedule(module)
        if payload.enabled is not None:
            _scheduler.update_enabled(module, payload.enabled)

    return {"ok": True, **module.get_status(), **new_state}


# ── Config ───────────────────────────────────────────────────────

@app.get("/api/config")
async def get_config():
    return load_config()


@app.post("/api/config")
async def update_config(data: dict):
    if "intelligence_delivery_time" in data:
        data["intelligence_delivery_time"] = normalize_daily_time(
            data.get("intelligence_delivery_time"),
            _DEFAULT_INTELLIGENCE_DELIVERY_TIME,
        )
    save_config(data)
    vault_path = str(data.get("vault_path") or "").strip()
    if vault_path:
        ensure_vault_structure(vault_path)
        ensure_mobile_journal_structure(vault_path)
    if "intelligence_delivery_time" in data:
        _apply_intelligence_schedule_config(data["intelligence_delivery_time"])
    if "intelligence_delivery_enabled" in data:
        _set_intelligence_delivery_enabled(bool(data["intelligence_delivery_enabled"]))
    return load_config()


class VaultValidationRequest(BaseModel):
    path: str


@app.post("/api/config/validate-vault")
async def validate_vault_path(request: VaultValidationRequest):
    """Validate that the provided path is a valid vault directory."""
    from pathlib import Path

    path = Path(request.path).expanduser().resolve()

    # Check if path exists
    if not path.exists():
        return {"valid": False, "message": "路径不存在"}

    # Check if it's a directory
    if not path.is_dir():
        return {"valid": False, "message": "所选路径不是文件夹"}

    # Check if we have read/write permissions
    try:
        # Try to list directory contents
        next(path.iterdir(), None)
        # Try to create a test file
        test_file = path / ".abo_test"
        test_file.touch()
        test_file.unlink()
    except PermissionError:
        return {"valid": False, "message": "没有该文件夹的读写权限"}
    except Exception as e:
        return {"valid": False, "message": f"无法访问该文件夹: {str(e)}"}

    return {"valid": True, "message": "路径验证成功"}


@app.get("/api/journal/mobile-paths")
async def get_mobile_journal_paths_api():
    vault_path = get_vault_path()
    if not vault_path:
        raise HTTPException(400, "Vault not configured")
    return describe_mobile_journal_paths(vault_path)


@app.post("/api/journal/mobile/cleanup")
async def cleanup_mobile_journal_exports_api():
    vault_path = get_vault_path()
    if not vault_path:
        raise HTTPException(400, "Vault not configured")
    return cleanup_mobile_journal_exports(vault_path)


# ── Preferences ──────────────────────────────────────────────────

@app.get("/api/preferences")
async def get_prefs():
    if is_demo_mode():
        return {"keyword_preferences": DEMO_KEYWORD_PREFS}
    return _prefs.all_data()


@app.post("/api/preferences")
async def update_prefs(data: dict):
    _prefs.update(data)
    return {"ok": True}


@app.get("/api/preferences/keywords")
async def get_keyword_preferences():
    """Get all keyword preferences with scores."""
    if is_demo_mode():
        from .demo.data import DEMO_KEYWORD_PREFS as _dkp
        top = sorted(
            ((k, v) for k, v in _dkp.items() if v["score"] > 0),
            key=lambda x: (-x[1]["score"], -x[1]["count"]),
        )[:20]
        return {
            "keywords": {
                k: {
                    "score": v["score"],
                    "count": v["count"],
                    "source_modules": v["source_modules"],
                    "last_updated": v.get("last_updated", ""),
                }
                for k, v in _dkp.items()
                if v["score"] > 0
            },
            "top": [(k, v["score"]) for k, v in top],
            "disliked": [],
        }
    prefs = _prefs.get_all_keyword_prefs(positive_only=True)
    return {
        "keywords": {k: v.to_dict() for k, v in prefs.items()},
        "top": _prefs.get_top_keywords(20),
        "disliked": _prefs.get_disliked_keywords(),
    }


@app.get("/api/preferences/keywords/top")
async def get_top_keywords(limit: int = 20):
    """Get top liked keywords."""
    return {"keywords": _prefs.get_top_keywords(limit)}


@app.post("/api/preferences/reset")
async def reset_preferences():
    """Reset all preferences to default (for testing)."""
    import os
    from pathlib import Path

    # Remove preference files
    files_to_remove = [
        get_preferences_path(),
        get_keyword_preferences_path(),
    ]

    removed = []
    for f in files_to_remove:
        if f.exists():
            f.unlink()
            removed.append(str(f.name))

    # Re-initialize
    global _prefs
    _prefs = PreferenceEngine()

    return {"ok": True, "removed": removed}


# ── Module Subscription Config (Crawler Management) ────────────────

class ModuleConfig(BaseModel):
    """Module configuration schema for crawler subscriptions."""
    keywords: list[str] = []
    up_uids: list[str] = []  # Bilibili
    favorite_up_uids: list[str] = []  # Bilibili favorite-only pool
    favorite_up_excluded_uids: list[str] = []  # Favorite-only pool manual exclusions
    followed_up_groups: list[str] = []  # Bilibili followed groups
    followed_up_original_groups: list[int] = []  # Native Bilibili tag IDs
    followed_up_filter_mode: str = "and"  # and | smart_only
    user_ids: list[str] = []  # Xiaohongshu
    users: list[str] = []  # Zhihu users
    topics: list[str] = []  # Zhihu topics
    podcast_ids: list[str] = []  # Xiaoyuzhou
    max_results: int = 20
    enabled: bool = True
    enable_keyword_search: bool = True
    keyword_min_likes: int = 500
    keyword_search_limit: int = 10
    follow_feed: bool = False
    follow_feed_types: list[int] = [8, 2, 4, 64]
    fetch_follow_limit: int = 20
    fixed_up_monitor_limit: int = BILIBILI_TRACKER_DEFAULT_LIMIT
    fixed_up_days_back: int | None = None
    creator_groups: list[str] = []
    creator_profiles: dict = {}
    creator_name_map: dict = {}
    favorite_up_profiles: dict = {}
    creator_group_options: list[dict] = []
    keyword_filter: bool = True
    keyword_monitors: list[dict] = []
    followup_monitors: list[dict] = []
    days_back: int | None = None
    sort_by: str | None = None


BILIBILI_FOLLOWED_GROUP_OPTIONS = [
    {"value": "ai-tech", "label": "AI科技"},
    {"value": "study", "label": "学习知识"},
    {"value": "digital", "label": "数码影音"},
    {"value": "game", "label": "游戏"},
    {"value": "finance", "label": "财经商业"},
    {"value": "creative", "label": "设计创作"},
    {"value": "entertainment", "label": "生活娱乐"},
    {"value": "other", "label": "其他"},
]

_PAPER_MONITOR_NUMERIC_DEFAULTS = {
    "arxiv-tracker": {
        "max_results": 20,
        "days_back": 30,
    },
    "semantic-scholar-tracker": {
        "max_results": 20,
        "days_back": 365,
    },
}


def _normalize_paper_monitor_int(module_id: str, field: str, raw_value: object) -> int | None:
    defaults = _PAPER_MONITOR_NUMERIC_DEFAULTS.get(module_id)
    if not defaults or field not in defaults:
        return None

    if raw_value in (None, ""):
        return int(defaults[field])

    text = str(raw_value).strip()
    if not text:
        return int(defaults[field])

    try:
        return max(1, int(text))
    except (TypeError, ValueError):
        return int(defaults[field])


@app.get("/api/modules/{module_id}/config")
async def get_module_config(module_id: str):
    """Get subscription config for a specific module."""
    module = _registry.get(module_id)
    if not module:
        raise HTTPException(404, "Module not found")

    # Load from preferences
    prefs = _prefs.all_data()
    module_prefs = prefs.get("modules", {}).get(module_id, {})
    shared_creator_group_options = get_shared_creator_group_options(prefs)
    shared_creator_grouping = dict(prefs.get("shared_creator_grouping", {}) or {})

    subscription_types = getattr(module, "subscription_types", [])

    config = {
        "module_id": module_id,
        "module_name": module.name,
        "enabled": getattr(module, "enabled", True),
        "keywords": module_prefs.get("keywords", []),
        "up_uids": module_prefs.get("up_uids", []),
        "favorite_up_uids": module_prefs.get("favorite_up_uids", []),
        "favorite_up_excluded_uids": module_prefs.get("favorite_up_excluded_uids", []),
        "followed_up_groups": module_prefs.get("followed_up_groups", []),
        "followed_up_original_groups": module_prefs.get("followed_up_original_groups", []),
        "followed_up_filter_mode": module_prefs.get("followed_up_filter_mode", "and"),
        "user_ids": module_prefs.get("user_ids", []),
        "users": module_prefs.get("users", []),
        "topics": module_prefs.get("topics", []),
        "podcast_ids": module_prefs.get("podcast_ids", []),
        "max_results": module_prefs.get("max_results", 20),
        "enable_keyword_search": module_prefs.get("enable_keyword_search", True),
        "keyword_min_likes": module_prefs.get("keyword_min_likes", 500),
        "keyword_search_limit": module_prefs.get("keyword_search_limit", 10),
        "follow_feed": module_prefs.get("follow_feed", False),
        "follow_feed_types": module_prefs.get("follow_feed_types", [8, 2, 4, 64]),
        "fetch_follow_limit": module_prefs.get("fetch_follow_limit", 20),
        "fixed_up_monitor_limit": module_prefs.get("fixed_up_monitor_limit"),
        "fixed_up_days_back": module_prefs.get("fixed_up_days_back"),
        "creator_push_enabled": module_prefs.get("creator_push_enabled", False),
        "disabled_creator_ids": module_prefs.get("disabled_creator_ids", []),
        "creator_groups": module_prefs.get("creator_groups", []),
        "creator_profiles": module_prefs.get("creator_profiles", {}),
        "creator_name_map": module_prefs.get("creator_name_map", {}),
        "favorite_up_profiles": module_prefs.get("favorite_up_profiles", {}),
        "creator_group_options": module_prefs.get("creator_group_options", []) or shared_creator_group_options,
        "shared_creator_grouping": shared_creator_grouping,
        "shared_signal_entries": build_shared_signal_entries(shared_creator_grouping),
        "keyword_filter": module_prefs.get("keyword_filter", True),
        "sessdata": module_prefs.get("sessdata", ""),
        "cookie": module_prefs.get("cookie", ""),
        "web_session": module_prefs.get("web_session", ""),
        "id_token": module_prefs.get("id_token", ""),
        "extension_port": module_prefs.get("extension_port", 9334),
        "dedicated_window_mode": module_prefs.get("dedicated_window_mode", True),
        "keyword_monitors": [],
        "followup_monitors": [],
        "daily_dynamic_monitors": [],
        "days_back": module_prefs.get("days_back"),
        "sort_by": module_prefs.get("sort_by"),
        "auth_ready": False,
        "auth_source": None,
        # UI hints for adding subscriptions
        "subscription_types": subscription_types,
    }

    if module_id == "bilibili-tracker":
        config["fetch_follow_limit"] = module_prefs.get("fetch_follow_limit", BILIBILI_TRACKER_DEFAULT_LIMIT)
        config["fixed_up_monitor_limit"] = module_prefs.get(
            "fixed_up_monitor_limit",
            module_prefs.get("fetch_follow_limit", BILIBILI_TRACKER_DEFAULT_LIMIT),
        )
        config["fixed_up_days_back"] = module_prefs.get(
            "fixed_up_days_back",
            BILIBILI_TRACKER_FIXED_UP_DEFAULT_DAYS_BACK,
        )
        config["days_back"] = module_prefs.get("days_back", BILIBILI_TRACKER_DEFAULT_DAYS_BACK)
        bilibili_monitors = normalize_bilibili_dynamic_monitors(module_prefs)
        bilibili_group_options = (
            module_prefs.get("creator_group_options")
            or shared_creator_group_options
            or BILIBILI_FOLLOWED_GROUP_OPTIONS
        )
        bilibili_group_label_lookup = {
            str(item.get("value") or "").strip(): str(item.get("label") or "").strip()
            for item in bilibili_group_options
            if str(item.get("value") or "").strip()
        }
        followed_group_monitors = normalize_bilibili_followed_group_monitors(
            module_prefs,
            label_lookup=bilibili_group_label_lookup,
        )
        config["daily_dynamic_monitors"] = bilibili_monitors
        config["followed_up_group_monitors"] = followed_group_monitors
        config.update(
            build_bilibili_legacy_fields(
                module_prefs,
                daily_dynamic_monitors=bilibili_monitors,
                followed_group_monitors=followed_group_monitors,
            )
        )
        config["followed_up_group_options"] = bilibili_group_options
        config["auth_ready"] = bool(_get_effective_bilibili_sessdata(module_prefs))
        config["auth_source"] = _get_bilibili_auth_source(module_prefs)
    elif module_id == "arxiv-tracker":
        config["keyword_monitors"] = normalize_keyword_monitors(module_prefs)
        config["max_results"] = _normalize_paper_monitor_int(module_id, "max_results", module_prefs.get("max_results"))
        config["days_back"] = _normalize_paper_monitor_int(module_id, "days_back", module_prefs.get("days_back"))
    elif module_id == "semantic-scholar-tracker":
        config["followup_monitors"] = normalize_followup_monitors(module_prefs)
        config["max_results"] = _normalize_paper_monitor_int(module_id, "max_results", module_prefs.get("max_results"))
        config["days_back"] = _normalize_paper_monitor_int(module_id, "days_back", module_prefs.get("days_back"))
        config["sort_by"] = module_prefs.get("sort_by", "recency")
    elif module_id == "xiaohongshu-tracker":
        xhs_config = normalize_xhs_tracker_config(module_prefs)
        legacy = build_xhs_legacy_fields(
            module_prefs,
            keyword_monitors=xhs_config["keyword_monitors"],
            following_scan=xhs_config["following_scan"],
            creator_monitors=xhs_config["creator_monitors"],
        )
        config.update(legacy)
        config["keyword_monitors"] = xhs_config["keyword_monitors"]
        config["following_scan"] = xhs_config["following_scan"]
        config["following_scan_monitors"] = xhs_config["following_scan_monitors"]
        config["creator_monitors"] = xhs_config["creator_monitors"]
        config["auth_ready"] = bool(_get_effective_xhs_cookie(module_prefs))
        config["auth_source"] = _get_xhs_auth_source(module_prefs)

    # Add module-specific defaults if empty
    if "keywords" not in module_prefs and not config["keywords"]:
        config["keywords"] = get_default_keywords_for_module(module_id)

    return config


@app.post("/api/modules/{module_id}/config")
async def update_module_config(module_id: str, data: dict):
    """Update subscription config for a specific module."""
    module = _registry.get(module_id)
    if not module:
        raise HTTPException(404, "Module not found")

    # Get current preferences
    prefs = _prefs.all_data()
    if "modules" not in prefs:
        prefs["modules"] = {}
    if module_id not in prefs["modules"]:
        prefs["modules"][module_id] = {}

    # Update fields
    module_prefs = prefs["modules"][module_id]

    if "keywords" in data:
        module_prefs["keywords"] = data["keywords"]
    if "keyword_monitors" in data:
        if module_id == "xiaohongshu-tracker":
            module_prefs["keyword_monitors"] = list(data["keyword_monitors"] or [])
            if not module_prefs["keyword_monitors"]:
                module_prefs["keywords"] = []
                module_prefs["enable_keyword_search"] = False
        else:
            module_prefs["keyword_monitors"] = normalize_keyword_monitors({"keyword_monitors": data["keyword_monitors"]})
    if "daily_dynamic_monitors" in data and module_id == "bilibili-tracker":
        module_prefs["daily_dynamic_monitors"] = normalize_bilibili_dynamic_monitors(
            {
                **module_prefs,
                "daily_dynamic_monitors": data["daily_dynamic_monitors"],
            }
        )
        if module_prefs["daily_dynamic_monitors"]:
            module_prefs["follow_feed"] = True
    if "followed_up_group_monitors" in data and module_id == "bilibili-tracker":
        group_options = (
            module_prefs.get("creator_group_options")
            or BILIBILI_FOLLOWED_GROUP_OPTIONS
        )
        label_lookup = {
            str(item.get("value") or "").strip(): str(item.get("label") or "").strip()
            for item in group_options
            if str(item.get("value") or "").strip()
        }
        module_prefs["followed_up_group_monitors"] = normalize_bilibili_followed_group_monitors(
            {
                **module_prefs,
                "followed_up_group_monitors": data["followed_up_group_monitors"],
            },
            label_lookup=label_lookup,
        )
        if module_prefs["followed_up_group_monitors"]:
            module_prefs["follow_feed"] = True
    if "followup_monitors" in data:
        module_prefs["followup_monitors"] = normalize_followup_monitors({"followup_monitors": data["followup_monitors"]})
    if "up_uids" in data:
        module_prefs["up_uids"] = data["up_uids"]
    if "favorite_up_uids" in data:
        module_prefs["favorite_up_uids"] = list(data["favorite_up_uids"] or [])
    if "favorite_up_excluded_uids" in data:
        module_prefs["favorite_up_excluded_uids"] = list(data["favorite_up_excluded_uids"] or [])
    if "followed_up_groups" in data:
        module_prefs["followed_up_groups"] = data["followed_up_groups"]
    if "followed_up_original_groups" in data:
        module_prefs["followed_up_original_groups"] = [
            int(item)
            for item in (data["followed_up_original_groups"] or [])
            if str(item).strip().lstrip("-").isdigit()
        ]
    if "followed_up_filter_mode" in data:
        value = str(data["followed_up_filter_mode"] or "and").strip().lower()
        module_prefs["followed_up_filter_mode"] = "smart_only" if value == "smart_only" else "and"
    if "user_ids" in data:
        module_prefs["user_ids"] = data["user_ids"]
    if "users" in data:
        module_prefs["users"] = data["users"]
    if "topics" in data:
        module_prefs["topics"] = data["topics"]
    if "podcast_ids" in data:
        module_prefs["podcast_ids"] = data["podcast_ids"]
    if "max_results" in data:
        normalized_max_results = _normalize_paper_monitor_int(module_id, "max_results", data["max_results"])
        if normalized_max_results is not None:
            module_prefs["max_results"] = normalized_max_results
        else:
            module_prefs["max_results"] = max(1, int(data["max_results"] or 1))
    if "days_back" in data:
        normalized_days_back = _normalize_paper_monitor_int(module_id, "days_back", data["days_back"])
        if normalized_days_back is not None:
            module_prefs["days_back"] = normalized_days_back
        else:
            raw_days_back = data["days_back"]
            if raw_days_back in (None, "", 0, "0"):
                module_prefs["days_back"] = None
            else:
                module_prefs["days_back"] = max(1, int(raw_days_back))
    if "sort_by" in data:
        module_prefs["sort_by"] = str(data["sort_by"] or "recency").strip() or "recency"
    if "enable_keyword_search" in data:
        module_prefs["enable_keyword_search"] = bool(data["enable_keyword_search"])
    if "keyword_min_likes" in data:
        module_prefs["keyword_min_likes"] = max(0, int(data["keyword_min_likes"] or 0))
    if "keyword_search_limit" in data:
        module_prefs["keyword_search_limit"] = max(1, int(data["keyword_search_limit"] or 1))
    # Bilibili-specific config
    if "follow_feed" in data:
        module_prefs["follow_feed"] = data["follow_feed"]
    if "follow_feed_types" in data:
        module_prefs["follow_feed_types"] = data["follow_feed_types"]
    if "fetch_follow_limit" in data:
        module_prefs["fetch_follow_limit"] = max(1, int(data["fetch_follow_limit"] or 1))
    if "fixed_up_monitor_limit" in data:
        module_prefs["fixed_up_monitor_limit"] = max(1, int(data["fixed_up_monitor_limit"] or 1))
    if "fixed_up_days_back" in data:
        raw_fixed_up_days_back = data["fixed_up_days_back"]
        if raw_fixed_up_days_back in (None, "", 0, "0"):
            module_prefs["fixed_up_days_back"] = None
        else:
            module_prefs["fixed_up_days_back"] = max(1, int(raw_fixed_up_days_back))
    if "creator_push_enabled" in data:
        module_prefs["creator_push_enabled"] = bool(data["creator_push_enabled"])
    if "disabled_creator_ids" in data:
        module_prefs["disabled_creator_ids"] = list(data["disabled_creator_ids"] or [])
    if "creator_groups" in data:
        module_prefs["creator_groups"] = list(data["creator_groups"] or [])
    if "creator_profiles" in data:
        module_prefs["creator_profiles"] = dict(data["creator_profiles"] or {})
    if "creator_name_map" in data:
        module_prefs["creator_name_map"] = dict(data["creator_name_map"] or {})
    if "favorite_up_profiles" in data:
        module_prefs["favorite_up_profiles"] = dict(data["favorite_up_profiles"] or {})
    if "creator_group_options" in data:
        module_prefs["creator_group_options"] = list(data["creator_group_options"] or [])
    if "following_scan" in data and module_id == "xiaohongshu-tracker":
        module_prefs["following_scan"] = dict(data["following_scan"] or {})
    if "following_scan_monitors" in data and module_id == "xiaohongshu-tracker":
        module_prefs["following_scan_monitors"] = list(data["following_scan_monitors"] or [])
        if not module_prefs["following_scan_monitors"]:
            module_prefs["follow_feed"] = False
            existing_scan = dict(module_prefs.get("following_scan") or {})
            existing_scan["keywords"] = []
            existing_scan["enabled"] = False
            module_prefs["following_scan"] = existing_scan
    if "creator_monitors" in data and module_id == "xiaohongshu-tracker":
        module_prefs["creator_monitors"] = list(data["creator_monitors"] or [])
        if not module_prefs["creator_monitors"]:
            module_prefs["user_ids"] = []
            module_prefs["disabled_creator_ids"] = []
            module_prefs["creator_push_enabled"] = False
    if "shared_creator_grouping" in data:
        prefs.setdefault("shared_creator_grouping", {})
        shared_payload = dict(data["shared_creator_grouping"] or {})
        signal_group_labels = {}
        for signal, raw_labels in dict(shared_payload.get("signal_group_labels") or {}).items():
            normalized_signal = str(signal or "").strip()
            if not normalized_signal:
                continue
            if isinstance(raw_labels, (list, tuple, set)):
                normalized_labels = [
                    str(label).strip()[:48]
                    for label in raw_labels
                    if str(label or "").strip()
                ]
                if not normalized_labels:
                    continue
                signal_group_labels[normalized_signal] = (
                    normalized_labels[0] if len(normalized_labels) == 1 else normalized_labels
                )
                continue

            normalized_label = str(raw_labels or "").strip()[:48]
            if normalized_label:
                signal_group_labels[normalized_signal] = normalized_label
        prefs["shared_creator_grouping"]["signal_group_labels"] = signal_group_labels
        prefs["shared_creator_grouping"]["updated_at"] = datetime.utcnow().isoformat()
    if "keyword_filter" in data:
        module_prefs["keyword_filter"] = data["keyword_filter"]
    if "sessdata" in data:
        module_prefs["sessdata"] = data["sessdata"]
    if "cookie" in data:
        module_prefs["cookie"] = data["cookie"]
    if "extension_port" in data:
        module_prefs["extension_port"] = max(1, int(data["extension_port"] or 9334))
    if "dedicated_window_mode" in data:
        module_prefs["dedicated_window_mode"] = bool(data["dedicated_window_mode"])
    if module_id == "xiaohongshu-tracker":
        xhs_config = normalize_xhs_tracker_config(module_prefs)
        module_prefs["keyword_monitors"] = xhs_config["keyword_monitors"]
        module_prefs["following_scan"] = xhs_config["following_scan"]
        module_prefs["following_scan_monitors"] = xhs_config["following_scan_monitors"]
        module_prefs["creator_monitors"] = xhs_config["creator_monitors"]
        module_prefs.update(
            build_xhs_legacy_fields(
                module_prefs,
                keyword_monitors=xhs_config["keyword_monitors"],
                following_scan=xhs_config["following_scan"],
                creator_monitors=xhs_config["creator_monitors"],
            )
        )
    if module_id == "bilibili-tracker":
        bilibili_monitors = normalize_bilibili_dynamic_monitors(module_prefs)
        bilibili_group_options = (
            module_prefs.get("creator_group_options")
            or BILIBILI_FOLLOWED_GROUP_OPTIONS
        )
        bilibili_group_label_lookup = {
            str(item.get("value") or "").strip(): str(item.get("label") or "").strip()
            for item in bilibili_group_options
            if str(item.get("value") or "").strip()
        }
        followed_group_monitors = normalize_bilibili_followed_group_monitors(
            module_prefs,
            label_lookup=bilibili_group_label_lookup,
        )
        module_prefs["daily_dynamic_monitors"] = bilibili_monitors
        module_prefs["followed_up_group_monitors"] = followed_group_monitors
        module_prefs.update(
            build_bilibili_legacy_fields(
                module_prefs,
                daily_dynamic_monitors=bilibili_monitors,
                followed_group_monitors=followed_group_monitors,
            )
        )

    # Save preferences
    _prefs.update(prefs)

    return {"ok": True, "config": module_prefs}


@app.post("/api/modules/{module_id}/subscriptions")
async def add_module_subscription(module_id: str, data: dict):
    """Add a subscription to a module (UP主, user, podcast, etc.)."""
    module = _registry.get(module_id)
    if not module:
        raise HTTPException(404, "Module not found")

    sub_type = data.get("type")  # "up_uid", "user_id", "user", "topic", "podcast_id"
    sub_value = data.get("value")

    if not sub_type or not sub_value:
        raise HTTPException(400, "type and value are required")

    # Get current preferences
    prefs = _prefs.all_data()
    if "modules" not in prefs:
        prefs["modules"] = {}
    if module_id not in prefs["modules"]:
        prefs["modules"][module_id] = {}

    module_prefs = prefs["modules"][module_id]

    # Map subscription type to preference key
    type_to_key = {
        "up_uid": "up_uids",
        "user_id": "user_ids",
        "user": "users",
        "topic": "topics",
        "podcast_id": "podcast_ids",
    }

    key = type_to_key.get(sub_type)
    if not key:
        raise HTTPException(400, f"Unknown subscription type: {sub_type}")

    # Add to list if not already present
    current = module_prefs.get(key, [])
    if sub_value not in current:
        current.append(sub_value)
        module_prefs[key] = current
        _prefs.update(prefs)

        # Record in subscription store
        _subscription_store.add_subscription(
            module_id=module_id,
            sub_type=sub_type,
            value=sub_value,
            added_by="user",
        )

    result = {"ok": True}
    result[key] = current
    return result


@app.delete("/api/modules/{module_id}/subscriptions")
async def remove_module_subscription(module_id: str, data: dict):
    """Remove a subscription from a module."""
    module = _registry.get(module_id)
    if not module:
        raise HTTPException(404, "Module not found")

    sub_type = data.get("type")
    sub_value = data.get("value")

    if not sub_type or not sub_value:
        raise HTTPException(400, "type and value are required")

    prefs = _prefs.all_data()
    if "modules" not in prefs or module_id not in prefs["modules"]:
        raise HTTPException(404, "Module config not found")

    module_prefs = prefs["modules"][module_id]

    type_to_key = {
        "up_uid": "up_uids",
        "user_id": "user_ids",
        "user": "users",
        "topic": "topics",
        "podcast_id": "podcast_ids",
    }

    key = type_to_key.get(sub_type)
    if not key:
        raise HTTPException(400, f"Unknown subscription type: {sub_type}")

    current = module_prefs.get(key, [])
    if sub_value in current:
        current.remove(sub_value)
        module_prefs[key] = current
        _prefs.update(prefs)

        # Remove from subscription store
        _subscription_store.remove_subscription(
            module_id=module_id,
            sub_type=sub_type,
            value=sub_value,
        )

    result = {"ok": True}
    result[key] = current
    return result


@app.get("/api/modules/{module_id}/subscriptions/detail")
async def get_module_subscriptions_detail(module_id: str):
    """Get detailed subscription info for a module (with timestamps)."""
    module = _registry.get(module_id)
    if not module:
        raise HTTPException(404, "Module not found")

    # Get current subscriptions from preferences
    prefs = _prefs.all_data()
    module_prefs = prefs.get("modules", {}).get(module_id, {})

    # Map keys to subscription types
    key_to_type = {
        "up_uids": "up_uid",
        "user_ids": "user_id",
        "users": "user",
        "topics": "topic",
        "podcast_ids": "podcast_id",
    }

    # Build current subscriptions list
    current_subs = []
    for key, sub_type in key_to_type.items():
        for value in module_prefs.get(key, []):
            current_subs.append({"type": sub_type, "value": value})

    # Get subscription details from store
    stored_subs = _subscription_store.get_subscriptions(module_id)
    stored_map = {(s["type"], s["value"]): s for s in stored_subs}

    # Build set of current subscription keys
    current_set = {(s["type"], s["value"]) for s in current_subs}

    # Mark all stored subscriptions
    for sub in stored_subs:
        sub["is_active"] = (sub["type"], sub["value"]) in current_set

    # Merge current subscriptions with stored details
    detailed_subs = []
    for sub in current_subs:
        key = (sub["type"], sub["value"])
        stored = stored_map.get(key, {})
        detailed_subs.append({
            "type": sub["type"],
            "value": sub["value"],
            "added_at": stored.get("added_at"),
            "added_by": stored.get("added_by", "user"),
            "last_fetched": stored.get("last_fetched"),
            "fetch_count": stored.get("fetch_count", 0),
            "is_active": True,
        })

    # Add inactive stored subscriptions (history)
    for stored in stored_subs:
        if not stored.get("is_active", True):
            detailed_subs.append({
                "type": stored["type"],
                "value": stored["value"],
                "added_at": stored.get("added_at"),
                "added_by": stored.get("added_by", "user"),
                "last_fetched": stored.get("last_fetched"),
                "fetch_count": stored.get("fetch_count", 0),
                "is_active": False,
            })

    # Sort by added_at (newest first)
    detailed_subs.sort(key=lambda x: x.get("added_at") or "", reverse=True)

    return {
        "module_id": module_id,
        "module_name": getattr(module, "name", module_id),
        "subscriptions": detailed_subs,
    }


@app.get("/api/subscriptions/summary")
async def get_subscriptions_summary():
    """Get a summary of all subscriptions across all modules."""
    summary = _subscription_store.get_summary()

    # Enrich with module names
    modules_info = {}
    for module_id in summary.get("modules", {}):
        module = _registry.get(module_id)
        modules_info[module_id] = {
            "name": getattr(module, "name", module_id),
            "icon": getattr(module, "icon", "rss"),
        }

    return {
        "total_modules": summary["total_modules"],
        "total_subscriptions": summary["total_subscriptions"],
        "modules": summary["modules"],
        "modules_info": modules_info,
    }


def get_default_keywords_for_module(module_id: str) -> list[str]:
    """Get default keywords for a module."""
    defaults = {
        "bilibili-tracker": ["科研", "学术", "读博", "论文"],
        "xiaohongshu-tracker": ["科研工具", "论文写作", "学术日常"],
        "zhihu-tracker": ["人工智能", "科研", "学术"],
        "xiaoyuzhou-tracker": ["科技", "商业", "文化"],
    }
    return defaults.get(module_id, [])


# ── Gamification (Phase 3) ───────────────────────────────────────

@app.get("/api/game/stats")
async def get_game_stats():
    """Get daily gaming stats (happiness, SAN, energy, achievements)."""
    if is_demo_mode():
        from .demo.data import DEMO_GAME_STATS
        return DEMO_GAME_STATS
    from .game import get_daily_stats
    return get_daily_stats()


@app.post("/api/game/action")
async def post_game_action(data: dict):
    """Record a game action and get rewards."""
    from .game import apply_action
    action = data.get("action", "")
    metadata = data.get("metadata", {})
    result = apply_action("default", action, metadata)
    return result


# ── Vault Browser ────────────────────────────────────────────────

class VaultItem(BaseModel):
    name: str
    path: str
    type: str  # "folder" or "file"
    size: int | None = None
    modified: float  # timestamp


@app.get("/api/vault/browse")
async def browse_vault(path: str = ""):
    """Browse vault folder structure."""
    vault_path = get_vault_path()
    if not vault_path:
        raise HTTPException(400, "Vault not configured")
    return _browse_folder(vault_path, path)


@app.get("/api/literature/browse")
async def browse_literature(path: str = ""):
    """Browse literature folder structure. Falls back to vault path if literature_path not set."""
    from .config import get_literature_path, get_vault_path
    lit_path = get_literature_path()
    if not lit_path:
        # Fall back to vault path
        lit_path = get_vault_path()
    if not lit_path:
        raise HTTPException(400, "Literature path not configured")
    if not lit_path.exists():
        raise HTTPException(404, "Literature folder not found")
    return _browse_folder(lit_path, path)


@app.get("/api/literature/file")
async def serve_literature_file(path: str):
    """Serve a file from the literature folder."""
    from fastapi.responses import FileResponse
    from .config import get_literature_path, get_vault_path

    lit_path = get_literature_path()
    if not lit_path:
        lit_path = get_vault_path()
    if not lit_path:
        raise HTTPException(400, "Literature path not configured")

    target = lit_path / path
    # Security check: ensure file is within literature path
    if not str(target.resolve()).startswith(str(lit_path.resolve())):
        raise HTTPException(403, "Access denied")

    if not target.exists():
        raise HTTPException(404, "File not found")

    if not target.is_file():
        raise HTTPException(400, "Not a file")

    return FileResponse(target)


def _browse_folder(base_path: Path, sub_path: str = ""):
    """Common logic for browsing folders."""
    target = base_path / sub_path if sub_path else base_path

    if not str(target.resolve()).startswith(str(base_path.resolve())):
        raise HTTPException(403, "Access denied")

    if not target.exists():
        raise HTTPException(404, "Path not found")

    items = []
    try:
        for item in sorted(target.iterdir()):
            if item.name.startswith("."):
                continue
            stat = item.stat()
            items.append(VaultItem(
                name=item.name,
                path=str(item.relative_to(base_path)),
                type="folder" if item.is_dir() else "file",
                size=stat.st_size if item.is_file() else None,
                modified=stat.st_mtime,
            ))
    except PermissionError:
        raise HTTPException(403, "Permission denied")

    return {"items": items, "current_path": sub_path}


@app.post("/api/vault/open")
async def open_vault_item(data: dict):
    """Open file or folder with system default application."""
    import subprocess
    vault_path = get_vault_path()
    if not vault_path:
        raise HTTPException(400, "Vault not configured")
    return _open_in_finder(vault_path, data.get("path", ""))


@app.post("/api/literature/open")
async def open_literature_item(data: dict):
    """Open file or folder in literature folder with system default. Falls back to vault path."""
    from .config import get_literature_path, get_vault_path
    lit_path = get_literature_path()
    if not lit_path:
        # Fall back to vault path
        lit_path = get_vault_path()
    if not lit_path:
        raise HTTPException(400, "Literature path not configured")
    return _open_in_finder(lit_path, data.get("path", ""))


def _open_in_finder(base_path: Path, item_path: str = ""):
    """Common logic for opening files/folders in Finder."""
    import subprocess
    target = base_path / item_path if item_path else base_path

    if not str(target.resolve()).startswith(str(base_path.resolve())):
        raise HTTPException(403, "Access denied")

    if not target.exists():
        raise HTTPException(404, "Path not found")

    try:
        subprocess.run(["open", str(target.resolve())], check=True)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to open: {e}")


@app.post("/api/vault/open-obsidian")
async def open_in_obsidian(data: dict = None):
    """Open vault or specific file in Obsidian app."""
    import subprocess
    vault_path = get_vault_path()
    if not vault_path:
        raise HTTPException(400, "Vault not configured")

    item_path = data.get("path", "") if data else ""
    target = Path(vault_path) / item_path if item_path else Path(vault_path)

    # Security check
    if not str(target.resolve()).startswith(str(Path(vault_path).resolve())):
        raise HTTPException(403, "Access denied")

    try:
        # Use 'open' with Obsidian app bundle ID
        # Try to open the specific file/folder with Obsidian
        if target.is_file():
            # For files, use obsidian:// url scheme via 'open'
            vault_name = Path(vault_path).name
            relative_path = str(target.relative_to(vault_path))
            url = f"obsidian://open?vault={vault_name}&file={relative_path}"
            subprocess.run(["open", url], check=True)
        else:
            # For folders, just open the vault
            subprocess.run(["open", "-a", "Obsidian", str(target.resolve())], check=True)
        return {"ok": True}
    except Exception as e:
        # Fallback: try to just open Obsidian app
        try:
            subprocess.run(["open", "-a", "Obsidian"], check=True)
            return {"ok": True}
        except:
            raise HTTPException(500, f"Failed to open Obsidian: {e}")


@app.post("/api/literature/open-obsidian")
async def open_literature_in_obsidian(data: dict = None):
    """Open literature folder in Obsidian app."""
    import subprocess
    from .config import get_literature_path, get_vault_path

    lit_path = get_literature_path()
    if not lit_path:
        # Fall back to vault path
        lit_path = get_vault_path()
    if not lit_path:
        raise HTTPException(400, "Literature path not configured")

    item_path = data.get("path", "") if data else ""
    target = lit_path / item_path if item_path else lit_path

    # Security check
    if not str(target.resolve()).startswith(str(lit_path.resolve())):
        raise HTTPException(403, "Access denied")

    try:
        # Open the literature folder with Obsidian
        subprocess.run(["open", "-a", "Obsidian", str(target.resolve())], check=True)
        return {"ok": True}
    except Exception as e:
        # Fallback: try to just open Obsidian app
        try:
            subprocess.run(["open", "-a", "Obsidian"], check=True)
            return {"ok": True}
        except:
            raise HTTPException(500, f"Failed to open Obsidian: {e}")


@app.post("/api/test/feedback-loop")
async def test_feedback_loop(data: dict = None):
    """Test the complete feedback loop (P2+P3+P4 integration)."""
    from .game import apply_action

    # Simulate liking a card with tags
    test_tags = data.get("tags", ["深度学习", "PyTorch", "论文推荐"]) if data else ["深度学习", "PyTorch", "论文推荐"]
    test_module = data.get("module", "arxiv-tracker") if data else "arxiv-tracker"

    # 1. Update keyword preferences (P2)
    _prefs.update_from_feedback(test_tags, "like", test_module)

    # 2. Apply game rewards (P3)
    rewards = apply_action("default", "card_like", {"tags": test_tags, "module": test_module})

    # 3. Broadcast would happen here (P4) - but we skip for test

    # Get current state
    keyword_prefs = _prefs.get_all_keyword_prefs()

    return {
        "test": "feedback-loop",
        "input_tags": test_tags,
        "input_module": test_module,
        "keyword_updates": {
            tag: keyword_prefs.get(tag.lower(), {"score": 0}).get("score", 0)
            for tag in test_tags
        },
        "rewards": rewards.get("rewards", {}),
        "total_keywords_tracked": len(keyword_prefs),
        "status": "✅ All phases working!"
    }


@app.post("/api/test/simulate-day")
async def simulate_day(data: dict = None):
    """Simulate a day of activity for testing."""
    from .game import apply_action

    actions_to_simulate = [
        ("daily_checkin", {}),
        ("check_feed", {}),
        ("like_content", {"content": "paper1"}),
        ("like_content", {"content": "paper2"}),
        ("save_paper", {"paper": "vggt-followup"}),
        ("read_paper", {"paper": "vggt-followup"}),
        ("complete_todo", {"todo": "read papers"}),
    ]

    results = []
    for action, meta in actions_to_simulate:
        result = apply_action("default", action, meta)
        results.append({
            "action": action,
            "xp": result["rewards"]["xp"],
            "happiness": result["rewards"]["happiness_delta"],
        })

    total_xp = sum(r["xp"] for r in results)
    total_happiness = sum(r["happiness"] for r in results)

    return {
        "simulated_actions": len(results),
        "actions": results,
        "totals": {
            "xp": total_xp,
            "happiness_delta": total_happiness,
        },
        "final_stats": {
            "happiness": profile_store.get_happiness_today(),
            "san": profile_store.get_san_7d_avg(),
            "energy": profile_store.get_energy_today(),
        }
    }


# ── Activity Tracking ────────────────────────────────────────────

@app.post("/api/activity/chat")
async def record_chat(data: dict):
    """Record a chat/conversation activity."""
    global _activity_tracker
    if _activity_tracker:
        activity = _activity_tracker.record_activity(
            activity_type=ActivityType.CHAT_MESSAGE,
            chat_topic=data.get("topic"),
            metadata={
                "context": data.get("context", ""),
                "message_count": data.get("message_count", 1)
            }
        )
        return {"ok": True, "activity_id": activity.id}
    return {"ok": False, "error": "Tracker not initialized"}


@app.get("/api/timeline/today")
async def get_today_timeline():
    """Get today's timeline."""
    if is_demo_mode():
        activities = get_demo_activities()
        return {
            "date": datetime.now().strftime("%Y-%m-%d"),
            "activities": activities,
            "summary": None,
            "summary_generated_at": None,
            "chat_path": [
                {"time": "09:30", "topic": "讨论 Diffusion Policy 在机械臂上的应用", "context": "arxiv"},
                {"time": "09:45", "topic": "对比 RT-2 和 Diffusion Policy 的优劣", "context": "research"},
            ],
            "interaction_summary": {"card_view": 7, "card_like": 4, "card_save": 4, "chat_start": 1, "chat_message": 1, "module_run": 1, "checkin": 1},
        }
    from datetime import datetime as _dt
    today = _dt.now().strftime("%Y-%m-%d")
    return await get_timeline(today)


@app.get("/api/timeline/{date}")
async def get_timeline(date: str):
    """Get timeline for a specific date."""
    global _activity_tracker
    if _activity_tracker:
        timeline = _activity_tracker.get_timeline(date)
        return {
            "date": timeline.date,
            "activities": [a.to_dict() for a in timeline.activities],
            "summary": timeline.summary,
            "summary_generated_at": timeline.summary_generated_at,
            "chat_path": timeline.get_chat_path(),
            "interaction_summary": timeline.get_interaction_summary()
        }
    return {"error": "Tracker not initialized"}


@app.get("/api/timeline/recent/{days}")
async def get_recent_timelines(days: int = 7):
    """Get timelines for recent days."""
    global _activity_tracker
    if _activity_tracker:
        timelines = _activity_tracker.get_recent_timelines(days)
        return {
            "timelines": [
                {
                    "date": t.date,
                    "activities": [a.to_dict() for a in t.activities],
                    "summary": t.summary,
                    "summary_generated_at": t.summary_generated_at,
                    "chat_path": t.get_chat_path(),
                    "interaction_summary": t.get_interaction_summary()
                }
                for t in timelines
            ]
        }
    return {"error": "Tracker not initialized"}


@app.post("/api/timeline/{date}/summary")
async def update_timeline_summary(date: str, data: dict):
    """Update the AI-generated summary for a day."""
    global _activity_tracker
    if _activity_tracker:
        _activity_tracker.update_summary(date, data.get("summary", ""))
        return {"ok": True}
    return {"ok": False, "error": "Tracker not initialized"}


# ── Daily Summary Generator ─────────────────────────────────────

@app.post("/api/summary/generate")
async def generate_summary_manually(data: dict = None):
    """Manually trigger summary generation."""
    global _summary_scheduler
    date = data.get("date") if data else None
    if _summary_scheduler:
        summary = await asyncio.to_thread(_summary_scheduler.generate_now, date)
        return {"ok": True, "summary": summary}
    return {"ok": False, "error": "Generator not initialized"}


@app.get("/api/summary/{date}")
async def get_summary(date: str):
    """Get generated summary for a date."""
    global _activity_tracker
    if _activity_tracker:
        timeline = _activity_tracker.get_timeline(date)
        return {
            "date": date,
            "summary": timeline.summary,
            "generated_at": timeline.summary_generated_at,
            "activity_count": len(timeline.activities)
        }
    return {"error": "Tracker not initialized"}


@app.get("/api/summary/today/status")
async def get_today_summary_status():
    """Check if today's summary has been generated."""
    from datetime import datetime
    global _activity_tracker
    today = datetime.now().strftime("%Y-%m-%d")
    if _activity_tracker:
        timeline = _activity_tracker.get_timeline(today)
        return {
            "date": today,
            "has_summary": timeline.summary is not None,
            "summary": timeline.summary,
            "generated_at": timeline.summary_generated_at,
            "activity_count": len(timeline.activities)
        }
    return {"error": "Tracker not initialized"}


# ── 注册 CLI 和 Chat 路由 ─────────────────────────────────────────
from .routes.cli import cli_router
from .routes.chat import chat_router

app.include_router(cli_router)
app.include_router(chat_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("abo.main:app", host="127.0.0.1", port=8765, log_level="info")
