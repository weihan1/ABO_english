"""Compile advanced query structures into arXiv API ``search_query`` strings.

Mirrors the expressiveness of arXiv's official advanced search:
  - multi-row conditions over named fields (ti/abs/au/co/jr/cat/id/rn/all)
  - per-row AND/OR/ANDNOT connectors with the previous row
  - exact-phrase vs. tokenized "contains" match
  - category multi-select (added as an AND-ed group)
  - optional submitted-date range expressed as the arXiv range syntax

The compiler emits the *plain* form (spaces, no URL-encoding); the
``arxiv`` Python client URL-encodes the value when it builds the request,
matching how :meth:`ArxivAPITool._build_query` is consumed today.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any, Iterable

ALLOWED_FIELDS = {"all", "ti", "abs", "au", "co", "jr", "cat", "id", "rn"}
ALLOWED_OPS = {"contains", "exact"}
ALLOWED_CONNECTORS = {"AND", "OR", "ANDNOT"}


def _tokenize(value: str) -> list[str]:
    return [tok for tok in re.split(r"\s+", value.strip()) if tok]


def _condition_fragment(field: str, op: str, value: str) -> str | None:
    field = (field or "all").strip().lower()
    if field not in ALLOWED_FIELDS:
        field = "all"

    op = (op or "contains").strip().lower()
    if op not in ALLOWED_OPS:
        op = "contains"

    value = str(value or "").strip()
    if not value:
        return None

    if op == "exact":
        phrase = value.replace('"', "").strip()
        if not phrase:
            return None
        return f'{field}:"{phrase}"'

    tokens = _tokenize(value)
    if not tokens:
        return None
    if len(tokens) == 1:
        return f"{field}:{tokens[0]}"

    parts = [f"{field}:{tok}" for tok in tokens]
    return "(" + " AND ".join(parts) + ")"


def _format_date(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    digits = re.sub(r"[^0-9]", "", text)
    if len(digits) < 8:
        return None
    return digits[:8]


def _build_date_range(date_range: dict | None) -> str | None:
    if not isinstance(date_range, dict):
        return None

    # arXiv API exposes only submittedDate range filtering. "announced"
    # callers can post-filter on `updated` if they need stricter semantics.
    field = "submittedDate"

    mode = str(date_range.get("mode", "past_days")).strip().lower()
    if mode == "past_days":
        try:
            days = int(date_range.get("past_days") or 0)
        except (TypeError, ValueError):
            days = 0
        if days <= 0:
            return None
        end = datetime.utcnow()
        start = end - timedelta(days=days)
        start_str = start.strftime("%Y%m%d") + "0000"
        end_str = end.strftime("%Y%m%d") + "2359"
    else:
        start_digits = _format_date(date_range.get("from"))
        end_digits = _format_date(date_range.get("to"))
        if not start_digits and not end_digits:
            return None
        start_str = (start_digits or "19910101") + "0000"
        end_str = (end_digits or datetime.utcnow().strftime("%Y%m%d")) + "2359"

    return f"{field}:[{start_str} TO {end_str}]"


def _categories_fragment(categories: Iterable[str] | None) -> str | None:
    if not categories:
        return None
    cats = [str(c).strip() for c in categories if str(c or "").strip()]
    if not cats:
        return None
    if len(cats) == 1:
        return f"cat:{cats[0]}"
    parts = [f"cat:{c}" for c in cats]
    return "(" + " OR ".join(parts) + ")"


def compile_advanced_query(query: dict | None) -> str:
    """Compile an advanced-query dict into an arXiv ``search_query`` string."""

    if not isinstance(query, dict):
        return "all:*"

    raw_conditions = query.get("conditions") if isinstance(query.get("conditions"), list) else []

    fragments: list[str] = []
    used_connectors = 0
    for cond in raw_conditions:
        if not isinstance(cond, dict):
            continue
        fragment = _condition_fragment(
            cond.get("field"),
            cond.get("op"),
            cond.get("value"),
        )
        if not fragment:
            continue

        if not fragments:
            fragments.append(fragment)
        else:
            connector = str(cond.get("connector", "AND")).strip().upper()
            if connector not in ALLOWED_CONNECTORS:
                connector = "AND"
            fragments.append(f" {connector} {fragment}")
            used_connectors += 1

    cond_expr = "".join(fragments).strip()

    cat_expr = _categories_fragment(query.get("categories"))
    date_expr = _build_date_range(query.get("date_range"))

    parts: list[str] = []
    if cond_expr:
        parts.append(f"({cond_expr})" if used_connectors else cond_expr)
    if cat_expr:
        parts.append(cat_expr)
    if date_expr:
        parts.append(date_expr)

    if not parts:
        return "all:*"

    return " AND ".join(parts)


def normalize_advanced_query(query: Any) -> dict | None:
    """Validate and normalize an advanced-query payload.

    Returns ``None`` when the payload has no usable conditions / filters; callers
    should fall back to legacy keyword behavior in that case.
    """

    if not isinstance(query, dict):
        return None

    raw_conditions = query.get("conditions") if isinstance(query.get("conditions"), list) else []
    conditions: list[dict] = []
    for cond in raw_conditions:
        if not isinstance(cond, dict):
            continue
        value = str(cond.get("value") or "").strip()
        if not value:
            continue
        field = str(cond.get("field") or "all").strip().lower()
        if field not in ALLOWED_FIELDS:
            field = "all"
        op = str(cond.get("op") or "contains").strip().lower()
        if op not in ALLOWED_OPS:
            op = "contains"
        connector = str(cond.get("connector") or "AND").strip().upper()
        if connector not in ALLOWED_CONNECTORS:
            connector = "AND"
        conditions.append({"field": field, "op": op, "value": value, "connector": connector})

    categories_raw = query.get("categories") if isinstance(query.get("categories"), list) else []
    categories = [str(c).strip() for c in categories_raw if str(c or "").strip()]

    date_range = query.get("date_range") if isinstance(query.get("date_range"), dict) else None

    if not conditions and not categories and not date_range:
        return None

    sort_by = str(query.get("sort_by") or "submittedDate")
    if sort_by not in {"submittedDate", "lastUpdatedDate", "relevance"}:
        sort_by = "submittedDate"
    sort_order = str(query.get("sort_order") or "descending")
    if sort_order not in {"descending", "ascending"}:
        sort_order = "descending"

    try:
        raw_max = query.get("max_results")
        max_results = int(raw_max) if raw_max not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        max_results = None

    return {
        "version": 1,
        "conditions": conditions,
        "categories": categories,
        "date_range": date_range,
        "sort_by": sort_by,
        "sort_order": sort_order,
        "max_results": max_results,
    }
