#!/usr/bin/env python3
"""
Collect abstract and introduction context from a folder of paper markdown notes.

The script prefers `ABO_DIGEST` blocks and falls back to markdown sections when the
digest is missing. If a root-level markdown file matches the folder name, it is
treated as the source paper and listed first.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


ABO_START = "<!-- ABO_DIGEST_START -->"
ABO_END = "<!-- ABO_DIGEST_END -->"
HEADING_RE = re.compile(r"^\s*(#{1,6})\s+(.*?)\s*$")

# Date hints commonly embedded in paper folder names. We try the most specific
# patterns first so e.g. `2024-03-15` does not get truncated to `2024-03`.
DATE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?<!\d)(20\d{2})[._-](\d{1,2})[._-](\d{1,2})(?!\d)"), "ymd"),
    (re.compile(r"(?<!\d)(20\d{2})[._-](\d{1,2})(?!\d)"), "ym"),
    (re.compile(r"(?<!\d)(20\d{2})(?!\d)"), "y"),
    # arXiv-style YYMM, e.g. 2403 or 2410. Constrain month to 01-12 to avoid
    # matching unrelated 4-digit numbers.
    (re.compile(r"(?<!\d)(2[0-9])(0[1-9]|1[0-2])(?!\d)"), "arxiv"),
)


@dataclass
class PaperContext:
    title: str
    path: str
    role: str
    extraction: str
    abstract: str
    introduction: str
    published_hint: str
    sort_key: str


def extract_published_hint(path_parts: Iterable[str]) -> tuple[str, str]:
    """Return (display_hint, sort_key) parsed from any path component.

    The first parseable component wins, walking from the folder closest to the
    markdown file outward. `sort_key` is YYYY-MM(-DD) with zero padding and an
    empty-string fallback so unparsed papers sort last but stay deterministic.
    """
    for part in path_parts:
        for pattern, kind in DATE_PATTERNS:
            match = pattern.search(part)
            if not match:
                continue
            if kind == "ymd":
                year, month, day = match.group(1), int(match.group(2)), int(match.group(3))
                if 1 <= month <= 12 and 1 <= day <= 31:
                    return f"{year}-{month:02d}-{day:02d}", f"{year}-{month:02d}-{day:02d}"
            elif kind == "ym":
                year, month = match.group(1), int(match.group(2))
                if 1 <= month <= 12:
                    return f"{year}-{month:02d}", f"{year}-{month:02d}"
            elif kind == "arxiv":
                year_short, month = match.group(1), int(match.group(2))
                year = f"20{year_short}"
                return f"{year}-{month:02d} (arXiv)", f"{year}-{month:02d}"
            elif kind == "y":
                year = match.group(1)
                return year, f"{year}-00"
    return "", ""


def split_frontmatter(text: str) -> tuple[str, str]:
    if not text.startswith("---"):
        return "", text

    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.DOTALL)
    if not match:
        return "", text

    return match.group(1), text[match.end() :]


def normalize_heading(text: str) -> str:
    lowered = text.strip().lower()
    lowered = lowered.replace(":", " ")
    lowered = re.sub(r"[^\w\u4e00-\u9fff\s-]", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered)
    return lowered.strip()


def clip(text: str, limit: int) -> str:
    if limit <= 0 or len(text) <= limit:
        return text.strip()
    clipped = text[:limit].rstrip()
    last_break = max(clipped.rfind("\n\n"), clipped.rfind(". "), clipped.rfind("。"))
    if last_break > max(400, int(limit * 0.55)):
        clipped = clipped[:last_break].rstrip()
    return clipped + "\n\n[Truncated]"


def clean_text(text: str) -> str:
    lines = [line.rstrip() for line in text.strip().splitlines()]
    cleaned: list[str] = []
    blank = False
    for line in lines:
        if not line.strip():
            if not blank:
                cleaned.append("")
            blank = True
            continue
        cleaned.append(line.strip())
        blank = False
    return "\n".join(cleaned).strip()


def parse_sections(markdown: str) -> list[tuple[int, str, str]]:
    sections: list[tuple[int, str, str]] = []
    current_level: int | None = None
    current_title: str | None = None
    current_lines: list[str] = []

    for line in markdown.splitlines():
        match = HEADING_RE.match(line)
        if match:
            if current_title is not None:
                sections.append((current_level or 0, current_title, clean_text("\n".join(current_lines))))
            current_level = len(match.group(1))
            current_title = match.group(2).strip()
            current_lines = []
        else:
            current_lines.append(line)

    if current_title is not None:
        sections.append((current_level or 0, current_title, clean_text("\n".join(current_lines))))

    return sections


def find_section_text(markdown: str, names: Iterable[str]) -> str:
    wanted = {normalize_heading(name) for name in names}
    for _level, title, content in parse_sections(markdown):
        if normalize_heading(title) in wanted and content:
            return content
    return ""


def extract_abo_block(body: str, full_text: str) -> str:
    for source in (body, full_text):
        start = source.rfind(ABO_START)
        if start == -1:
            continue
        end = source.find(ABO_END, start)
        if end == -1:
            continue
        block = source[start + len(ABO_START) : end]
        block = clean_text(block)
        if block:
            return block
    return ""


def extract_from_markdown(full_text: str) -> tuple[str, str, str]:
    _frontmatter, body = split_frontmatter(full_text)

    abo_block = extract_abo_block(body, full_text)
    if abo_block:
        abstract = find_section_text(abo_block, ["Abstract", "摘要", "原文摘要"])
        introduction = find_section_text(abo_block, ["Introduction", "Intro", "引言"])
        if abstract or introduction:
            return abstract, introduction, "abo-digest"

    abstract = find_section_text(body, ["原文摘要", "Abstract", "摘要", "AI 摘要"])
    introduction = find_section_text(body, ["Introduction", "Intro", "引言"])
    if abstract or introduction:
        return abstract, introduction, "markdown-sections"

    abstract = find_section_text(full_text, ["原文摘要", "Abstract", "摘要"])
    introduction = find_section_text(full_text, ["Introduction", "Intro", "引言"])
    if abstract or introduction:
        return abstract, introduction, "full-text-fallback"

    return "", "", "missing"


def detect_source_markdown(root: Path) -> Path | None:
    """Pick the root-level markdown that anchors the follow-up corpus.

    Two naming conventions are accepted:
      1. `<folder_name>.md` — the canonical form
      2. `<date_prefix> <folder_name>.md` — same name with an optional
         publication date prefix (e.g. `2025-04-21 Foo.md` for a folder named
         `Foo`). This is the convention now common when the user wants the
         source paper itself to carry a date.

    If multiple root-level markdowns match form (2), the most date-specific
    one wins; ties break alphabetically for determinism.
    """
    canonical = root / f"{root.name}.md"
    if canonical.is_file():
        return canonical

    # Fallback: any root-level markdown whose stem ends with the folder name
    # after stripping a leading date prefix.
    name_norm = root.name.casefold()
    candidates: list[tuple[str, Path]] = []
    try:
        for path in root.iterdir():
            if not path.is_file() or path.suffix.lower() != ".md":
                continue
            if path.name.startswith("."):
                continue
            stem = path.stem
            stripped = strip_leading_date(stem)
            if stripped is None:
                continue
            if stripped.casefold() == name_norm:
                _hint, sort_key = extract_published_hint([stem])
                # More specific (longer) sort_key sorts first; then alpha.
                candidates.append((f"{-len(sort_key)}|{stem.casefold()}", path))
    except OSError:
        return None

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


def strip_leading_date(stem: str) -> str | None:
    """Strip a leading date token from a filename stem.

    Returns the remaining stem (with leading separators removed) when one of
    the supported date forms is present at the start, or `None` when no date
    prefix is detected.
    """
    leading_patterns = (
        re.compile(r"^\s*20\d{2}[._-]\d{1,2}[._-]\d{1,2}\s*[-_ ]\s*"),
        re.compile(r"^\s*20\d{2}[._-]\d{1,2}\s*[-_ ]\s*"),
        re.compile(r"^\s*20\d{2}\s*[-_ ]\s*"),
        re.compile(r"^\s*2[0-9](0[1-9]|1[0-2])\s*[-_ ]\s*"),  # arXiv YYMM
    )
    for pattern in leading_patterns:
        match = pattern.match(stem)
        if match:
            return stem[match.end():].strip()
    return None


def choose_markdown_files(root: Path) -> list[Path]:
    """Pick one canonical markdown per paper folder.

    Per-folder selection rules (in priority order):
      1. The markdown whose stem equals the folder name (canonical name).
      2. The markdown whose stem ends with the folder name after a date prefix
         is stripped — common when the user prefixes paper notes with dates.
      3. If a PDF exists in the folder, the first markdown alphabetically.
      4. Otherwise, the first markdown alphabetically (no PDF requirement).

    Folders are silently dropped only when they contain no markdown at all.
    Earlier versions filtered out PDF-less folders entirely, which silently
    lost real papers when only some folders had PDFs.
    """
    source_markdown = detect_source_markdown(root)
    selected: list[Path] = []

    if source_markdown is not None:
        selected.append(source_markdown)

    # Source-level markdowns (apart from the source paper) — usually rare,
    # but include any non-source root-level md too.
    for path in sorted(root.glob("*.md"), key=lambda p: p.name.casefold()):
        if path.name.startswith("."):
            continue
        if source_markdown is not None and path == source_markdown:
            continue
        selected.append(path)

    for directory in sorted(
        (path for path in root.iterdir() if path.is_dir() and not path.name.startswith(".")),
        key=lambda p: p.name.casefold(),
    ):
        markdown_files = sorted(
            (path for path in directory.rglob("*.md")
             if not any(part.startswith(".") for part in path.relative_to(directory).parts)
             and not path.name.startswith(".")),
            key=lambda p: p.name.casefold(),
        )
        if not markdown_files:
            continue

        # Prefer canonical-name match.
        canonical = next((path for path in markdown_files if path.stem == directory.name), None)
        if canonical is not None:
            selected.append(canonical)
            continue

        # Prefer date-stripped name match.
        dir_norm = directory.name.casefold()
        date_match = next(
            (
                path for path in markdown_files
                if (stripped := strip_leading_date(path.stem)) is not None
                and stripped.casefold() == dir_norm
            ),
            None,
        )
        if date_match is not None:
            selected.append(date_match)
            continue

        # Otherwise just take the first markdown — it's almost always the
        # paper note; no PDF is required.
        selected.append(markdown_files[0])

    deduped = list(dict.fromkeys(selected))

    def _sort_key(path: Path) -> tuple:
        is_source = source_markdown is not None and path == source_markdown
        rel_parts = path.relative_to(root).parts
        # walk innermost folder outward so per-paper folder dates win over
        # year-grouping parent folders
        _, sort_key = extract_published_hint(reversed(rel_parts))
        # Source paper sorts first regardless of its date. Papers without a
        # parseable date sort after dated ones but before failures.
        date_bucket = sort_key or "9999-99"
        return (
            0 if is_source else 1,
            date_bucket,
            str(path.parent.relative_to(root)).lower(),
            path.name.lower(),
        )

    return sorted(deduped, key=_sort_key)


def build_markdown_output(root: Path, papers: list[PaperContext], skipped: list[str]) -> str:
    lines: list[str] = []
    source_paper = next((paper for paper in papers if paper.role == "source-paper"), None)
    lines.append("# Paper Follow-up Corpus")
    lines.append("")
    lines.append(f"- Root: `{root}`")
    lines.append(
        f"- Source paper: `{source_paper.title}`" if source_paper is not None else "- Source paper: `[Not detected]`"
    )
    lines.append(f"- Papers collected: {len(papers)}")
    lines.append(
        f"- Generated at: {datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')}"
    )
    lines.append("")
    lines.append("## Index (chronological where dates were detectable)")
    lines.append("")
    for idx, paper in enumerate(papers, start=1):
        date_tag = f" — {paper.published_hint}" if paper.published_hint else ""
        lines.append(f"{idx}. {paper.title} [{paper.role}]{date_tag}")
    lines.append("")
    lines.append(
        "_Date hints are parsed from folder/file names. Treat them as approximate; "
        "verify against the paper itself when chronology matters._"
    )
    lines.append("")

    for idx, paper in enumerate(papers, start=1):
        lines.append(f"## {idx}. {paper.title}")
        lines.append("")
        lines.append(f"- File: `{paper.path}`")
        lines.append(f"- Role: `{paper.role}`")
        lines.append(f"- Extraction: `{paper.extraction}`")
        if paper.published_hint:
            lines.append(f"- Published hint: `{paper.published_hint}`")
        lines.append("")
        lines.append("### Abstract")
        lines.append("")
        lines.append(paper.abstract or "[Missing]")
        lines.append("")
        lines.append("### Introduction")
        lines.append("")
        lines.append(paper.introduction or "[Missing]")
        lines.append("")

    if skipped:
        lines.append("## Skipped")
        lines.append("")
        for item in skipped:
            lines.append(f"- {item}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="Root directory containing paper folders.")
    parser.add_argument("--output", help="Optional output file path.")
    parser.add_argument(
        "--format",
        choices=("markdown", "json"),
        default="markdown",
        help="Output format.",
    )
    parser.add_argument(
        "--max-papers",
        type=int,
        default=0,
        help="Optional limit on the number of paper markdown files to collect.",
    )
    parser.add_argument(
        "--max-abstract-chars",
        type=int,
        default=0,
        help="Clip each abstract to at most this many characters. 0 means no clipping.",
    )
    parser.add_argument(
        "--max-intro-chars",
        type=int,
        default=0,
        help="Clip each introduction to at most this many characters. 0 means no clipping.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()

    if not root.exists():
        print(f"[ERROR] Root does not exist: {root}", file=sys.stderr)
        return 1
    if not root.is_dir():
        print(f"[ERROR] Root is not a directory: {root}", file=sys.stderr)
        return 1

    source_markdown = detect_source_markdown(root)
    markdown_files = choose_markdown_files(root)
    if args.max_papers > 0:
        markdown_files = markdown_files[: args.max_papers]

    papers: list[PaperContext] = []
    skipped: list[str] = []

    for md_path in markdown_files:
        try:
            text = md_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = md_path.read_text(encoding="utf-8", errors="ignore")
        except OSError as exc:
            skipped.append(f"{md_path}: read error ({exc})")
            continue

        abstract, introduction, extraction = extract_from_markdown(text)
        abstract = clip(abstract, args.max_abstract_chars)
        introduction = clip(introduction, args.max_intro_chars)

        if not abstract and not introduction:
            skipped.append(f"{md_path}: no digest, abstract, or introduction found")
            continue

        rel_parts = md_path.relative_to(root).parts
        published_hint, sort_key = extract_published_hint(reversed(rel_parts))

        papers.append(
            PaperContext(
                title=md_path.stem,
                path=str(md_path.relative_to(root)),
                role="source-paper" if source_markdown is not None and md_path == source_markdown else "follow-up",
                extraction=extraction,
                abstract=abstract,
                introduction=introduction,
                published_hint=published_hint,
                sort_key=sort_key,
            )
        )

    if args.format == "json":
        output = json.dumps(
            {
                "root": str(root),
                "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
                "papers": [asdict(paper) for paper in papers],
                "skipped": skipped,
            },
            ensure_ascii=False,
            indent=2,
        )
    else:
        output = build_markdown_output(root, papers, skipped)

    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
