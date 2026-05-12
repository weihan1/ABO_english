import hashlib
import json
import re
from typing import Any

from abo.default_modules.arxiv.category import ALL_SUBCATEGORIES
from abo.storage_paths import get_preferences_path

_PREFS_PATH = get_preferences_path()
_DEFAULT_ARXIV_MONITOR_CATEGORIES = ["cs.*"]


def load_module_preferences(module_id: str) -> dict[str, Any]:
    if not _PREFS_PATH.exists():
        return {}
    try:
        data = json.loads(_PREFS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return dict(data.get("modules", {}).get(module_id, {}) or {})


def _stable_monitor_id(kind: str, label: str, query: str) -> str:
    digest = hashlib.sha1(f"{kind}|{label}|{query}".encode("utf-8")).hexdigest()
    return digest[:12]


def _normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw_items = re.split(r"[,\n，]+", value)
    elif isinstance(value, (list, tuple, set)):
        raw_items = list(value)
    else:
        raw_items = [value]

    normalized: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        text = str(item).strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text)
    return normalized


def split_keyword_groups(query: str) -> tuple[str, list[list[str]]]:
    raw_query = str(query or "").strip()
    if not raw_query:
        return "AND", []

    groups = [part.strip() for part in raw_query.split("|") if part.strip()]
    if len(groups) > 1:
        parsed_groups = [_normalize_string_list(group) for group in groups]
        return "AND_OR", [group for group in parsed_groups if group]

    keywords = _normalize_string_list(raw_query)
    return "AND", [keywords] if keywords else []


def normalize_keyword_monitors(config: dict[str, Any]) -> list[dict[str, Any]]:
    raw_monitors = config.get("keyword_monitors")
    fallback_keywords = _normalize_string_list(config.get("keywords"))
    monitors_source = raw_monitors if isinstance(raw_monitors, list) else fallback_keywords

    monitors: list[dict[str, Any]] = []
    for entry in monitors_source:
        advanced_raw: Any = None
        if isinstance(entry, dict):
            advanced_raw = entry.get("advanced")
            raw_query_candidate = entry.get("query") or entry.get("keywords")
            query = str(raw_query_candidate or "").strip()
            has_advanced = isinstance(advanced_raw, dict) and bool(
                advanced_raw.get("conditions") or advanced_raw.get("categories") or advanced_raw.get("date_range")
            )
            if not query and not has_advanced:
                continue
            label = str(entry.get("label") or entry.get("name") or query or "advanced").strip()
            categories = _normalize_string_list(entry.get("categories")) or list(_DEFAULT_ARXIV_MONITOR_CATEGORIES)
            enabled = bool(entry.get("enabled", True))
            id_seed = query or json.dumps(advanced_raw, sort_keys=True, ensure_ascii=False)
            monitor_id = str(entry.get("id") or _stable_monitor_id("keyword", label, id_seed))
        else:
            query = str(entry).strip()
            if not query:
                continue
            label = query
            categories = list(_DEFAULT_ARXIV_MONITOR_CATEGORIES)
            enabled = True
            monitor_id = _stable_monitor_id("keyword", label, query)

        monitor: dict[str, Any] = {
            "id": monitor_id,
            "label": label,
            "query": query,
            "categories": categories,
            "enabled": enabled,
        }

        if isinstance(advanced_raw, dict):
            # Normalize lazily here to avoid an import cycle at module load.
            from abo.tools.arxiv_api import normalize_advanced_query

            normalized_advanced = normalize_advanced_query(advanced_raw)
            if normalized_advanced:
                monitor["advanced"] = normalized_advanced

        monitors.append(monitor)

    return monitors


def normalize_followup_monitors(config: dict[str, Any]) -> list[dict[str, Any]]:
    raw_monitors = config.get("followup_monitors")
    fallback_keywords = _normalize_string_list(config.get("keywords"))
    monitors_source = raw_monitors if isinstance(raw_monitors, list) else fallback_keywords

    monitors: list[dict[str, Any]] = []
    for entry in monitors_source:
        if isinstance(entry, dict):
            query = str(entry.get("query") or entry.get("title") or entry.get("label") or "").strip()
            if not query:
                continue
            label = str(entry.get("label") or entry.get("name") or query).strip() or query
            enabled = bool(entry.get("enabled", True))
            monitor_id = str(entry.get("id") or _stable_monitor_id("followup", label, query))
        else:
            query = str(entry).strip()
            if not query:
                continue
            label = query
            enabled = True
            monitor_id = _stable_monitor_id("followup", label, query)

        monitors.append(
            {
                "id": monitor_id,
                "label": label,
                "query": query,
                "enabled": enabled,
            }
        )

    return monitors


def expand_arxiv_categories(categories: list[str] | None) -> list[str]:
    normalized = _normalize_string_list(categories)
    if not normalized:
        return []

    expanded: list[str] = []
    seen: set[str] = set()
    for category in normalized:
        if category.endswith(".*"):
            prefix = category[:-1]
            candidates = [code for code in ALL_SUBCATEGORIES if code.startswith(prefix)]
        else:
            candidates = [category]
        for candidate in candidates:
            key = candidate.casefold()
            if key in seen:
                continue
            seen.add(key)
            expanded.append(candidate)
    return expanded
