import re
from collections.abc import Mapping
from datetime import datetime
from pathlib import PurePosixPath
from typing import Any


def sanitize_paper_title_for_path(
    title: str,
    *,
    fallback: str = "untitled",
    max_length: int = 120,
) -> str:
    """Return a filesystem-safe paper title while keeping it human-readable."""
    cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", str(title or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip().strip(".")
    if not cleaned:
        cleaned = fallback
    cleaned = cleaned[:max_length].strip().strip(".")
    return cleaned or fallback


def sanitize_path_label(
    label: str,
    *,
    fallback: str = "General",
    max_length: int = 80,
) -> str:
    """Return a safe, human-readable folder label."""
    return sanitize_paper_title_for_path(label, fallback=fallback, max_length=max_length)


def _extract_paper_date_inputs(paper: Mapping[str, Any] | None) -> tuple[str, int | None]:
    if not isinstance(paper, Mapping):
        return "", None

    metadata_raw = paper.get("metadata", {})
    metadata = metadata_raw if isinstance(metadata_raw, Mapping) else {}

    published_candidates = [
        paper.get("published"),
        paper.get("publicationDate"),
        paper.get("publication_date"),
        paper.get("updated"),
        metadata.get("published"),
        metadata.get("publicationDate"),
        metadata.get("publication_date"),
        metadata.get("updated"),
    ]

    year_candidates = [
        paper.get("year"),
        metadata.get("year"),
    ]

    published = ""
    for candidate in published_candidates:
        text = str(candidate or "").strip()
        if text:
            published = text
            break

    year: int | None = None
    for candidate in year_candidates:
        try:
            if candidate not in (None, ""):
                year = int(candidate)
                break
        except (TypeError, ValueError):
            continue

    return published, year


def format_paper_date_prefix(
    paper: Mapping[str, Any] | None,
    *,
    fallback: str = "0000-00-00",
) -> str:
    """Return a stable YYYY-MM-DD prefix derived from paper metadata."""
    published, year = _extract_paper_date_inputs(paper)

    if published:
        text = published.replace("Z", "+00:00").strip()
        try:
            return datetime.fromisoformat(text).strftime("%Y-%m-%d")
        except ValueError:
            pass

        patterns: list[tuple[str, tuple[int, int, int]]] = [
            (r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", (1, 2, 3)),
            (r"^(\d{4})[-/](\d{1,2})$", (1, 2, 0)),
            (r"^(\d{4})$", (1, 0, 0)),
        ]
        for pattern, groups in patterns:
            match = re.match(pattern, text)
            if not match:
                continue
            parsed_year = int(match.group(groups[0]))
            parsed_month = int(match.group(groups[1])) if groups[1] else 1
            parsed_day = int(match.group(groups[2])) if groups[2] else 1
            try:
                return datetime(parsed_year, parsed_month, parsed_day).strftime("%Y-%m-%d")
            except ValueError:
                break

    if year and year > 0:
        return f"{year:04d}-01-01"

    return fallback


def build_dated_path_label(
    label: str,
    paper: Mapping[str, Any] | None,
    *,
    fallback: str,
    max_length: int,
) -> str:
    safe_label = sanitize_paper_title_for_path(label, fallback=fallback, max_length=max_length)
    date_prefix = format_paper_date_prefix(paper)
    return sanitize_paper_title_for_path(
        f"{date_prefix} {safe_label}",
        fallback=f"{date_prefix} {fallback}".strip(),
        max_length=max_length,
    )


def build_dated_paper_title_for_path(
    title: str,
    paper: Mapping[str, Any] | None,
    *,
    fallback: str = "untitled",
    max_length: int = 120,
) -> str:
    return build_dated_path_label(
        title,
        paper,
        fallback=fallback,
        max_length=max_length,
    )


def derive_arxiv_tracking_label(
    paper: Mapping[str, Any],
    *,
    fallback: str = "General",
    max_length: int = 80,
) -> str:
    """Pick the best available arXiv tracking label for grouped storage."""
    metadata_raw = paper.get("metadata", {}) if isinstance(paper, Mapping) else {}
    metadata = metadata_raw if isinstance(metadata_raw, Mapping) else {}

    candidates: list[str] = []

    def add_candidate(value: Any) -> None:
        text = str(value or "").strip()
        if not text or text in candidates:
            return
        candidates.append(text)

    def add_many(values: Any) -> None:
        if not isinstance(values, list):
            return
        for value in values:
            add_candidate(value)

    add_candidate(metadata.get("paper_tracking_label"))
    add_candidate(paper.get("paper_tracking_label"))
    add_candidate(metadata.get("search_label"))
    add_many(metadata.get("paper_tracking_labels"))
    add_many(paper.get("paper_tracking_labels"))

    for matches_key in ("paper_tracking_matches", "monitor_matches"):
        matches = metadata.get(matches_key)
        if not isinstance(matches, list):
            continue
        for match in matches:
            if isinstance(match, Mapping):
                add_candidate(match.get("label"))

    for keywords_key in ("query_keywords", "keywords"):
        add_many(metadata.get(keywords_key))
    add_many(paper.get("keywords"))

    primary_category = str(metadata.get("primary_category") or paper.get("primary_category") or "").strip()
    if primary_category and not candidates:
        add_candidate(primary_category)

    label = candidates[0] if candidates else fallback
    return sanitize_path_label(label, fallback=fallback, max_length=max_length)


def build_arxiv_grouped_relative_dir(
    paper: Mapping[str, Any],
    *,
    root_folder: str = "arxiv",
    tracking_fallback: str = "General",
    paper_fallback: str = "untitled",
) -> PurePosixPath:
    """Return arXiv grouped directory like arxiv/<YYYY-MM-DD tracking>/<paper-title>/."""
    title = str(paper.get("title") or "").strip()
    arxiv_id = str(
        paper.get("id")
        or paper.get("arxiv_id")
        or ((paper.get("metadata") or {}) if isinstance(paper.get("metadata"), Mapping) else {}).get("arxiv_id")
        or ((paper.get("metadata") or {}) if isinstance(paper.get("metadata"), Mapping) else {}).get("arxiv-id")
        or ""
    ).strip()
    note_name = sanitize_paper_title_for_path(
        title,
        fallback=arxiv_id or paper_fallback,
        max_length=120,
    )
    tracking_label = derive_arxiv_tracking_label(
        paper,
        fallback=tracking_fallback,
        max_length=80,
    )
    dated_tracking_label = build_dated_path_label(
        tracking_label,
        paper,
        fallback=tracking_fallback,
        max_length=100,
    )
    return PurePosixPath(root_folder) / dated_tracking_label / note_name
