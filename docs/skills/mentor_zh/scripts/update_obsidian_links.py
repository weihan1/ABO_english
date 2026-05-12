#!/usr/bin/env python3
"""
Write Obsidian-compatible cross-paper backlinks into local paper notes.

The script reads a relation manifest whose canonical lines look like:

[[Paper A]] -> [[Paper B]] : extends
[[Paper C]] <-> [[Paper D]] : same bottleneck

It then updates each discovered paper note with a managed block containing real
`[[Wiki Links]]` to related papers, so Obsidian can build actual backlinks
between notes instead of only showing a central overview note.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


MANAGED_START = "<!-- OBSIDIAN_RELATED_START -->"
MANAGED_END = "<!-- OBSIDIAN_RELATED_END -->"
DEFAULT_SECTION_TITLE = "## Obsidian Related Papers"
DEFAULT_RELATIONS_FILE = ".paper_followup_links.md"
RELATION_RE = re.compile(
    r"^\s*(?:[-*]\s*)?\[\[(?P<left>.+?)\]\]\s*(?P<arrow><->|->)\s*\[\[(?P<right>.+?)\]\]\s*(?::\s*(?P<label>.+?)\s*)?$"
)
MANAGED_BLOCK_RE = re.compile(
    rf"\n*{re.escape(MANAGED_START)}.*?{re.escape(MANAGED_END)}\n*",
    re.DOTALL,
)


@dataclass(frozen=True)
class Relation:
    source: str
    target: str
    label: str
    direction: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="Root directory containing the paper notes.")
    parser.add_argument(
        "--relations",
        help=(
            "Path to the machine-readable relation manifest. "
            f"If omitted, the script first looks for `{DEFAULT_RELATIONS_FILE}` "
            "and then falls back to `Idea整理.md`."
        ),
    )
    parser.add_argument(
        "--section-title",
        default=DEFAULT_SECTION_TITLE,
        help="Heading inserted before the managed backlink block.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and report planned note updates without writing files.",
    )
    return parser.parse_args()


def normalize_title(text: str) -> str:
    text = text.strip()
    text = re.sub(r"\s+", " ", text)
    text = text.casefold()
    text = re.sub(r"[^\w\u4e00-\u9fff]+", "", text)
    return text


def strip_alias(text: str) -> str:
    return text.split("|", 1)[0].strip()


_LEADING_DATE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*20\d{2}[._-]\d{1,2}[._-]\d{1,2}\s*[-_ ]\s*"),
    re.compile(r"^\s*20\d{2}[._-]\d{1,2}\s*[-_ ]\s*"),
    re.compile(r"^\s*20\d{2}\s*[-_ ]\s*"),
    re.compile(r"^\s*2[0-9](0[1-9]|1[0-2])\s*[-_ ]\s*"),
)


def _strip_leading_date(stem: str) -> str | None:
    for pattern in _LEADING_DATE_PATTERNS:
        match = pattern.match(stem)
        if match:
            return stem[match.end():].strip()
    return None


def detect_source_markdown(root: Path) -> Path | None:
    """Find the root-level markdown that anchors the corpus.

    Accepts either `<folder>.md` or `<date_prefix> <folder>.md`. The date-prefix
    form is now common when the user wants the source paper itself to carry a
    publication date. Both date-aware scripts in this skill use the same
    convention.
    """
    canonical = root / f"{root.name}.md"
    if canonical.is_file():
        return canonical

    name_norm = root.name.casefold()
    candidates: list[Path] = []
    try:
        for path in root.iterdir():
            if not path.is_file() or path.suffix.lower() != ".md":
                continue
            if path.name.startswith("."):
                continue
            stripped = _strip_leading_date(path.stem)
            if stripped is not None and stripped.casefold() == name_norm:
                candidates.append(path)
    except OSError:
        return None

    if not candidates:
        return None
    candidates.sort(key=lambda p: p.name.casefold())
    return candidates[0]


def choose_note_files(root: Path) -> list[Path]:
    source_note = detect_source_markdown(root)
    selected: list[Path] = []
    if source_note is not None:
        selected.append(source_note)

    for directory in sorted(path for path in root.iterdir() if path.is_dir() and not path.name.startswith(".")):
        markdown_files = sorted(
            path
            for path in directory.glob("*.md")
            if not path.name.startswith(".")
        )
        if not markdown_files:
            continue

        preferred = next((path for path in markdown_files if path.stem == directory.name), None)
        if preferred is None and any(child.suffix.lower() == ".pdf" for child in directory.iterdir()):
            preferred = markdown_files[0]
        if preferred is None:
            preferred = markdown_files[0]
        selected.append(preferred)

    deduped = list(dict.fromkeys(selected))
    return deduped


def build_title_index(note_files: list[Path]) -> tuple[dict[str, Path], dict[str, list[str]]]:
    exact: dict[str, Path] = {}
    normalized: dict[str, list[str]] = defaultdict(list)
    for path in note_files:
        title = path.stem.strip()
        exact[title] = path
        normalized[normalize_title(title)].append(title)
    return exact, normalized


def resolve_title(raw_title: str, exact: dict[str, Path], normalized: dict[str, list[str]]) -> str | None:
    title = strip_alias(raw_title)
    if title in exact:
        return title

    norm = normalize_title(title)
    candidates = normalized.get(norm, [])
    if len(candidates) == 1:
        return candidates[0]
    return None


def discover_relations_file(root: Path, explicit: str | None) -> Path:
    if explicit:
        candidate = Path(explicit).expanduser()
        if not candidate.is_absolute():
            candidate = (Path.cwd() / candidate).resolve()
        return candidate

    hidden_manifest = root / DEFAULT_RELATIONS_FILE
    if hidden_manifest.is_file():
        return hidden_manifest

    overview = root / "Idea整理.md"
    if overview.is_file():
        return overview

    raise FileNotFoundError(
        "No relation manifest found. Provide --relations or create "
        f"`{DEFAULT_RELATIONS_FILE}` under the root folder."
    )


def parse_relation_manifest(
    manifest_path: Path,
    exact: dict[str, Path],
    normalized: dict[str, list[str]],
) -> tuple[list[Relation], list[str]]:
    text = manifest_path.read_text(encoding="utf-8")
    relations: list[Relation] = []
    warnings: list[str] = []

    for lineno, line in enumerate(text.splitlines(), start=1):
        match = RELATION_RE.match(line)
        if not match:
            continue

        left_raw = match.group("left")
        right_raw = match.group("right")
        arrow = match.group("arrow")
        label = (match.group("label") or "related").strip()

        left = resolve_title(left_raw, exact, normalized)
        right = resolve_title(right_raw, exact, normalized)

        if left is None or right is None:
            unresolved = []
            if left is None:
                unresolved.append(left_raw)
            if right is None:
                unresolved.append(right_raw)
            warnings.append(
                f"{manifest_path}:{lineno}: unresolved title(s): {', '.join(unresolved)}"
            )
            continue

        if left == right:
            warnings.append(f"{manifest_path}:{lineno}: skipped self-link for `{left}`")
            continue

        if arrow == "->":
            relations.append(Relation(source=left, target=right, label=label, direction="outgoing"))
        else:
            relations.append(Relation(source=left, target=right, label=label, direction="bidirectional"))
            relations.append(Relation(source=right, target=left, label=label, direction="bidirectional"))

    return relations, warnings


def collect_note_entries(relations: list[Relation]) -> dict[str, list[tuple[str, str, str]]]:
    entries: dict[str, set[tuple[str, str, str]]] = defaultdict(set)

    for relation in relations:
        entries[relation.source].add((relation.target, relation.label, relation.direction))
        if relation.direction == "outgoing":
            entries[relation.target].add((relation.source, relation.label, "incoming"))

    return {
        title: sorted(values, key=lambda item: (item[0].casefold(), item[1].casefold(), item[2]))
        for title, values in entries.items()
    }


def render_managed_block(section_title: str, entries: list[tuple[str, str, str]]) -> str:
    lines = [section_title.strip(), MANAGED_START]
    for target, label, direction in entries:
        lines.append(f"- [[{target}]] | relation: {label} | direction: {direction}")
    lines.append(MANAGED_END)
    return "\n".join(lines).strip() + "\n"


def remove_managed_block(text: str) -> str:
    if MANAGED_START not in text:
        return text
    cleaned = MANAGED_BLOCK_RE.sub("\n\n", text).rstrip()
    return cleaned + "\n"


def upsert_managed_block(text: str, block: str | None) -> str:
    has_managed_block = MANAGED_START in text
    if not block and not has_managed_block:
        return text

    base = remove_managed_block(text).rstrip()
    if not block:
        return base + "\n"

    pdf_match = re.search(r"(?m)^##\s+PDF\b.*$", base)
    if pdf_match:
        insert_at = pdf_match.start()
        before = base[:insert_at].rstrip()
        after = base[insert_at:].lstrip("\n")
        return f"{before}\n\n{block.rstrip()}\n\n{after.rstrip()}\n"

    return f"{base}\n\n{block.rstrip()}\n"


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        print(f"Root directory does not exist: {root}", file=sys.stderr)
        return 1

    note_files = choose_note_files(root)
    if not note_files:
        print(f"No paper notes discovered under: {root}", file=sys.stderr)
        return 1

    exact, normalized = build_title_index(note_files)

    try:
        manifest_path = discover_relations_file(root, args.relations)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if not manifest_path.is_file():
        print(f"Relation manifest does not exist: {manifest_path}", file=sys.stderr)
        return 1

    relations, warnings = parse_relation_manifest(manifest_path, exact, normalized)
    if warnings:
        for warning in warnings:
            print(f"[warn] {warning}", file=sys.stderr)

    if not relations:
        print(
            "No valid relation lines were found. Add lines such as "
            "`[[Paper A]] -> [[Paper B]] : extends` to the manifest.",
            file=sys.stderr,
        )
        return 1

    note_entries = collect_note_entries(relations)

    changed = 0
    removed = 0
    touched = 0
    for title, path in exact.items():
        current_text = path.read_text(encoding="utf-8")
        entries = note_entries.get(title, [])
        block = render_managed_block(args.section_title, entries) if entries else None
        updated_text = upsert_managed_block(current_text, block)
        if updated_text == current_text:
            continue

        touched += 1
        if entries:
            changed += 1
        else:
            removed += 1

        if not args.dry_run:
            path.write_text(updated_text, encoding="utf-8")

    mode = "dry-run" if args.dry_run else "write"
    print(
        f"[{mode}] manifest={manifest_path} valid_relations={len(relations)} "
        f"notes_discovered={len(note_files)} notes_with_links={len(note_entries)} "
        f"notes_updated={changed} notes_cleared={removed} notes_touched={touched}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
