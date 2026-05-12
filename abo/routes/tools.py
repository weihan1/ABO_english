"""工具 API 路由"""

import json
import os
import asyncio
import re
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel
from typing import Optional

from abo.tools.xiaohongshu import (
    xiaohongshu_analyze_trends,
    xiaohongshu_fetch_comments,
    xiaohongshu_verify_cookie,
)
from abo.tools.xhs_crawler import (
    analyze_saved_xhs_authors,
    crawl_xhs_albums_incremental,
    crawl_xhs_note_to_vault,
    list_xhs_album_previews,
    save_xhs_seed_note_to_vault,
)
from abo.tools.xhs_runtime import (
    fetch_xhs_keyword_search_result,
    fetch_xhs_creator_recent_result,
    fetch_xhs_following_feed_result,
)
from abo.tools.xhs_task_queue import xhs_serial_task
from abo.tools.bilibili import (
    BilibiliToolAPI,
    bilibili_fetch_dynamics_by_urls,
    bilibili_fetch_followed,
    bilibili_fetch_followed_ups,
    bilibili_verify_sessdata,
)
from abo.tools.bilibili_crawler import (
    analyze_saved_bilibili_favorites,
    crawl_selected_favorites_to_vault,
    crawl_bilibili_to_vault,
    export_bilibili_cookies_auto,
    fetch_favorite_folder_previews,
    resolve_cookie_header,
    save_selected_dynamics_to_vault,
    verify_cookie_header,
)
from abo.tools.zhihu import (
    zhihu_search,
    zhihu_analyze_trends,
    zhihu_fetch_comments,
)
from abo.creator_smart_groups import (
    assign_dynamic_smart_groups,
    build_smart_group_value,
    extract_signal_tokens,
    is_generic_group_signal,
    match_smart_groups_from_content_tags,
    merge_shared_group_options,
    merge_creator_profiles,
    normalize_creator_name_key,
    normalize_group_signal_key,
    sync_shared_creator_group_options,
    unique_strings,
)
from abo.paper_paths import build_arxiv_grouped_relative_dir
from abo.tools.arxiv_api import arxiv_api_search
from abo.vault.tag_index import (
    build_vault_signal_database,
    load_vault_shared_creator_profiles,
    load_vault_shared_groups,
    save_vault_shared_group_artifacts,
    save_vault_signal_database,
)
from abo.vault.unified_entry import UnifiedVaultEntry
from abo.config import get_abo_dir
from abo.store.papers import PaperStore

router = APIRouter(prefix="/api/tools", tags=["tools"])
_XHS_ALBUM_TASKS: dict[str, dict] = {}
_XHS_ALBUM_ASYNC_TASKS: dict[str, asyncio.Task] = {}
_XHS_TASKS: dict[str, dict] = {}
_XHS_ASYNC_TASKS: dict[str, asyncio.Task] = {}
_BILIBILI_TASKS: dict[str, dict] = {}
_BILIBILI_ASYNC_TASKS: dict[str, asyncio.Task] = {}
_XHS_TASKS_PATH = get_abo_dir() / "xhs_tasks.json"
_paper_store = PaperStore()
_BILIBILI_TASK_HEARTBEAT_TIMEOUT_SECONDS = 20
_BILIBILI_TASK_WATCHDOG_INTERVAL_SECONDS = 2.0
_BILIBILI_TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}
_SHARED_CREATOR_LOOKUP_KEYS = (
    "xiaohongshu_author_ids",
    "bilibili_author_ids",
    "bilibili_oids",
)
_SIGNAL_PREFIXES = (
    "来自收藏专辑：",
    "来自收藏夹：",
    "来自标签：",
    "来自收藏笔记：",
    "来自收藏视频：",
    "来自稍后再看：",
    "来自动态：",
    "来自本地收藏：",
)


def _split_signal_tokens(*values: object) -> list[str]:
    return extract_signal_tokens(*values)


_RULE_BASED_SHARED_GROUPS: dict[str, tuple[str, ...]] = {
    "AI / 大模型": (
        "ai",
        "人工智能",
        "大模型",
        "agent",
        "claude",
        "chatgpt",
        "gpt",
        "openai",
        "gemini",
        "mcp",
        "rag",
        "vibecoding",
        "prompt",
        "智谱",
        "openclaw",
        "llm",
        "vlm",
        "多模态大模型",
    ),
    "AI工具": (
        "ai工具",
        "skill",
        "skills",
        "claudecode",
        "claudecode",
        "vibecoding",
        "workflow",
        "插件",
        "app",
        "软件分享",
    ),
    "知识管理 / Obsidian": (
        "obsidian",
        "知识库",
        "双链",
        "卡片笔记",
        "读书笔记",
        "微信读书",
        "笔记系统",
        "第二大脑",
        "本地知识库",
    ),
    "阅读 / 学习": (
        "阅读",
        "学习",
        "读书",
        "书单",
        "认知",
        "学习方法",
        "文献阅读",
        "英文阅读",
    ),
    "编程 / 求职成长": (
        "程序员",
        "实习",
        "求职",
        "转码",
        "计算机",
        "互联网大厂",
        "校招",
        "面试",
        "技术",
        "刷题",
        "工程师",
        "算法工程师",
        "职场",
    ),
    "科研 / 学术": (
        "科研",
        "学术",
        "论文",
        "顶会",
        "neurips",
        "iclr",
        "cvpr",
        "siggraph",
        "文献",
        "research",
    ),
    "研究生 / 博士": (
        "phd",
        "博士",
        "读博",
        "博士生",
        "研究生",
        "读研",
        "博一",
        "博二",
        "博三",
        "博四",
    ),
    "申博 / 留学": (
        "留学",
        "申博",
        "博士申请",
        "phd申请",
        "联系导师",
        "导师",
        "保研",
        "美签",
        "签证",
        "26fall",
        "留学生",
        "mit",
        "cmu",
    ),
    "具身智能 / 机器人": (
        "具身智能",
        "机器人",
        "vla",
    ),
    "内容创作 / 自媒体": (
        "自媒体",
        "内容创作",
        "短视频",
        "博主",
        "创作",
        "创作者",
        "vlog",
        "plog",
        "写作",
    ),
    "运动 / 健身": (
        "健身",
        "运动",
        "体育",
        "康复",
        "训练",
        "体态",
        "滑雪",
        "骑行",
        "跑步",
    ),
    "变美 / 穿搭": (
        "变美",
        "穿搭",
        "妆容",
        "发型",
        "氛围感",
        "护肤",
        "大小脸",
        "长发",
        "护发",
        "上镜",
        "眼神",
        "面部提升",
    ),
    "情绪 / 成长": (
        "人生",
        "时间",
        "生命",
        "疗愈",
        "成长",
        "情绪",
        "恋爱",
        "暗恋",
        "自我觉察",
        "亲密关系",
        "心理学",
        "心理健康",
        "自由",
        "责任",
        "哲学",
    ),
    "影视 / 播客 / 音乐": (
        "电影",
        "港片",
        "影评",
        "播客",
        "配乐",
        "说影",
        "慢谈",
        "音乐",
        "电音",
        "beatbox",
        "声乐",
        "巡演",
    ),
    "旅行 / 攻略": (
        "旅游",
        "旅行",
        "攻略",
        "穷游",
        "城市漫游",
        "转机",
        "回国",
        "日本旅行",
        "美国旅行",
    ),
    "摄影 / 旅行": (
        "摄影",
        "拍照",
        "相机",
        "拍立得",
        "镜头",
        "拍摄",
        "光线",
        "旅拍",
    ),
    "财经 / 投资": (
        "金融",
        "投行",
        "股市",
        "投资",
        "理财",
        "财务自由",
        "财富",
    ),
    "创业 / 商业": (
        "创业",
        "商业",
        "商业分析",
        "商业思维",
        "产品经理",
        "产品设计",
        "市场营销",
    ),
    "驾驶 / 考证": (
        "学车",
        "考驾照",
        "科目二",
        "科目三",
        "驾校",
        "驾驶",
    ),
    "健康 / 医学科普": (
        "健康",
        "医学",
        "科普",
        "细菌",
        "病毒",
        "疤痕",
        "皮肤科",
        "adhd",
        "护眼",
        "视力",
        "医保",
        "过敏",
    ),
    "宠物 / 萌宠": (
        "宠物",
        "小狗",
        "狗狗",
        "边牧",
        "柯基",
        "猫咪",
        "小猫",
        "缅因猫",
        "奶牛猫",
    ),
    "家居 / 装修": (
        "装修",
        "装修干货",
        "装修必备",
        "家居",
        "家电",
        "冰箱",
        "厨房",
        "租房",
        "隔音",
    ),
    "美食 / 咖啡": (
        "美食",
        "咖啡",
        "奶茶",
        "牛排",
        "做饭",
        "做菜",
        "料理",
        "烘焙",
        "古茗",
    ),
    "语言 / 英语": (
        "英语",
        "口语",
        "学英语",
        "地道英语",
        "英语表达",
        "learnchinese",
        "西语",
        "语言",
    ),
}

_PLACEHOLDER_GROUP_LABELS = {
    "待补标签",
    "低信息标签",
    "其他",
    "待细化",
    "杂项",
    "综合",
}
_GROUP_LABEL_ALIASES = {
    "读研 / 读博": "研究生 / 博士",
    "读博 / 读研": "研究生 / 博士",
    "硕博 / 留学申请": "研究生 / 博士",
    "留学 / 博士申请": "申博 / 留学",
    "留学 / 申博": "申博 / 留学",
    "博士申请 / 留学": "申博 / 留学",
    "商业 / 创业": "创业 / 商业",
    "健康 / 科普": "健康 / 医学科普",
    "医学 / 健康": "健康 / 医学科普",
    "自媒体 / 内容创作": "内容创作 / 自媒体",
    "内容创作": "内容创作 / 自媒体",
    "英语 / 语言": "语言 / 英语",
    "语言 / 外语": "语言 / 英语",
    "家居 / 生活": "家居 / 装修",
    "装修 / 家居": "家居 / 装修",
    "美食 / 烹饪": "美食 / 咖啡",
    "宠物": "宠物 / 萌宠",
    "萌宠": "宠物 / 萌宠",
    "读博日常 / 研究生": "研究生 / 博士",
    "留学申请 / 申博": "申博 / 留学",
}


def _match_rule_based_group_label(raw_signal: object) -> str:
    normalized_signal = normalize_group_signal_key(raw_signal)
    if not normalized_signal:
        return ""

    for label, keywords in _RULE_BASED_SHARED_GROUPS.items():
        if any(
            keyword_key
            and (
                keyword_key == normalized_signal
                or keyword_key in normalized_signal
                or normalized_signal in keyword_key
            )
            for keyword_key in (normalize_group_signal_key(keyword) for keyword in keywords)
        ):
            return label
    return ""


def _normalize_generated_group_label(raw_label: object) -> str:
    label = re.sub(r"\s+", " ", str(raw_label or "").strip())[:48]
    if not label:
        return ""
    label = _GROUP_LABEL_ALIASES.get(label, label)
    if label in _PLACEHOLDER_GROUP_LABELS:
        return ""
    if is_generic_group_signal(label):
        return ""
    return label


def _normalize_signal_group_label_values(raw_label: object, *, signal_key: str = "") -> list[str]:
    labels = raw_label if isinstance(raw_label, (list, tuple, set)) else [raw_label]
    normalized_labels: list[str] = []
    for item in labels:
        label = str(item or "").strip()
        if label == "硕博 / 留学申请":
            if any(
                keyword in signal_key
                for keyword in (
                    "留学",
                    "申请",
                    "导师",
                    "签证",
                    "fall",
                    "剑桥",
                    "gap",
                    "保研",
                )
            ):
                label = "申博 / 留学"
            else:
                label = "研究生 / 博士"
        label = _normalize_generated_group_label(label)
        if label:
            normalized_labels.append(label)
    return unique_strings(normalized_labels, limit=4)


def _normalize_signal_group_labels(signal_group_labels: dict[str, object] | None) -> dict[str, list[str]]:
    normalized: dict[str, list[str]] = {}
    for raw_signal, raw_label in dict(signal_group_labels or {}).items():
        signal = str(raw_signal or "").strip()
        signal_key = normalize_group_signal_key(signal)
        labels = _normalize_signal_group_label_values(raw_label, signal_key=signal_key)
        if signal and labels:
            normalized[signal] = labels
    return normalized


def _guess_context_group_labels(*values: object) -> list[str]:
    normalized_texts = [
        normalize_group_signal_key(value)
        for value in values
        if str(value or "").strip()
    ]
    labels: list[str] = []
    if not normalized_texts:
        return labels

    for raw_label, keywords in _RULE_BASED_SHARED_GROUPS.items():
        label = _normalize_generated_group_label(raw_label) or str(raw_label).strip()
        if not label:
            continue
        for keyword in keywords:
            keyword_key = normalize_group_signal_key(keyword)
            if not keyword_key:
                continue
            matched = any(
                text == keyword_key or (len(keyword_key) >= 2 and keyword_key in text)
                for text in normalized_texts
            )
            if matched:
                labels.append(label)
                break
    return unique_strings(labels, limit=2)


def _build_rule_based_signal_group_labels(
    entries: list[dict],
    vault_signal_database: dict | None = None,
) -> dict[str, str]:
    mapping: dict[str, str] = {}

    for entry in entries:
        for signal, _weight in Counter(entry.get("signal_weights") or {}).most_common(12):
            raw_signal = str(signal or "").strip()
            if not raw_signal or is_generic_group_signal(raw_signal):
                continue
            label = _match_rule_based_group_label(raw_signal)
            if label:
                mapping[raw_signal] = label

    for item in (vault_signal_database or {}).get("signals") or []:
        raw_signal = str(item.get("signal") or "").strip()
        if not raw_signal or is_generic_group_signal(raw_signal):
            continue
        label = _match_rule_based_group_label(raw_signal)
        if label:
            mapping[raw_signal] = label

    return mapping


def _build_vault_seed_group_options(
    vault_signal_database: dict | None,
    signal_group_labels: dict[str, object] | None,
) -> list[dict]:
    if not vault_signal_database or not signal_group_labels:
        return []

    grouped: dict[str, dict] = {}
    normalized_group_labels = {
        normalize_group_signal_key(signal): _normalize_signal_group_label_values(
            label,
            signal_key=normalize_group_signal_key(signal),
        )
        for signal, label in dict(signal_group_labels or {}).items()
        if str(signal or "").strip()
    }

    for item in (vault_signal_database.get("signals") or []):
        raw_signal = str(item.get("signal") or "").strip()
        if not raw_signal or is_generic_group_signal(raw_signal):
            continue

        labels = normalized_group_labels.get(normalize_group_signal_key(raw_signal)) or []
        if not labels:
            continue

        for label in labels:
            entry = grouped.setdefault(
                label,
                {
                    "value": build_smart_group_value(label),
                    "label": label,
                    "count": 0,
                    "sample_authors": [],
                    "sample_tags": [],
                    "source_signals": [],
                    "platforms": [],
                },
            )
            entry["count"] = int(entry.get("count") or 0) + int(item.get("count") or 0)
            entry["sample_authors"] = unique_strings(
                [
                    *(entry.get("sample_authors") or []),
                    *(item.get("sample_authors") or []),
                ],
                limit=4,
            )
            entry["sample_tags"] = unique_strings(
                [*(entry.get("sample_tags") or []), raw_signal],
                limit=8,
            )
            entry["source_signals"] = unique_strings(
                [*(entry.get("source_signals") or []), raw_signal],
                limit=12,
            )
            entry["platforms"] = unique_strings(
                [*(entry.get("platforms") or []), *(item.get("platforms") or [])],
                limit=6,
            )

    return list(grouped.values())


def _top_entry_signals(entry: dict, limit: int = 6) -> list[str]:
    return [
        signal
        for signal, _weight in Counter(entry.get("signal_weights") or {}).most_common(limit)
        if not is_generic_group_signal(signal)
    ]


def _empty_shared_creator_lookup() -> dict[str, dict[str, str]]:
    return {key: {} for key in _SHARED_CREATOR_LOOKUP_KEYS}


def _merge_shared_creator_lookup_maps(*lookup_maps: dict | None) -> dict[str, dict[str, str]]:
    merged = _empty_shared_creator_lookup()
    for lookup in lookup_maps:
        if not isinstance(lookup, dict):
            continue
        for key in _SHARED_CREATOR_LOOKUP_KEYS:
            raw_map = lookup.get(key) or {}
            if not isinstance(raw_map, dict):
                continue
            for raw_key, raw_value in raw_map.items():
                map_key = str(raw_key or "").strip()
                map_value = str(raw_value or "").strip()
                if map_key and map_value:
                    merged[key][map_key] = map_value
    return merged


def _build_shared_creator_lookup(prefs: dict) -> dict[str, dict[str, str]]:
    snapshot = dict((prefs.get("shared_creator_grouping", {}) or {}).get("creator_lookup") or {})
    merged = _merge_shared_creator_lookup_maps(snapshot)
    modules = prefs.get("modules", {}) or {}
    xhs_profiles = dict((modules.get("xiaohongshu-tracker") or {}).get("creator_profiles") or {})
    bilibili_profiles = dict((modules.get("bilibili-tracker") or {}).get("creator_profiles") or {})
    creator_catalog = dict((prefs.get("shared_creator_grouping", {}) or {}).get("creator_catalog") or {})

    def register_creator(
        *,
        platform: str,
        author_id: object,
        author_names: list[object] | tuple[object, ...] | None,
        sample_oids: list[object] | tuple[object, ...] | None = None,
    ) -> None:
        creator_id = str(author_id or "").strip()
        if not creator_id:
            return

        if platform == "xiaohongshu":
            for name in unique_strings(author_names or [], limit=6):
                normalized_name = normalize_creator_name_key(name)
                if normalized_name:
                    merged["xiaohongshu_author_ids"][normalized_name] = creator_id
            return

        if platform != "bilibili":
            return

        for name in unique_strings(author_names or [], limit=6):
            normalized_name = normalize_creator_name_key(name)
            if normalized_name:
                merged["bilibili_author_ids"][normalized_name] = creator_id
        for oid in unique_strings(sample_oids or [], limit=12):
            normalized_oid = str(oid or "").strip()
            if normalized_oid:
                merged["bilibili_oids"][normalized_oid] = creator_id

    for author_id, profile in xhs_profiles.items():
        register_creator(
            platform="xiaohongshu",
            author_id=profile.get("author_id") or author_id,
            author_names=[profile.get("author")],
        )

    for author_id, profile in bilibili_profiles.items():
        register_creator(
            platform="bilibili",
            author_id=profile.get("author_id") or author_id,
            author_names=[
                profile.get("author"),
                profile.get("matched_author"),
            ],
            sample_oids=profile.get("sample_oids") or [],
        )

    for item in creator_catalog.values():
        platform = str(item.get("platform") or "").strip()
        register_creator(
            platform=platform,
            author_id=item.get("author_id"),
            author_names=[
                item.get("author"),
                item.get("matched_author"),
                *(item.get("author_names") or []),
            ],
            sample_oids=item.get("sample_oids") or [],
        )

    return merged


def _apply_shared_lookup_to_xhs_authors(
    authors: list[dict],
    creator_lookup: dict[str, dict[str, str]],
) -> tuple[list[dict], int]:
    resolved_authors: list[dict] = []
    resolved_count = 0

    for item in authors or []:
        next_item = dict(item or {})
        author_id = str(next_item.get("author_id") or "").strip()
        if not author_id:
            normalized_name = normalize_creator_name_key(next_item.get("author"))
            matched_author_id = (creator_lookup.get("xiaohongshu_author_ids") or {}).get(normalized_name) or ""
            if matched_author_id:
                next_item["author_id"] = matched_author_id
                next_item["lookup_source"] = "shared-author-lookup"
                resolved_count += 1
        resolved_authors.append(next_item)

    return resolved_authors, resolved_count


def _apply_shared_lookup_to_bilibili_candidates(
    candidates: list[dict],
    creator_lookup: dict[str, dict[str, str]],
) -> tuple[list[dict], int]:
    resolved_candidates: list[dict] = []
    resolved_count = 0

    for item in candidates or []:
        next_item = dict(item or {})
        author_id = str(next_item.get("matched_mid") or next_item.get("author_id") or "").strip()
        lookup_source = ""
        if not author_id:
            for oid in unique_strings(next_item.get("sample_oids") or [], limit=8):
                matched_author_id = (creator_lookup.get("bilibili_oids") or {}).get(str(oid).strip()) or ""
                if matched_author_id:
                    author_id = matched_author_id
                    lookup_source = "shared-oid-lookup"
                    break

        if not author_id:
            for name in [
                next_item.get("matched_uname"),
                next_item.get("author"),
            ]:
                normalized_name = normalize_creator_name_key(name)
                matched_author_id = (creator_lookup.get("bilibili_author_ids") or {}).get(normalized_name) or ""
                if matched_author_id:
                    author_id = matched_author_id
                    lookup_source = "shared-author-lookup"
                    break

        if author_id and not str(next_item.get("author_id") or "").strip():
            next_item["author_id"] = author_id
        if author_id and not str(next_item.get("matched_mid") or "").strip():
            next_item["matched_mid"] = author_id
        if lookup_source:
            next_item["lookup_source"] = lookup_source
            resolved_count += 1

        resolved_candidates.append(next_item)

    return resolved_candidates, resolved_count


_CREATOR_SEED_LIST_LIMITS = {
    "sample_titles": 6,
    "sample_tags": 16,
    "sample_folders": 6,
    "sample_albums": 6,
    "sample_urls": 6,
    "sample_note_urls": 6,
    "sample_oids": 8,
}


def _creator_seed_key(platform: str, item: dict) -> str:
    author_id = str(item.get("author_id") or item.get("matched_mid") or "").strip()
    if author_id:
        return author_id

    author_name = (
        str(
            item.get("matched_author")
            or item.get("matched_uname")
            or item.get("author")
            or item.get("display_name")
            or ""
        ).strip()
    )
    normalized_name = normalize_creator_name_key(author_name)
    return f"pending:{platform}:{normalized_name or author_name or 'unknown'}"


def _merge_creator_seed(existing: dict | None, incoming: dict | None) -> dict:
    current = dict(existing or {})
    payload = dict(incoming or {})
    merged = {**current, **payload}

    for key, limit in _CREATOR_SEED_LIST_LIMITS.items():
        merged[key] = unique_strings(
            [*(current.get(key) or []), *(payload.get(key) or [])],
            limit=limit,
        )

    for key in (
        "note_count",
        "favorite_note_count",
        "total_likes",
        "total_collects",
        "total_comments",
        "score",
    ):
        existing_value = current.get(key)
        incoming_value = payload.get(key)
        if isinstance(existing_value, (int, float)) or isinstance(incoming_value, (int, float)):
            merged[key] = max(
                float(existing_value) if isinstance(existing_value, (int, float)) else 0,
                float(incoming_value) if isinstance(incoming_value, (int, float)) else 0,
            )
            if isinstance(existing_value, int) or isinstance(incoming_value, int):
                merged[key] = int(merged[key])

    for key in ("author", "author_id", "matched_author", "source_summary", "grouping_source"):
        current_text = str(current.get(key) or "").strip()
        incoming_text = str(payload.get(key) or "").strip()
        merged[key] = incoming_text or current_text

    return merged


def _upsert_creator_seed(seed_map: dict[str, dict], platform: str, item: dict) -> str:
    payload = dict(item or {})
    author_name = str(
        payload.get("matched_author")
        or payload.get("matched_uname")
        or payload.get("author")
        or payload.get("display_name")
        or ""
    ).strip()
    normalized_name = normalize_creator_name_key(author_name)
    pending_key = f"pending:{platform}:{normalized_name or author_name or 'unknown'}"
    resolved_key = _creator_seed_key(platform, payload)

    if resolved_key != pending_key and pending_key in seed_map:
        payload = _merge_creator_seed(seed_map.pop(pending_key), payload)

    seed_map[resolved_key] = _merge_creator_seed(seed_map.get(resolved_key), payload)
    return resolved_key


def _build_xhs_seed_map(prefs: dict, authors: list[dict]) -> dict[str, dict]:
    seed_map: dict[str, dict] = {}

    existing_profiles = dict(
        (((prefs.get("modules") or {}).get("xiaohongshu-tracker") or {}).get("creator_profiles") or {})
    )
    for profile_key, profile in existing_profiles.items():
        author_id = str(profile.get("author_id") or "").strip()
        _upsert_creator_seed(
            seed_map,
            "xiaohongshu",
            {
                "author": profile.get("author") or profile_key,
                "author_id": author_id,
                "note_count": int(profile.get("note_count") or 0),
                "sample_titles": profile.get("sample_titles") or [],
                "sample_tags": profile.get("sample_tags") or [],
                "sample_note_urls": profile.get("sample_note_urls") or [],
                "source_summary": profile.get("source_summary") or "",
                "grouping_source": "xiaohongshu-profile-cache",
            },
        )

    for item in authors or []:
        _upsert_creator_seed(seed_map, "xiaohongshu", item)

    return seed_map


def _build_bilibili_seed_map(prefs: dict, candidates: list[dict]) -> dict[str, dict]:
    seed_map: dict[str, dict] = {}

    existing_profiles = dict(
        (((prefs.get("modules") or {}).get("bilibili-tracker") or {}).get("creator_profiles") or {})
    )
    for profile_key, profile in existing_profiles.items():
        author_id = str(profile.get("author_id") or "").strip()
        _upsert_creator_seed(
            seed_map,
            "bilibili",
            {
                "author": profile.get("author") or profile.get("matched_author") or profile_key,
                "author_id": author_id,
                "matched_author": profile.get("matched_author") or profile.get("author") or profile_key,
                "favorite_note_count": int(profile.get("favorite_note_count") or 0),
                "sample_titles": profile.get("sample_titles") or [],
                "sample_tags": profile.get("sample_tags") or [],
                "sample_folders": profile.get("sample_folders") or [],
                "sample_oids": profile.get("sample_oids") or [],
                "sample_urls": profile.get("sample_urls") or [],
                "source_summary": profile.get("source_summary") or "",
                "grouping_source": "bilibili-profile-cache",
            },
        )

    for item in candidates or []:
        _upsert_creator_seed(seed_map, "bilibili", item)

    return seed_map


def _build_recent_source_summary(prefix: str, tags: list[str], titles: list[str], count: int) -> str:
    if tags:
        return f"{prefix}：" + "、".join(tags[:4])
    if titles:
        return f"{prefix}：" + "、".join(titles[:2])
    return f"{prefix} {count} 条"


def _empty_recent_fetch_summary(*, skipped_reason: str | None = None) -> dict[str, int | str]:
    summary: dict[str, int | str] = {
        "followed_total": 0,
        "recent_fetched_count": 0,
        "recent_failed_count": 0,
        "seeded_creator_count": 0,
    }
    if skipped_reason:
        summary["skipped_reason"] = skipped_reason
    return summary


def _map_progress_percent(raw_progress: object, start: int, end: int) -> int:
    start_value = int(start)
    end_value = int(end)
    if end_value <= start_value:
        return end_value
    try:
        normalized = int(raw_progress or 0)
    except Exception:
        normalized = 0
    normalized = max(0, min(100, normalized))
    span = end_value - start_value
    return start_value + int(round(span * (normalized / 100)))


async def _augment_bilibili_seeds_with_followed_recent(
    seed_map: dict[str, dict],
    *,
    sessdata: str | None,
    followed_ups: list[dict] | None = None,
    max_count: int = 5000,
    progress_callback=None,
) -> dict[str, int | str]:
    summary: dict[str, int | str] = {
        "followed_total": 0,
        "recent_fetched_count": 0,
        "recent_failed_count": 0,
        "seeded_creator_count": 0,
    }
    if not sessdata:
        return summary

    api = BilibiliToolAPI(sessdata=sessdata)
    try:
        up_list = list(followed_ups or [])
        if not up_list:
            fetched = await api.fetch_followed_ups(max_count=max_count)
            up_list = [
                {
                    "mid": up.mid,
                    "uname": up.uname,
                    "tag_ids": up.tag_ids,
                }
                for up in fetched
            ]

        summary["followed_total"] = len(up_list)
        total_followed = len(up_list)
        if progress_callback and total_followed > 0:
            progress_callback(
                {
                    "stage": f"正在补充全部 UP 最近内容 0/{total_followed}",
                    "progress": 0,
                    "total_followed_count": total_followed,
                    "processed_followed_count": 0,
                    "current_followed_name": "",
                    "recent_fetched_count": 0,
                }
            )

        for index, up in enumerate(up_list, start=1):
            up_id = str(up.get("mid") or "").strip()
            up_name = str(up.get("uname") or "").strip()
            if up_id and up_name:
                before_keys = set(seed_map)
                resolved_key = _upsert_creator_seed(
                    seed_map,
                    "bilibili",
                    {
                        "author": up_name,
                        "author_id": up_id,
                        "matched_author": up_name,
                        "grouping_source": "bilibili-following",
                    },
                )
                if resolved_key not in before_keys:
                    summary["seeded_creator_count"] = int(summary["seeded_creator_count"]) + 1

                current = dict(seed_map.get(resolved_key) or {})
                if len(current.get("sample_tags") or []) < 2:
                    try:
                        videos = await api.fetch_up_recent_videos(up_id, limit=3)
                    except Exception:
                        summary["recent_failed_count"] = int(summary["recent_failed_count"]) + 1
                    else:
                        tags = unique_strings(
                            [
                                tag
                                for video in videos
                                for tag in (video.get("tags") or [])
                                if str(tag or "").strip() and not is_generic_group_signal(tag)
                            ],
                            limit=16,
                        )
                        titles = unique_strings([video.get("title") for video in videos], limit=6)
                        urls = unique_strings([video.get("url") for video in videos], limit=6)
                        if tags or titles or urls:
                            summary["recent_fetched_count"] = int(summary["recent_fetched_count"]) + 1
                            _upsert_creator_seed(
                                seed_map,
                                "bilibili",
                                {
                                    "author": up_name,
                                    "author_id": up_id,
                                    "matched_author": up_name,
                                    "sample_tags": tags,
                                    "sample_titles": titles,
                                    "sample_urls": urls,
                                    "source_summary": _build_recent_source_summary("来自关注UP最近内容", tags, titles, len(videos)),
                                    "grouping_source": "bilibili-following-recent",
                                },
                            )
            if progress_callback:
                progress_callback(
                    {
                        "stage": f"正在补充全部 UP 最近内容 {index}/{total_followed} · {up_name}",
                        "progress": int(index / max(total_followed, 1) * 100),
                        "total_followed_count": total_followed,
                        "processed_followed_count": index,
                        "current_followed_name": up_name,
                        "recent_fetched_count": int(summary["recent_fetched_count"]),
                    }
                )
            if index % 25 == 0:
                await asyncio.sleep(0)
    except Exception as exc:
        summary["error"] = str(exc)
    finally:
        await api.close()

    return summary


def _tag_list_from_item(item: dict) -> list[str]:
    explicit_tags = unique_strings(
        [
            tag
            for tag in (item.get("sample_tags") or [])
            if str(tag or "").strip() and not is_generic_group_signal(tag)
        ],
        limit=16,
    )
    if explicit_tags:
        return explicit_tags

    fallback_tags = extract_signal_tokens(
        *(item.get("content_signals") or []),
        str(item.get("latest_title") or "").strip(),
        *(item.get("sample_titles") or [])[:3],
        *(item.get("sample_albums") or [])[:3],
        *(item.get("sample_folders") or [])[:3],
        str(item.get("source_summary") or "").strip(),
    )
    return unique_strings(
        [
            tag
            for tag in fallback_tags
            if str(tag or "").strip() and not is_generic_group_signal(tag)
        ],
        limit=16,
    )


def _build_tag_signal_weights(tags: list[str]) -> Counter[str]:
    return Counter({tag: 1.0 for tag in tags})


def _build_xhs_tag_grouping_entries(authors: list[dict]) -> list[dict]:
    entries: list[dict] = []
    for item in authors or []:
        author = str(item.get("author") or "").strip()
        if not author:
            continue
        tags = _tag_list_from_item(item)
        entries.append(
            {
                "platform": "xiaohongshu",
                "author": author,
                "author_id": str(item.get("author_id") or "").strip(),
                "display_name": author,
                "note_count": int(item.get("note_count") or 0),
                "total_likes": int(item.get("total_likes") or 0),
                "total_collects": int(item.get("total_collects") or 0),
                "total_comments": int(item.get("total_comments") or 0),
                "score": float(item.get("score") or 0),
                "latest_title": str(item.get("latest_title") or "").strip(),
                "sample_titles": unique_strings(item.get("sample_titles") or [], limit=6),
                "sample_albums": unique_strings(item.get("sample_albums") or [], limit=6),
                "sample_tags": tags,
                "sample_note_urls": unique_strings(item.get("sample_note_urls") or [], limit=6),
                "source_summary": str(item.get("source_summary") or "").strip(),
                "signal_weights": _build_tag_signal_weights(tags),
                "raw_signals": tags,
                "grouping_source": str(item.get("grouping_source") or "xiaohongshu-tags").strip(),
            }
        )
    return entries


def _build_bilibili_tag_grouping_entries(authors: list[dict]) -> list[dict]:
    entries: list[dict] = []
    for item in authors or []:
        display_name = str(item.get("matched_uname") or item.get("author") or "").strip()
        if not display_name:
            continue
        tags = _tag_list_from_item(item)
        entries.append(
            {
                "platform": "bilibili",
                "author": display_name,
                "author_id": str(item.get("matched_mid") or item.get("author_id") or "").strip(),
                "display_name": display_name,
                "matched_author": str(item.get("matched_author") or item.get("author") or "").strip(),
                "favorite_note_count": int(item.get("favorite_note_count") or item.get("note_count") or 0),
                "latest_title": str(item.get("latest_title") or "").strip(),
                "sample_titles": unique_strings(item.get("sample_titles") or [], limit=6),
                "sample_tags": tags,
                "sample_folders": unique_strings(item.get("sample_folders") or [], limit=6),
                "sample_oids": unique_strings(item.get("sample_oids") or [], limit=8),
                "sample_urls": unique_strings(item.get("sample_urls") or [], limit=6),
                "source_summary": str(item.get("source_summary") or "").strip(),
                "signal_weights": _build_tag_signal_weights(tags),
                "raw_signals": tags,
                "grouping_source": str(item.get("grouping_source") or "bilibili-tags").strip(),
            }
        )
    return entries


def _build_frequency_tag_group_labels(
    entries: list[dict],
    vault_signal_database: dict | None,
    *,
    max_groups: int = 12,
) -> dict[str, str]:
    creator_support = Counter()
    vault_support = {
        str(item.get("signal") or "").strip(): int(item.get("count") or 0)
        for item in ((vault_signal_database or {}).get("signals") or [])
        if str(item.get("signal") or "").strip()
    }

    for entry in entries:
        for tag in unique_strings(entry.get("raw_signals") or entry.get("sample_tags") or [], limit=16):
            if is_generic_group_signal(tag):
                continue
            creator_support[tag] += 1

    ranked = sorted(
        creator_support,
        key=lambda tag: (-int(creator_support[tag]), -int(vault_support.get(tag) or 0), tag),
    )
    mapping: dict[str, str] = {}
    for tag in ranked:
        if len(mapping) >= max_groups:
            break
        if int(creator_support[tag]) < 2 and int(vault_support.get(tag) or 0) < 2:
            continue
        label = str(tag or "").strip()[:48]
        if not label or is_generic_group_signal(label):
            continue
        mapping[tag] = label

    return mapping


def _build_tag_group_options(
    entries: list[dict],
    signal_group_labels: dict[str, object],
    *,
    vault_signal_database: dict | None = None,
) -> list[dict]:
    normalized_signal_group_labels = {
        normalize_group_signal_key(signal): _normalize_signal_group_label_values(
            label,
            signal_key=normalize_group_signal_key(signal),
        )
        for signal, label in dict(signal_group_labels or {}).items()
        if str(signal or "").strip()
    }
    grouped: dict[str, dict] = {}

    for entry in entries:
        author = str(entry.get("display_name") or entry.get("author") or entry.get("author_id") or "").strip()
        platform = str(entry.get("platform") or "").strip()
        matched_tags_by_label: dict[str, list[str]] = {}
        for tag in unique_strings(entry.get("raw_signals") or entry.get("sample_tags") or [], limit=16):
            labels = normalized_signal_group_labels.get(normalize_group_signal_key(tag)) or []
            if not labels:
                continue
            for label in labels:
                matched_tags_by_label.setdefault(label, []).append(tag)

        for label, matched_tags in matched_tags_by_label.items():
            option = grouped.setdefault(
                label,
                {
                    "value": build_smart_group_value(label),
                    "label": label,
                    "count": 0,
                    "sample_authors": [],
                    "sample_tags": [],
                    "source_signals": [],
                    "platforms": [],
                },
            )
            option["count"] = int(option.get("count") or 0) + 1
            option["sample_authors"] = unique_strings([*(option.get("sample_authors") or []), author], limit=4)
            option["sample_tags"] = unique_strings([*(option.get("sample_tags") or []), *matched_tags], limit=8)
            option["source_signals"] = unique_strings([*(option.get("source_signals") or []), *matched_tags], limit=12)
            option["platforms"] = unique_strings([*(option.get("platforms") or []), platform], limit=4)

    for item in (vault_signal_database or {}).get("signals") or []:
        raw_signal = str(item.get("signal") or "").strip()
        if not raw_signal or is_generic_group_signal(raw_signal):
            continue
        labels = normalized_signal_group_labels.get(normalize_group_signal_key(raw_signal)) or []
        if not labels:
            continue
        for label in labels:
            option = grouped.setdefault(
                label,
                {
                    "value": build_smart_group_value(label),
                    "label": label,
                    "count": 0,
                    "sample_authors": [],
                    "sample_tags": [],
                    "source_signals": [],
                    "platforms": [],
                },
            )
            option["sample_authors"] = unique_strings(
                [*(option.get("sample_authors") or []), *(item.get("sample_authors") or [])],
                limit=4,
            )
            option["sample_tags"] = unique_strings([*(option.get("sample_tags") or []), raw_signal], limit=8)
            option["source_signals"] = unique_strings([*(option.get("source_signals") or []), raw_signal], limit=12)
            option["platforms"] = unique_strings(
                [*(option.get("platforms") or []), *(item.get("platforms") or [])],
                limit=4,
            )

    return merge_shared_group_options(list(grouped.values()))


def _collect_unmatched_tag_stats(
    entries: list[dict],
    signal_group_labels: dict[str, object],
) -> list[dict[str, object]]:
    normalized_signal_group_labels = {
        normalize_group_signal_key(signal): _normalize_signal_group_label_values(
            label,
            signal_key=normalize_group_signal_key(signal),
        )
        for signal, label in dict(signal_group_labels or {}).items()
        if str(signal or "").strip()
    }
    stats: dict[str, dict[str, object]] = {}

    for entry in entries:
        platform = str(entry.get("platform") or "").strip()
        author = str(entry.get("display_name") or entry.get("author") or "").strip()
        titles = unique_strings(entry.get("sample_titles") or [], limit=2)
        for tag in unique_strings(entry.get("raw_signals") or entry.get("sample_tags") or [], limit=20):
            if normalized_signal_group_labels.get(normalize_group_signal_key(tag)):
                continue
            if is_generic_group_signal(tag):
                continue
            stat = stats.setdefault(
                tag,
                {
                    "tag": tag,
                    "count": 0,
                    "platforms": [],
                    "sample_authors": [],
                    "sample_titles": [],
                },
            )
            stat["count"] = int(stat.get("count") or 0) + 1
            stat["platforms"] = unique_strings([*(stat.get("platforms") or []), platform], limit=4)
            stat["sample_authors"] = unique_strings([*(stat.get("sample_authors") or []), author], limit=4)
            stat["sample_titles"] = unique_strings([*(stat.get("sample_titles") or []), *titles], limit=3)

    return sorted(
        stats.values(),
        key=lambda item: (-int(item.get("count") or 0), str(item.get("tag") or "")),
    )


async def _suggest_ai_unmatched_tag_group_labels(
    *,
    entries: list[dict],
    signal_group_labels: dict[str, object],
    group_options: list[dict],
    max_new_groups: int = 4,
) -> dict[str, str]:
    unmatched_stats = _collect_unmatched_tag_stats(entries, signal_group_labels)
    if len(unmatched_stats) < 8:
        return {}

    existing_groups = [
        {
            "label": str(option.get("label") or "").strip(),
            "sample_tags": unique_strings(option.get("sample_tags") or [], limit=6),
            "source_signals": unique_strings(option.get("source_signals") or [], limit=8),
            "platforms": unique_strings(option.get("platforms") or [], limit=4),
        }
        for option in group_options
        if str(option.get("label") or "").strip() and str(option.get("label") or "").strip() != "待补标签"
    ]
    payload = unmatched_stats[:120]
    prompt = (
        "你在做跨平台作者智能分组的第二轮补映射。"
        "已有一批共享组 existing_groups；现在请把 unmatched_tags 尽量归到这些已有组里。"
        f"只有当某批标签明显无法归入已有组时，才允许新建最多 {max_new_groups} 个共享组。"
        "优先复用已有组，避免组别爆炸；不要使用平台名、作者、视频、笔记、其他、低信息标签、待补标签 这类泛词。"
        "只返回 JSON，不要解释。格式必须是："
        '{"tag_to_group":{"Obsidian":"知识管理 / Obsidian"},"new_groups":[{"label":"音乐 / 吉他 / 唱歌","tags":["吉他","电吉他"]}]}'
        f"\nexisting_groups={json.dumps(existing_groups[:24], ensure_ascii=False)}"
        f"\nunmatched_tags={json.dumps(payload, ensure_ascii=False)}"
    )

    try:
        from abo.sdk.tools import agent_json

        result = await agent_json(prompt)
    except Exception:
        return {}

    mapping: dict[str, str] = {}
    if isinstance(result, dict):
        for raw_tag, raw_label in dict(result.get("tag_to_group") or {}).items():
            tag = str(raw_tag or "").strip()
            label = _normalize_generated_group_label(raw_label)
            if tag and label:
                mapping[tag] = label
        for item in result.get("new_groups") or []:
            label = _normalize_generated_group_label((item or {}).get("label"))
            if not label:
                continue
            for raw_tag in (item or {}).get("tags") or []:
                tag = str(raw_tag or "").strip()
                if tag and tag not in mapping:
                    mapping[tag] = label

    return mapping


def _count_pending_entries(entries: list[dict]) -> int:
    return sum(1 for entry in entries if "待补标签" in (entry.get("smart_group_labels") or []))


def _entry_identity(entry: dict) -> str:
    platform = str(entry.get("platform") or "").strip() or "unknown"
    author_id = str(entry.get("author_id") or "").strip()
    author = str(entry.get("display_name") or entry.get("author") or "").strip()
    return f"{platform}:{author_id or author}"


async def _refine_tag_group_labels_iteratively(
    *,
    entries: list[dict],
    prefs: dict,
    vault_signal_database: dict | None,
    signal_group_labels: dict[str, object],
    max_iterations: int = 5,
) -> dict[str, object]:
    current_labels = _normalize_signal_group_labels(signal_group_labels)
    iteration_summaries: list[dict[str, object]] = []
    ai_refined_signal_group_labels: dict[str, list[str]] = {}
    group_options = _build_tag_group_options(entries, current_labels, vault_signal_database=vault_signal_database)
    group_options = _assign_entry_groups_by_tags(entries, group_options, current_labels)
    previous_pending = _count_pending_entries(entries)

    for index in range(max_iterations):
        non_pending_groups = max(
            0,
            len([item for item in group_options if str(item.get("label") or "").strip() != "待补标签"]),
        )
        suggestion = await _suggest_ai_unmatched_tag_group_labels(
            entries=entries,
            signal_group_labels=current_labels,
            group_options=group_options,
            max_new_groups=max(0, 20 - non_pending_groups),
        )
        if not suggestion:
            break

        new_mapping = _normalize_signal_group_labels(suggestion)
        new_mapping = {tag: labels for tag, labels in new_mapping.items() if current_labels.get(tag) != labels}
        if not new_mapping:
            break

        ai_refined_signal_group_labels.update(new_mapping)
        current_labels = {**current_labels, **new_mapping}
        group_options = _build_tag_group_options(entries, current_labels, vault_signal_database=vault_signal_database)
        group_options = _assign_entry_groups_by_tags(entries, group_options, current_labels)
        pending_count = _count_pending_entries(entries)
        iteration_summaries.append(
            {
                "iteration": index + 1,
                "new_mapping_count": len(new_mapping),
                "pending_count": pending_count,
            }
        )
        if pending_count == 0 or pending_count >= previous_pending:
            break
        previous_pending = pending_count

    return {
        "signal_group_labels": current_labels,
        "group_options": group_options,
        "ai_refined_signal_group_labels": ai_refined_signal_group_labels,
        "iteration_summaries": iteration_summaries,
    }


async def _suggest_ai_pending_author_group_assignments(
    *,
    entries: list[dict],
    group_options: list[dict],
    batch_size: int = 80,
) -> dict[str, list[str]]:
    pending_entries = [entry for entry in entries if "待补标签" in (entry.get("smart_group_labels") or [])]
    if not pending_entries:
        return {}

    existing_groups = [
        {
            "label": str(option.get("label") or "").strip(),
            "sample_tags": unique_strings(option.get("sample_tags") or [], limit=6),
            "sample_authors": unique_strings(option.get("sample_authors") or [], limit=4),
        }
        for option in group_options
        if str(option.get("label") or "").strip() and str(option.get("label") or "").strip() != "待补标签"
    ]
    if not existing_groups:
        return {}

    from abo.sdk.tools import agent_json

    assignments: dict[str, list[str]] = {}
    for start in range(0, len(pending_entries), batch_size):
        batch = pending_entries[start:start + batch_size]
        payload = [
            {
                "id": _entry_identity(entry),
                "platform": str(entry.get("platform") or "").strip(),
                "author": str(entry.get("display_name") or entry.get("author") or "").strip(),
                "author_id": str(entry.get("author_id") or "").strip(),
                "tags": unique_strings(entry.get("sample_tags") or entry.get("raw_signals") or [], limit=8),
                "titles": unique_strings(entry.get("sample_titles") or [], limit=2),
                "albums": unique_strings(
                    [
                        *(entry.get("sample_albums") or []),
                        *(entry.get("sample_folders") or []),
                    ],
                    limit=3,
                ),
                "source_summary": str(entry.get("source_summary") or "").strip(),
            }
            for entry in batch
        ]
        prompt = (
            "你在做作者智能分组的最后一轮兜底。"
            "这些 pending_authors 还没有稳定标签，但已有标题、专辑和少量上下文。"
            "请把每个作者分配到 existing_groups 里的 1 到 2 个最接近的现有共享组，只能复用 existing_groups，不允许新建分组，不允许返回待补标签。"
            "不要返回低信息标签、其他、杂项这类占位组。"
            "只返回 JSON，不要解释。格式必须是："
            '{"author_to_groups":{"xiaohongshu:user-a":["情绪 / 成长"]}}'
            f"\nexisting_groups={json.dumps(existing_groups[:24], ensure_ascii=False)}"
            f"\npending_authors={json.dumps(payload, ensure_ascii=False)}"
        )
        try:
            result = await agent_json(prompt)
        except Exception:
            continue

        if not isinstance(result, dict):
            continue
        for raw_key, raw_groups in dict(result.get("author_to_groups") or {}).items():
            key = str(raw_key or "").strip()
            groups = unique_strings(
                [
                    _normalize_generated_group_label(group)
                    for group in (raw_groups or [])
                    if _normalize_generated_group_label(group)
                ],
                limit=2,
            )
            if key and groups:
                assignments[key] = groups

    return assignments


def _apply_ai_pending_author_assignments(
    entries: list[dict],
    group_options: list[dict],
    assignments: dict[str, list[str]],
) -> list[dict]:
    if not assignments:
        return group_options

    label_to_value = {
        str(option.get("label") or "").strip(): str(option.get("value") or "").strip()
        for option in group_options
        if str(option.get("label") or "").strip() and str(option.get("value") or "").strip()
    }

    for entry in entries:
        if "待补标签" not in (entry.get("smart_group_labels") or []):
            continue
        assigned_labels = assignments.get(_entry_identity(entry)) or []
        valid_labels = [label for label in assigned_labels if label in label_to_value]
        if not valid_labels:
            continue
        entry["smart_group_labels"] = valid_labels
        entry["smart_group_values"] = [label_to_value[label] for label in valid_labels]
        entry["smart_group_label"] = valid_labels[0]
        entry["smart_group_value"] = label_to_value[valid_labels[0]]

    pending_count = _count_pending_entries(entries)
    if pending_count == 0:
        return [option for option in group_options if str(option.get("label") or "").strip() != "待补标签"]
    return group_options


def _assign_entry_groups_by_tags(
    entries: list[dict],
    group_options: list[dict],
    signal_group_labels: dict[str, object] | None = None,
    *,
    allow_context_groups: bool = True,
) -> list[dict]:
    pending_value = build_smart_group_value("待补标签")
    pending_authors: list[str] = []
    pending_platforms: list[str] = []
    normalized_signal_group_labels = {
        normalize_group_signal_key(signal): _normalize_signal_group_label_values(
            label,
            signal_key=normalize_group_signal_key(signal),
        )
        for signal, label in dict(signal_group_labels or {}).items()
        if str(signal or "").strip()
    }
    label_to_value = {
        str(option.get("label") or "").strip(): str(option.get("value") or "").strip()
        for option in group_options
        if str(option.get("label") or "").strip() and str(option.get("value") or "").strip()
    }
    context_group_options: dict[str, dict] = {}

    for entry in entries:
        tags = unique_strings(entry.get("raw_signals") or entry.get("sample_tags") or [], limit=20)
        labels = unique_strings([
            label
            for tag in tags
            for label in normalized_signal_group_labels.get(normalize_group_signal_key(tag), [])
            if normalize_group_signal_key(tag)
        ])
        values = unique_strings([label_to_value.get(label, "") for label in labels if label_to_value.get(label, "")])
        if not values:
            values, labels = match_smart_groups_from_content_tags(tags, group_options)
        if not values and allow_context_groups:
            labels = _guess_context_group_labels(
                *(entry.get("raw_signals") or []),
                *(entry.get("sample_tags") or []),
                *(entry.get("sample_titles") or []),
                str(entry.get("latest_title") or "").strip(),
                *(entry.get("sample_albums") or []),
                *(entry.get("sample_folders") or []),
                str(entry.get("source_summary") or "").strip(),
            )
            values = unique_strings(
                [
                    label_to_value.get(label) or build_smart_group_value(label)
                    for label in labels
                    if label
                ],
                limit=2,
            )
            for label in labels:
                value = label_to_value.get(label) or build_smart_group_value(label)
                if label not in label_to_value:
                    label_to_value[label] = value
                option = context_group_options.setdefault(
                    value,
                    {
                        "value": value,
                        "label": label,
                        "count": 0,
                        "sample_authors": [],
                        "sample_tags": [],
                        "source_signals": [],
                        "platforms": [],
                    },
                )
                option["count"] = int(option.get("count") or 0) + 1
                option["sample_authors"] = unique_strings(
                    [
                        *(option.get("sample_authors") or []),
                        str(entry.get("display_name") or entry.get("author") or entry.get("author_id") or "").strip(),
                    ],
                    limit=4,
                )
                option["sample_tags"] = unique_strings(
                    [
                        *(option.get("sample_tags") or []),
                        *(entry.get("raw_signals") or []),
                        *(entry.get("sample_tags") or []),
                    ],
                    limit=8,
                )
                option["source_signals"] = unique_strings(
                    [
                        *(option.get("source_signals") or []),
                        *(entry.get("raw_signals") or []),
                        *(entry.get("sample_tags") or []),
                    ],
                    limit=12,
                )
                option["platforms"] = unique_strings(
                    [*(option.get("platforms") or []), str(entry.get("platform") or "").strip()],
                    limit=4,
                )
        if not values:
            values = [pending_value]
            labels = ["待补标签"]
            pending_authors.append(
                str(entry.get("display_name") or entry.get("author") or entry.get("author_id") or "").strip()
            )
            pending_platforms.append(str(entry.get("platform") or "").strip())

        entry["smart_group_values"] = values
        entry["smart_group_labels"] = labels
        entry["smart_group_value"] = values[0]
        entry["smart_group_label"] = labels[0]

    next_group_options = merge_shared_group_options(group_options, list(context_group_options.values()))
    if not pending_authors:
        return next_group_options

    pending_option = {
        "value": pending_value,
        "label": "待补标签",
        "count": len(pending_authors),
        "sample_authors": unique_strings(pending_authors, limit=4),
        "sample_tags": [],
        "source_signals": [],
        "platforms": unique_strings(pending_platforms, limit=4),
    }
    return merge_shared_group_options(next_group_options, [pending_option])


def _build_xhs_grouping_entries(authors: list[dict]) -> list[dict]:
    entries: list[dict] = []

    for item in authors or []:
        author_id = str(item.get("author_id") or "").strip()
        author = str(item.get("author") or "").strip()
        if not author:
            continue

        signal_weights: Counter[str] = Counter()
        sample_albums = unique_strings(item.get("sample_albums") or [], limit=6)
        sample_tags = unique_strings(item.get("sample_tags") or [], limit=8)
        sample_titles = unique_strings(item.get("sample_titles") or [], limit=6)
        sample_note_urls = unique_strings(item.get("sample_note_urls") or [], limit=6)
        content_signals = unique_strings(item.get("content_signals") or [], limit=8)
        source_summary = str(item.get("source_summary") or "").strip()
        latest_title = str(item.get("latest_title") or "").strip()

        for album in sample_albums:
            if not is_generic_group_signal(album):
                signal_weights[album] += 0.35 if (sample_tags or content_signals) else 0.75
        for tag in sample_tags:
            if not is_generic_group_signal(tag):
                signal_weights[tag] += 1.8
        for token in content_signals:
            if not is_generic_group_signal(token):
                signal_weights[token] += 1.05
        for token in _split_signal_tokens(source_summary):
            if not is_generic_group_signal(token):
                signal_weights[token] += 0.18
        for token in _split_signal_tokens(latest_title, *sample_titles[:2]):
            if len(token) > 14 or is_generic_group_signal(token):
                continue
            signal_weights[token] += 0.55 if token == latest_title else 0.35

        entries.append(
            {
                "platform": "xiaohongshu",
                "author": author,
                "author_id": author_id,
                "display_name": author,
                "note_count": int(item.get("note_count") or 0),
                "total_likes": int(item.get("total_likes") or 0),
                "total_collects": int(item.get("total_collects") or 0),
                "total_comments": int(item.get("total_comments") or 0),
                "score": float(item.get("score") or 0),
                "latest_title": latest_title,
                "sample_titles": sample_titles,
                "sample_albums": sample_albums,
                "sample_tags": sample_tags,
                "content_signals": content_signals,
                "sample_note_urls": sample_note_urls,
                "source_summary": source_summary,
                "signal_weights": signal_weights,
                "grouping_source": "xiaohongshu-vault",
            }
        )

    return entries


def _build_bilibili_grouping_entries(authors: list[dict]) -> list[dict]:
    entries: list[dict] = []

    for item in authors or []:
        matched_author = str(item.get("author") or "").strip()
        display_name = str(item.get("matched_uname") or item.get("author") or "").strip()
        author_id = str(item.get("matched_mid") or item.get("author_id") or "").strip()
        if not display_name:
            continue

        signal_weights: Counter[str] = Counter()
        sample_folders = unique_strings(item.get("sample_folders") or [], limit=6)
        sample_tags = unique_strings(item.get("sample_tags") or [], limit=8)
        sample_titles = unique_strings(item.get("sample_titles") or [], limit=6)
        sample_oids = unique_strings(item.get("sample_oids") or [], limit=6)
        sample_urls = unique_strings(item.get("sample_urls") or [], limit=6)
        source_summary = str(item.get("source_summary") or "").strip()
        content_signals = unique_strings(item.get("content_signals") or [], limit=8)
        latest_title = str(item.get("latest_title") or "").strip()

        for folder in sample_folders:
            if not is_generic_group_signal(folder):
                signal_weights[folder] += 0.2 if (sample_tags or content_signals) else 0.6
        for tag in sample_tags:
            if not is_generic_group_signal(tag):
                signal_weights[tag] += 1.7
        for token in _split_signal_tokens(source_summary):
            if not is_generic_group_signal(token):
                signal_weights[token] += 0.15
        for token in content_signals:
            if not is_generic_group_signal(token):
                signal_weights[token] += 0.9
        for token in _split_signal_tokens(latest_title, *sample_titles[:2]):
            if len(token) > 14 or is_generic_group_signal(token):
                continue
            signal_weights[token] += 0.5 if token == latest_title else 0.35

        entries.append(
            {
                "platform": "bilibili",
                "author": display_name,
                "author_id": author_id,
                "display_name": display_name,
                "matched_author": matched_author,
                "favorite_note_count": int(item.get("note_count") or 0),
                "latest_title": latest_title,
                "sample_titles": sample_titles,
                "sample_tags": sample_tags,
                "sample_folders": sample_folders,
                "sample_oids": sample_oids,
                "sample_urls": sample_urls,
                "source_summary": source_summary,
                "signal_weights": signal_weights,
                "grouping_source": "bilibili-vault",
            }
        )

    return entries


async def _suggest_ai_signal_group_labels(entries: list[dict], prefs: dict) -> dict[str, str]:
    signal_stats: dict[str, dict] = {}
    shared_grouping = dict((prefs.get("shared_creator_grouping", {}) or {}) if isinstance(prefs, dict) else {})
    vault_signal_database = dict(shared_grouping.get("vault_signal_database") or {})
    existing_signal_group_labels = _normalize_signal_group_labels(
        dict(shared_grouping.get("signal_group_labels") or {})
    )
    existing_signal_keys = {
        normalize_group_signal_key(signal)
        for signal in existing_signal_group_labels
        if normalize_group_signal_key(signal)
    }

    for entry in entries:
        author = str(entry.get("display_name") or entry.get("author") or "").strip()
        platform = str(entry.get("platform") or "").strip()
        for signal, weight in Counter(entry.get("signal_weights") or {}).most_common(6):
            if is_generic_group_signal(signal):
                continue
            if normalize_group_signal_key(signal) in existing_signal_keys:
                continue
            stat = signal_stats.setdefault(
                signal,
                {"count": 0, "weight": 0.0, "platforms": set(), "sample_authors": []},
            )
            stat["count"] += 1
            stat["weight"] += float(weight)
            if platform:
                stat["platforms"].add(platform)
            if author and author not in stat["sample_authors"] and len(stat["sample_authors"]) < 4:
                stat["sample_authors"].append(author)

    ranked_signals = sorted(
        signal_stats.items(),
        key=lambda item: (-int(item[1]["count"]), -float(item[1]["weight"]), item[0]),
    )[:60]
    vault_signal_candidates = [
        (
            str(item.get("signal") or "").strip(),
            item,
        )
        for item in (vault_signal_database.get("signals") or [])[:80]
        if str(item.get("signal") or "").strip()
        and normalize_group_signal_key(str(item.get("signal") or "").strip()) not in existing_signal_keys
    ]
    if len(ranked_signals) < 6 and len(vault_signal_candidates) < 6:
        return {}

    payload = [
        {
            "signal": signal,
            "count": int(stat["count"]),
            "weight": round(float(stat["weight"]), 2),
            "platforms": sorted(str(item) for item in stat["platforms"]),
            "sample_authors": stat["sample_authors"],
        }
        for signal, stat in ranked_signals
    ]
    vault_signal_payload = [
        {
            "signal": signal,
            "count": int(item.get("count") or 0),
            "platforms": unique_strings(item.get("platforms") or [], limit=6),
            "sample_titles": unique_strings(item.get("sample_titles") or [], limit=3),
            "sample_authors": unique_strings(item.get("sample_authors") or [], limit=3),
        }
        for signal, item in vault_signal_candidates
    ]
    author_contexts = [
        {
            "platform": str(entry.get("platform") or "").strip(),
            "author": str(entry.get("display_name") or entry.get("author") or "").strip(),
            "author_id": str(entry.get("author_id") or "").strip(),
            "raw_tags": [
                signal
                for signal in _top_entry_signals(entry, limit=6)
                if normalize_group_signal_key(signal) not in existing_signal_keys
            ],
            "sample_tags": [
                signal
                for signal in unique_strings(entry.get("sample_tags") or [], limit=6)
                if normalize_group_signal_key(signal) not in existing_signal_keys
            ],
            "sample_titles": unique_strings(entry.get("sample_titles") or [], limit=2),
            "source_summary": str(entry.get("source_summary") or "").strip(),
        }
        for entry in sorted(
            entries,
            key=lambda item: (
                -float(item.get("score") or 0),
                -int(item.get("note_count") or item.get("favorite_note_count") or 0),
                str(item.get("display_name") or item.get("author") or ""),
            ),
        )[:24]
    ]
    existing_group_labels = unique_strings(
        [
            *[
                label
                for labels in existing_signal_group_labels.values()
                for label in labels
            ],
            *[item.get("label") for item in (shared_grouping.get("group_options") or [])],
        ],
        limit=16,
    )

    prompt = (
        "你在整理一个跨平台内容收藏库的共享智能分组。"
        "下面的 raw_signals 只来自 Obsidian 情报库里抽出来的原始标签，以及作者最近内容里的标签。"
        "请只按标签语义聚类，不要参考平台名、收藏夹名、专辑名、标题词。"
        "如果几个标签经常在同一作者身上共同出现，也优先归到同一个共享组。"
        "请把语义接近的 raw_signals 归并成大约 10 到 20 个共享分组；如果总标签量较少，可以少于 10 组。"
        "分组标签要简洁、稳定、可用于后续情报推送，不要使用平台名、视频、笔记、作者、博主、UP主、其他 这类泛词。"
        "如果 existing_group_labels 里已经有合适标签，优先复用，减少增量更新时的标签漂移。"
        "优先保留用户真正会拿来筛选作者和内容的主题词。"
        "只返回 JSON，不要加解释。格式必须是："
        '{"groups":[{"label":"知识管理 / Obsidian","signals":["Obsidian","知识库"]}],"signal_to_group":{"Obsidian":"知识管理 / Obsidian"}}'
        f"\nraw_signals={json.dumps(payload, ensure_ascii=False)}"
        f"\nvault_signals={json.dumps(vault_signal_payload, ensure_ascii=False)}"
        f"\nauthor_contexts={json.dumps(author_contexts, ensure_ascii=False)}"
        f"\nexisting_group_labels={json.dumps(existing_group_labels, ensure_ascii=False)}"
    )

    try:
        from abo.sdk.tools import agent_json

        result = await agent_json(prompt, prefs=prefs)
    except Exception:
        return {}

    mapping: dict[str, str] = {}
    raw_signal_map = {signal: signal for signal, _stat in ranked_signals}
    raw_signal_map.update({signal: signal for signal, _item in vault_signal_candidates})
    explicit_map = result.get("signal_to_group", {}) if isinstance(result, dict) else {}
    if isinstance(explicit_map, dict):
        for raw_signal, label in explicit_map.items():
            signal = raw_signal_map.get(str(raw_signal).strip())
            clean_label = str(label or "").strip()[:48]
            if signal and clean_label:
                mapping[signal] = clean_label

    for item in (result.get("groups") or []) if isinstance(result, dict) else []:
        label = str(item.get("label") or "").strip()[:48]
        if not label:
            continue
        for raw_signal in item.get("signals") or []:
            signal = raw_signal_map.get(str(raw_signal).strip())
            if signal and signal not in mapping:
                mapping[signal] = label

    return mapping


def _build_xhs_profiles_from_entries(entries: list[dict]) -> tuple[dict[str, dict], list[dict]]:
    profiles: dict[str, dict] = {}
    skipped: list[dict] = []

    for entry in entries:
        if entry.get("platform") != "xiaohongshu":
            continue
        author = str(entry.get("author") or entry.get("display_name") or "").strip()
        author_id = str(entry.get("author_id") or "").strip()

        smart_group_values = unique_strings(
            entry.get("smart_group_values")
            or [entry.get("smart_group_value")]
            or [],
        )
        smart_group_labels = unique_strings(
            entry.get("smart_group_labels")
            or [entry.get("smart_group_label")]
            or [],
        )
        if not smart_group_values:
            smart_group_values = [build_smart_group_value("待补标签")]
        if not smart_group_labels:
            smart_group_labels = ["待补标签"]
        profile_id = author_id or f"pending:{normalize_creator_name_key(author) or author}"
        if not author_id:
            skipped.append({"author": author, "reason": "missing_author_id", "profile_id": profile_id})
        profiles[profile_id] = {
            "author": author or author_id,
            "author_id": author_id,
            "pending_author_id": not bool(author_id),
            "note_count": int(entry.get("note_count") or 0),
            "smart_groups": smart_group_values,
            "smart_group_labels": smart_group_labels,
            "latest_title": str(entry.get("latest_title") or "").strip(),
            "sample_titles": entry.get("sample_titles") or [],
            "sample_albums": entry.get("sample_albums") or [],
            "sample_tags": entry.get("sample_tags") or [],
            "sample_note_urls": entry.get("sample_note_urls") or [],
            "source_summary": str(entry.get("source_summary") or "").strip(),
            "grouping_source": str(entry.get("grouping_source") or "xiaohongshu-tags").strip(),
            "raw_signals": unique_strings(entry.get("raw_signals") or _top_entry_signals(entry), limit=12),
        }

    return profiles, skipped


async def _build_bilibili_profiles_from_entries(
    entries: list[dict],
    *,
    progress_callback=None,
    progress_start: int = 80,
    progress_end: int = 96,
    total_groups: int = 0,
) -> tuple[dict[str, dict], list[dict]]:
    profiles: dict[str, dict] = {}
    skipped: list[dict] = []
    bilibili_entries = [entry for entry in entries if entry.get("platform") == "bilibili"]
    total_entries = len(bilibili_entries)

    for index, entry in enumerate(bilibili_entries, start=1):
        author = str(entry.get("author") or entry.get("display_name") or "").strip()
        author_id = str(entry.get("author_id") or "").strip()
        matched_author = str(entry.get("matched_author") or "").strip()

        smart_group_values = unique_strings(
            entry.get("smart_group_values")
            or [entry.get("smart_group_value")]
            or [],
        )
        smart_group_labels = unique_strings(
            entry.get("smart_group_labels")
            or [entry.get("smart_group_label")]
            or [],
        )
        if not smart_group_values:
            smart_group_values = [build_smart_group_value("待补标签")]
        if not smart_group_labels:
            smart_group_labels = ["待补标签"]
        profile_id = author_id or f"pending:bilibili:{normalize_creator_name_key(matched_author or author) or author}"
        if not author_id:
            skipped.append({"author": matched_author or author, "reason": "missing_author_id", "profile_id": profile_id})
        profiles[profile_id] = {
            "author": author or author_id,
            "author_id": author_id,
            "pending_author_id": not bool(author_id),
            "matched_author": matched_author or author,
            "favorite_note_count": int(entry.get("favorite_note_count") or 0),
            "smart_groups": smart_group_values,
            "smart_group_labels": smart_group_labels,
            "latest_title": str(entry.get("latest_title") or "").strip(),
            "sample_titles": entry.get("sample_titles") or [],
            "sample_tags": entry.get("sample_tags") or [],
            "sample_folders": entry.get("sample_folders") or [],
            "sample_oids": entry.get("sample_oids") or [],
            "sample_urls": entry.get("sample_urls") or [],
            "source_summary": str(entry.get("source_summary") or "").strip(),
            "grouping_source": str(entry.get("grouping_source") or "bilibili-tags").strip(),
            "raw_signals": unique_strings(entry.get("raw_signals") or _top_entry_signals(entry), limit=12),
        }

        if progress_callback:
            progress_callback(
                f"已生成 {total_groups} 个共享分类，正在整理第 {index}/{max(total_entries, 1)} 个 UP",
                _map_progress_percent(
                    int(index / max(total_entries, 1) * 100),
                    progress_start,
                    progress_end,
                ),
                processed_followed_count=index,
                total_followed_count=total_entries,
                current_followed_name=author or matched_author or author_id,
                total_groups=total_groups,
            )
        if index % 25 == 0:
            await asyncio.sleep(0)

    return profiles, skipped


def _build_shared_creator_catalog(entries: list[dict]) -> dict[str, dict]:
    catalog: dict[str, dict] = {}
    for entry in entries:
        platform = str(entry.get("platform") or "unknown").strip() or "unknown"
        author = str(entry.get("display_name") or entry.get("author") or "").strip()
        matched_author = str(entry.get("matched_author") or "").strip()
        author_id = str(entry.get("author_id") or "").strip()
        key = f"{platform}:{author_id or author}"
        catalog[key] = {
            "platform": platform,
            "author": author,
            "author_id": author_id,
            "matched_author": matched_author,
            "author_names": unique_strings([author, matched_author], limit=4),
            "smart_groups": unique_strings(
                entry.get("smart_group_values")
                or [entry.get("smart_group_value")]
                or []
            ),
            "smart_group_labels": unique_strings(
                entry.get("smart_group_labels")
                or [entry.get("smart_group_label")]
                or []
            ),
            "raw_signals": unique_strings(entry.get("raw_signals") or _top_entry_signals(entry), limit=12),
            "sample_titles": unique_strings(entry.get("sample_titles") or [], limit=6),
            "sample_tags": unique_strings(entry.get("sample_tags") or [], limit=8),
            "sample_folders": unique_strings(entry.get("sample_folders") or [], limit=6),
            "sample_albums": unique_strings(entry.get("sample_albums") or [], limit=6),
            "sample_urls": unique_strings(entry.get("sample_urls") or [], limit=6),
            "sample_note_urls": unique_strings(entry.get("sample_note_urls") or [], limit=6),
            "sample_oids": unique_strings(entry.get("sample_oids") or [], limit=6),
            "source_summary": str(entry.get("source_summary") or "").strip(),
            "grouping_source": str(entry.get("grouping_source") or "").strip(),
        }
    return catalog


def _sync_xhs_profiles_into_prefs(
    *,
    prefs: dict,
    incoming_profiles: dict[str, dict],
    shared_group_options: list[dict],
    added_by: str,
    subscription_store,
    skipped: list[dict] | None = None,
) -> dict:
    prefs.setdefault("modules", {})
    module_prefs = prefs["modules"].setdefault("xiaohongshu-tracker", {})
    existing_user_ids = list(module_prefs.get("user_ids", []))
    existing_profiles = dict(module_prefs.get("creator_profiles", {}) or {})
    existing_monitors = list(module_prefs.get("creator_monitors", []) or [])
    disabled_creator_ids = set(str(item) for item in module_prefs.get("disabled_creator_ids", []))
    pending_keys_by_author = {
        normalize_creator_name_key(profile.get("author")): profile_key
        for profile_key, profile in existing_profiles.items()
        if bool(profile.get("pending_author_id")) and str(profile.get("author") or "").strip()
    }

    for profile in incoming_profiles.values():
        author_id = str(profile.get("author_id") or "").strip()
        if not author_id or bool(profile.get("pending_author_id")):
            continue
        pending_key = pending_keys_by_author.get(normalize_creator_name_key(profile.get("author")))
        if pending_key and pending_key != author_id and pending_key in existing_profiles:
            pending_profile = existing_profiles.pop(pending_key)
            existing_profiles[author_id] = {
                **pending_profile,
                **existing_profiles.get(author_id, {}),
            }

    merged_profiles = merge_creator_profiles(existing_profiles, incoming_profiles, shared_group_options)
    added_user_ids: list[str] = []
    next_monitors = list(existing_monitors)
    existing_monitor_ids = {str(item.get("id") or "") for item in next_monitors if isinstance(item, dict)}

    for profile_key, profile in incoming_profiles.items():
        author_id = str(profile.get("author_id") or "").strip()
        pending_author_id = bool(profile.get("pending_author_id")) or not author_id
        if author_id and not pending_author_id and author_id not in existing_user_ids:
            existing_user_ids.append(author_id)
            added_user_ids.append(author_id)
            subscription_store.add_subscription(
                module_id="xiaohongshu-tracker",
                sub_type="user_id",
                value=author_id,
                added_by=added_by,
            )
        if author_id and not pending_author_id:
            disabled_creator_ids.discard(author_id)

        if pending_author_id and profile_key not in existing_monitor_ids:
            next_monitors.append(
                {
                    "id": profile_key,
                    "user_id": "",
                    "label": profile.get("author") or profile_key,
                    "author": profile.get("author") or profile_key,
                    "enabled": False,
                    "per_user_limit": 3,
                    "include_comments": False,
                    "comments_limit": 20,
                    "comments_sort_by": "likes",
                    "smart_groups": profile.get("smart_groups") or [],
                    "smart_group_labels": profile.get("smart_group_labels") or [],
                }
            )
            existing_monitor_ids.add(profile_key)

    module_prefs["user_ids"] = existing_user_ids
    module_prefs["creator_profiles"] = merged_profiles
    module_prefs["creator_monitors"] = next_monitors
    module_prefs["creator_group_options"] = shared_group_options
    module_prefs["disabled_creator_ids"] = [
        item for item in module_prefs.get("disabled_creator_ids", [])
        if str(item) in disabled_creator_ids
    ]
    module_prefs["creator_push_enabled"] = bool(existing_user_ids)
    module_prefs.setdefault("creator_groups", [])

    updated_profile_ids = [author_id for author_id in incoming_profiles if author_id in existing_profiles]
    new_profile_ids = [author_id for author_id in incoming_profiles if author_id not in existing_profiles]
    return {
        "group_options": shared_group_options,
        "incoming_profiles": incoming_profiles,
        "merged_profiles": merged_profiles,
        "added_user_ids": added_user_ids,
        "new_profile_ids": new_profile_ids,
        "updated_profile_ids": updated_profile_ids,
        "skipped": skipped or [],
    }


def _sync_bilibili_profiles_into_prefs(
    *,
    prefs: dict,
    incoming_profiles: dict[str, dict],
    shared_group_options: list[dict],
    skipped: list[dict] | None = None,
) -> dict:
    prefs.setdefault("modules", {})
    module_prefs = prefs["modules"].setdefault("bilibili-tracker", {})
    existing_profiles = dict(module_prefs.get("creator_profiles", {}) or {})
    pending_keys_by_author = {
        normalize_creator_name_key(profile.get("author") or profile.get("matched_author")): profile_key
        for profile_key, profile in existing_profiles.items()
        if bool(profile.get("pending_author_id"))
    }

    for profile in incoming_profiles.values():
        author_id = str(profile.get("author_id") or "").strip()
        if not author_id or bool(profile.get("pending_author_id")):
            continue
        pending_key = pending_keys_by_author.get(
            normalize_creator_name_key(profile.get("author") or profile.get("matched_author"))
        )
        if pending_key and pending_key != author_id and pending_key in existing_profiles:
            pending_profile = existing_profiles.pop(pending_key)
            existing_profiles[author_id] = {
                **pending_profile,
                **existing_profiles.get(author_id, {}),
            }

    merged_profiles = merge_creator_profiles(existing_profiles, incoming_profiles, shared_group_options)

    valid_group_values = {str(item.get("value") or "").strip() for item in shared_group_options if item.get("value")}
    existing_selected_groups = [
        item
        for item in module_prefs.get("followed_up_groups", [])
        if item in valid_group_values
    ]

    module_prefs["creator_profiles"] = merged_profiles
    module_prefs["creator_group_options"] = shared_group_options
    module_prefs["followed_up_groups"] = existing_selected_groups
    module_prefs.setdefault("followed_up_filter_mode", "and")

    updated_profile_ids = [author_id for author_id in incoming_profiles if author_id in existing_profiles]
    new_profile_ids = [author_id for author_id in incoming_profiles if author_id not in existing_profiles]
    return {
        "group_options": shared_group_options,
        "incoming_profiles": incoming_profiles,
        "merged_profiles": merged_profiles,
        "new_profile_ids": new_profile_ids,
        "updated_profile_ids": updated_profile_ids,
        "skipped": skipped or [],
    }


def _build_effective_shared_grouping_prefs(
    prefs: dict,
    vault_path: str | Path | None = None,
) -> dict:
    effective_prefs = {
        **dict(prefs or {}),
        "modules": {
            **dict((prefs or {}).get("modules") or {}),
        },
        "shared_creator_grouping": {
            **dict((prefs or {}).get("shared_creator_grouping") or {}),
        },
    }

    if not vault_path:
        return effective_prefs

    vault_shared_groups = load_vault_shared_groups(vault_path)
    vault_shared_profiles = load_vault_shared_creator_profiles(vault_path)

    shared_snapshot = effective_prefs.setdefault("shared_creator_grouping", {})
    shared_options = merge_shared_group_options(
        [
            {
                **dict(option or {}),
                "label": _normalize_generated_group_label((option or {}).get("label")),
                "value": build_smart_group_value(
                    _normalize_generated_group_label((option or {}).get("label"))
                ) if _normalize_generated_group_label((option or {}).get("label")) else "",
            }
            for option in (vault_shared_groups.get("groups") or [])
            if _normalize_generated_group_label((option or {}).get("label"))
        ],
        [
            {
                **dict(option or {}),
                "label": _normalize_generated_group_label((option or {}).get("label")),
                "value": build_smart_group_value(
                    _normalize_generated_group_label((option or {}).get("label"))
                ) if _normalize_generated_group_label((option or {}).get("label")) else "",
            }
            for option in (shared_snapshot.get("group_options") or [])
            if _normalize_generated_group_label((option or {}).get("label"))
        ],
    )
    shared_snapshot["group_options"] = shared_options
    shared_snapshot["signal_group_labels"] = _normalize_signal_group_labels(
        {
            **dict(vault_shared_groups.get("signal_group_labels") or {}),
            **dict(shared_snapshot.get("signal_group_labels") or {}),
        }
    )
    normalized_saved_catalog = {}
    for key, item in dict(vault_shared_profiles.get("creator_catalog") or {}).items():
        normalized_labels = unique_strings(
            [
                _normalize_generated_group_label(label)
                for label in (item.get("smart_group_labels") or [])
                if _normalize_generated_group_label(label)
            ],
            limit=4,
        )
        normalized_saved_catalog[key] = {
            **dict(item or {}),
            "smart_group_labels": normalized_labels,
            "smart_groups": [build_smart_group_value(label) for label in normalized_labels],
        }
    shared_snapshot["creator_catalog"] = {
        **normalized_saved_catalog,
        **dict(shared_snapshot.get("creator_catalog") or {}),
    }

    modules = effective_prefs.setdefault("modules", {})
    saved_profiles = dict(vault_shared_profiles.get("profiles") or {})
    for module_id, platform in (
        ("xiaohongshu-tracker", "xiaohongshu"),
        ("bilibili-tracker", "bilibili"),
    ):
        module_prefs = dict(modules.get(module_id) or {})
        normalized_saved_profiles = {}
        for profile_id, profile in dict(saved_profiles.get(platform) or {}).items():
            normalized_labels = unique_strings(
                [
                    _normalize_generated_group_label(label)
                    for label in (profile.get("smart_group_labels") or [])
                    if _normalize_generated_group_label(label)
                ],
                limit=4,
            )
            normalized_saved_profiles[profile_id] = {
                **dict(profile or {}),
                "smart_group_labels": normalized_labels,
                "smart_groups": [
                    build_smart_group_value(label)
                    for label in normalized_labels
                ],
            }
        module_prefs["creator_profiles"] = merge_creator_profiles(
            normalized_saved_profiles,
            dict(module_prefs.get("creator_profiles") or {}),
            shared_options,
        )
        module_prefs["creator_group_options"] = merge_shared_group_options(
            shared_options,
            module_prefs.get("creator_group_options") or [],
        )
        modules[module_id] = module_prefs

    return effective_prefs


def _update_shared_grouping_snapshot(
    prefs: dict,
    *,
    shared_group_options: list[dict],
    shared_catalog: dict[str, dict],
    signal_group_labels: dict[str, object],
    creator_lookup: dict[str, dict[str, str]] | None = None,
    vault_signal_database: dict | None = None,
    shared_data_paths: dict[str, str] | None = None,
) -> None:
    snapshot = prefs.setdefault("shared_creator_grouping", {})
    existing_catalog = dict(snapshot.get("creator_catalog") or {})
    merged_catalog = {**existing_catalog, **shared_catalog}
    existing_signal_group_labels = dict(snapshot.get("signal_group_labels") or {})
    existing_lookup = dict(snapshot.get("creator_lookup") or {})
    merged_lookup = _merge_shared_creator_lookup_maps(existing_lookup, creator_lookup or {})

    for item in merged_catalog.values():
        platform = str(item.get("platform") or "").strip()
        author_id = str(item.get("author_id") or "").strip()
        if not author_id:
            continue
        author_names = unique_strings(
            [
                item.get("author"),
                item.get("matched_author"),
                *(item.get("author_names") or []),
            ],
            limit=6,
        )
        if platform == "xiaohongshu":
            for name in author_names:
                normalized_name = normalize_creator_name_key(name)
                if normalized_name:
                    merged_lookup["xiaohongshu_author_ids"][normalized_name] = author_id
            continue

        if platform != "bilibili":
            continue

        for name in author_names:
            normalized_name = normalize_creator_name_key(name)
            if normalized_name:
                merged_lookup["bilibili_author_ids"][normalized_name] = author_id
        for oid in unique_strings(item.get("sample_oids") or [], limit=12):
            normalized_oid = str(oid or "").strip()
            if normalized_oid:
                merged_lookup["bilibili_oids"][normalized_oid] = author_id

    snapshot["group_options"] = shared_group_options
    snapshot["creator_catalog"] = merged_catalog
    snapshot["signal_group_labels"] = _normalize_signal_group_labels(
        {**existing_signal_group_labels, **signal_group_labels}
    )
    snapshot["creator_lookup"] = merged_lookup
    if vault_signal_database is not None:
        snapshot["vault_signal_database"] = dict(vault_signal_database or {})
    if shared_data_paths is not None:
        snapshot["shared_data_paths"] = dict(shared_data_paths or {})
    snapshot["updated_at"] = datetime.utcnow().isoformat()
    snapshot["catalog_count"] = len(merged_catalog)
    snapshot["platform_counts"] = {
        "xiaohongshu": sum(1 for item in merged_catalog.values() if item.get("platform") == "xiaohongshu"),
        "bilibili": sum(1 for item in merged_catalog.values() if item.get("platform") == "bilibili"),
    }


def _describe_vault_signal_database_status(vault_signal_database: dict | None) -> str:
    payload = dict(vault_signal_database or {})
    indexed_files = int(payload.get("indexed_files") or 0)
    signal_count = int(payload.get("signal_count") or 0)
    build_mode = str(payload.get("build_mode") or "").strip().lower()
    if build_mode == "incremental":
        return (
            f"标签库增量维护：复用 {int(payload.get('reused_files') or 0)} 篇，"
            f"新增 {int(payload.get('new_files') or 0)} 篇，"
            f"更新 {int(payload.get('updated_files') or 0)} 篇，"
            f"移除 {int(payload.get('removed_files') or 0)} 篇；"
            f"当前共 {indexed_files} 篇带标签笔记、{signal_count} 个原始标签。"
        )
    return f"首次全库扫描 {indexed_files} 篇带标签笔记，整理出 {signal_count} 个原始标签。"


async def _build_shared_creator_grouping_bundle(
    *,
    prefs: dict,
    xhs_authors: list[dict],
    bilibili_candidates: list[dict],
    vault_path: str | Path | None = None,
    bilibili_sessdata: str | None = None,
    bilibili_followed_ups: list[dict] | None = None,
    include_bilibili_recent_fetch: bool = False,
    progress_callback=None,
) -> dict:
    def emit_progress(stage: str, progress: int, **extra) -> None:
        if not progress_callback:
            return
        progress_callback(
            {
                "stage": stage,
                "progress": progress,
                **extra,
            }
        )

    effective_prefs = _build_effective_shared_grouping_prefs(prefs, vault_path=vault_path)
    creator_lookup = _build_shared_creator_lookup(effective_prefs)
    emit_progress("正在准备共享标签库", 48)
    vault_signal_database = save_vault_signal_database(
        vault_path,
        build_vault_signal_database(vault_path),
    )
    resolved_xhs_authors, xhs_lookup_resolved_count = _apply_shared_lookup_to_xhs_authors(xhs_authors, creator_lookup)
    resolved_bilibili_candidates, bilibili_lookup_resolved_count = _apply_shared_lookup_to_bilibili_candidates(
        bilibili_candidates,
        creator_lookup,
    )
    xhs_seed_map = _build_xhs_seed_map(effective_prefs, resolved_xhs_authors)
    bilibili_seed_map = _build_bilibili_seed_map(effective_prefs, resolved_bilibili_candidates)

    xhs_recent_fetch = _empty_recent_fetch_summary(
        skipped_reason="xiaohongshu-web-following-not-supported",
    )
    total_followed = len(bilibili_followed_ups or [])
    bilibili_recent_fetch = (
        await _augment_bilibili_seeds_with_followed_recent(
            bilibili_seed_map,
            sessdata=bilibili_sessdata,
            followed_ups=bilibili_followed_ups,
            progress_callback=lambda payload: emit_progress(
                str(payload.get("stage") or "正在补充全部 UP 最近内容"),
                _map_progress_percent(payload.get("progress"), 50, 66),
                total_followed_count=int(payload.get("total_followed_count") or total_followed),
                processed_followed_count=int(payload.get("processed_followed_count") or 0),
                current_followed_name=str(payload.get("current_followed_name") or "").strip(),
                recent_fetched_count=int(payload.get("recent_fetched_count") or 0),
            ),
        )
        if include_bilibili_recent_fetch and bilibili_sessdata
        else _empty_recent_fetch_summary(
            skipped_reason="bilibili-followed-recent-disabled",
        )
    )

    xhs_entries = _build_xhs_tag_grouping_entries(list(xhs_seed_map.values()))
    bilibili_entries = _build_bilibili_tag_grouping_entries(list(bilibili_seed_map.values()))
    combined_entries = [*xhs_entries, *bilibili_entries]
    emit_progress(
        f"正在生成共享分类（共 {len(combined_entries)} 位跨平台作者）",
        68,
        total_followed_count=max(total_followed, len(bilibili_entries)),
        processed_followed_count=0,
    )
    existing_signal_group_labels = _normalize_signal_group_labels(
        dict((effective_prefs.get("shared_creator_grouping", {}) or {}).get("signal_group_labels") or {})
    )
    rule_based_signal_group_labels = _normalize_signal_group_labels(
        _build_rule_based_signal_group_labels(
            combined_entries,
            vault_signal_database=vault_signal_database,
        )
    )
    ai_prefs = {
        **effective_prefs,
        "shared_creator_grouping": {
            **dict((effective_prefs.get("shared_creator_grouping", {}) or {})),
            "vault_signal_database": vault_signal_database,
        },
    }
    ai_signal_group_labels = _normalize_signal_group_labels(
        await _suggest_ai_signal_group_labels(combined_entries, ai_prefs) if combined_entries else {}
    )
    emit_progress("正在细化共享分类", 72)
    fallback_signal_group_labels = _normalize_signal_group_labels(
        _build_frequency_tag_group_labels(
            combined_entries,
            vault_signal_database,
            max_groups=12,
        )
    )
    signal_group_labels = _normalize_signal_group_labels(
        {
            **fallback_signal_group_labels,
            **rule_based_signal_group_labels,
            **ai_signal_group_labels,
            **existing_signal_group_labels,
        }
    )
    refinement_result = await _refine_tag_group_labels_iteratively(
        entries=combined_entries,
        prefs=ai_prefs,
        vault_signal_database=vault_signal_database,
        signal_group_labels=signal_group_labels,
    )
    signal_group_labels = _normalize_signal_group_labels(refinement_result["signal_group_labels"] or signal_group_labels)
    group_options = list(refinement_result["group_options"] or [])
    emit_progress(
        f"已得到 {len(group_options)} 个共享分类，正在补齐待分组作者",
        78,
        total_groups=len(group_options),
        total_followed_count=max(total_followed, len(bilibili_entries)),
        processed_followed_count=0,
    )
    ai_pending_author_assignments = await _suggest_ai_pending_author_group_assignments(
        entries=combined_entries,
        group_options=group_options,
    )
    group_options = _apply_ai_pending_author_assignments(
        combined_entries,
        group_options,
        ai_pending_author_assignments,
    )
    second_pass_pending_assignments: dict[str, list[str]] = {}
    if _count_pending_entries(combined_entries) > 0:
        second_pass_pending_assignments = await _suggest_ai_pending_author_group_assignments(
            entries=combined_entries,
            group_options=group_options,
            batch_size=40,
        )
        group_options = _apply_ai_pending_author_assignments(
            combined_entries,
            group_options,
            second_pass_pending_assignments,
        )
    shared_catalog = _build_shared_creator_catalog(combined_entries)

    xhs_profiles, xhs_skipped = _build_xhs_profiles_from_entries(xhs_entries)
    bilibili_profiles, bilibili_skipped = await _build_bilibili_profiles_from_entries(
        bilibili_entries,
        progress_callback=emit_progress,
        progress_start=80,
        progress_end=95,
        total_groups=len(group_options),
    )
    emit_progress(
        "正在写入共享分组结果",
        96,
        total_groups=len(group_options),
        total_followed_count=max(total_followed, len(bilibili_entries)),
        processed_followed_count=len(bilibili_profiles),
    )
    shared_data_paths = save_vault_shared_group_artifacts(
        vault_path,
        group_options=group_options,
        signal_group_labels=signal_group_labels,
        creator_profiles={
            "xiaohongshu": xhs_profiles,
            "bilibili": bilibili_profiles,
        },
        creator_catalog=shared_catalog,
    )
    return {
        "combined_entries": combined_entries,
        "vault_signal_database": vault_signal_database,
        "shared_data_paths": shared_data_paths,
        "group_options": group_options,
        "signal_group_labels": signal_group_labels,
        "fallback_signal_group_labels": fallback_signal_group_labels,
        "rule_based_signal_group_labels": rule_based_signal_group_labels,
        "ai_signal_group_labels": ai_signal_group_labels,
        "ai_refined_signal_group_labels": refinement_result.get("ai_refined_signal_group_labels") or {},
        "group_refinement_iterations": refinement_result.get("iteration_summaries") or [],
        "ai_pending_author_assignment_count": len(
            {
                **ai_pending_author_assignments,
                **second_pass_pending_assignments,
            }
        ),
        "shared_catalog": shared_catalog,
        "creator_lookup": creator_lookup,
        "xhs_profiles": xhs_profiles,
        "xhs_skipped": xhs_skipped,
        "bilibili_profiles": bilibili_profiles,
        "bilibili_skipped": bilibili_skipped,
        "xhs_entry_count": len(xhs_entries),
        "bilibili_entry_count": len(bilibili_entries),
        "xhs_seed_count": len(xhs_seed_map),
        "bilibili_seed_count": len(bilibili_seed_map),
        "xhs_lookup_resolved_count": xhs_lookup_resolved_count,
        "bilibili_lookup_resolved_count": bilibili_lookup_resolved_count,
        "xhs_recent_fetch": xhs_recent_fetch,
        "bilibili_recent_fetch": bilibili_recent_fetch,
    }


async def _build_shared_creator_assignment_bundle(
    *,
    prefs: dict,
    xhs_authors: list[dict],
    bilibili_candidates: list[dict],
    vault_path: str | Path | None = None,
    bilibili_sessdata: str | None = None,
    bilibili_followed_ups: list[dict] | None = None,
    include_bilibili_recent_fetch: bool = False,
    progress_callback=None,
) -> dict:
    def emit_progress(stage: str, progress: int, **extra) -> None:
        if not progress_callback:
            return
        progress_callback(
            {
                "stage": stage,
                "progress": progress,
                **extra,
            }
        )

    effective_prefs = _build_effective_shared_grouping_prefs(prefs, vault_path=vault_path)
    shared_grouping = dict((effective_prefs.get("shared_creator_grouping", {}) or {}))
    creator_lookup = _build_shared_creator_lookup(effective_prefs)
    signal_group_labels = _normalize_signal_group_labels(shared_grouping.get("signal_group_labels") or {})
    saved_group_options = merge_shared_group_options(
        shared_grouping.get("group_options") or [],
        (((effective_prefs.get("modules") or {}).get("xiaohongshu-tracker") or {}).get("creator_group_options") or []),
        (((effective_prefs.get("modules") or {}).get("bilibili-tracker") or {}).get("creator_group_options") or []),
    )
    if not signal_group_labels or not saved_group_options:
        raise ValueError("还没有可复用的共享组规则，请先执行一次“共享智能分组”。")

    emit_progress(
        f"正在复用已有 {len(saved_group_options)} 个共享分类",
        48,
        total_groups=len(saved_group_options),
    )
    resolved_xhs_authors, xhs_lookup_resolved_count = _apply_shared_lookup_to_xhs_authors(xhs_authors, creator_lookup)
    resolved_bilibili_candidates, bilibili_lookup_resolved_count = _apply_shared_lookup_to_bilibili_candidates(
        bilibili_candidates,
        creator_lookup,
    )
    xhs_seed_map = _build_xhs_seed_map(effective_prefs, resolved_xhs_authors)
    bilibili_seed_map = _build_bilibili_seed_map(effective_prefs, resolved_bilibili_candidates)

    xhs_recent_fetch = _empty_recent_fetch_summary(
        skipped_reason="xiaohongshu-web-following-not-supported",
    )
    total_followed = len(bilibili_followed_ups or [])
    bilibili_recent_fetch = (
        await _augment_bilibili_seeds_with_followed_recent(
            bilibili_seed_map,
            sessdata=bilibili_sessdata,
            followed_ups=bilibili_followed_ups,
            progress_callback=lambda payload: emit_progress(
                str(payload.get("stage") or "正在补充全部 UP 最近内容"),
                _map_progress_percent(payload.get("progress"), 52, 68),
                total_followed_count=int(payload.get("total_followed_count") or total_followed),
                processed_followed_count=int(payload.get("processed_followed_count") or 0),
                current_followed_name=str(payload.get("current_followed_name") or "").strip(),
                recent_fetched_count=int(payload.get("recent_fetched_count") or 0),
            ),
        )
        if include_bilibili_recent_fetch and bilibili_sessdata
        else _empty_recent_fetch_summary(
            skipped_reason="bilibili-followed-recent-disabled",
        )
    )

    xhs_entries = _build_xhs_tag_grouping_entries(list(xhs_seed_map.values()))
    bilibili_entries = _build_bilibili_tag_grouping_entries(list(bilibili_seed_map.values()))
    combined_entries = [*xhs_entries, *bilibili_entries]
    emit_progress(
        f"正在按已有共享分类整理 {len(combined_entries)} 位跨平台作者",
        72,
        total_groups=len(saved_group_options),
        total_followed_count=max(total_followed, len(bilibili_entries)),
        processed_followed_count=0,
    )
    preserved_vault_signal_database = dict(shared_grouping.get("vault_signal_database") or {})
    group_options = _build_tag_group_options(
        combined_entries,
        signal_group_labels,
        vault_signal_database=preserved_vault_signal_database,
    )
    group_options = merge_shared_group_options(saved_group_options, group_options)
    group_options = _assign_entry_groups_by_tags(
        combined_entries,
        group_options,
        signal_group_labels,
        allow_context_groups=False,
    )
    emit_progress(
        f"已锁定 {len(group_options)} 个共享分类，正在写回作者归组",
        80,
        total_groups=len(group_options),
        total_followed_count=max(total_followed, len(bilibili_entries)),
        processed_followed_count=0,
    )
    shared_catalog = _build_shared_creator_catalog(combined_entries)
    xhs_profiles, xhs_skipped = _build_xhs_profiles_from_entries(xhs_entries)
    bilibili_profiles, bilibili_skipped = await _build_bilibili_profiles_from_entries(
        bilibili_entries,
        progress_callback=emit_progress,
        progress_start=82,
        progress_end=95,
        total_groups=len(group_options),
    )
    emit_progress(
        "正在保存作者归组结果",
        96,
        total_groups=len(group_options),
        total_followed_count=max(total_followed, len(bilibili_entries)),
        processed_followed_count=len(bilibili_profiles),
    )
    shared_data_paths = save_vault_shared_group_artifacts(
        vault_path,
        group_options=group_options,
        signal_group_labels=signal_group_labels,
        creator_profiles={
            "xiaohongshu": xhs_profiles,
            "bilibili": bilibili_profiles,
        },
        creator_catalog=shared_catalog,
    )
    return {
        "combined_entries": combined_entries,
        "vault_signal_database": preserved_vault_signal_database,
        "shared_data_paths": shared_data_paths,
        "group_options": group_options,
        "signal_group_labels": signal_group_labels,
        "fallback_signal_group_labels": {},
        "rule_based_signal_group_labels": {},
        "ai_signal_group_labels": {},
        "ai_refined_signal_group_labels": {},
        "group_refinement_iterations": [],
        "ai_pending_author_assignment_count": 0,
        "shared_catalog": shared_catalog,
        "creator_lookup": creator_lookup,
        "xhs_profiles": xhs_profiles,
        "xhs_skipped": xhs_skipped,
        "bilibili_profiles": bilibili_profiles,
        "bilibili_skipped": bilibili_skipped,
        "xhs_entry_count": len(xhs_entries),
        "bilibili_entry_count": len(bilibili_entries),
        "xhs_seed_count": len(xhs_seed_map),
        "bilibili_seed_count": len(bilibili_seed_map),
        "xhs_lookup_resolved_count": xhs_lookup_resolved_count,
        "bilibili_lookup_resolved_count": bilibili_lookup_resolved_count,
        "xhs_recent_fetch": xhs_recent_fetch,
        "bilibili_recent_fetch": bilibili_recent_fetch,
    }


async def _run_shared_creator_grouping_workflow(
    *,
    prefs: dict,
    subscription_store,
    vault_path: str | Path | None,
    xhs_cookie: str | None,
    bilibili_sessdata: str | None,
    bilibili_max_count: int = 5000,
    bilibili_progress_callback=None,
    workflow_mode: str = "full",
) -> dict:
    normalized_workflow_mode = "creator-only" if str(workflow_mode or "").strip() == "creator-only" else "full"

    def emit_bilibili_progress(stage: str, progress: int, **extra) -> None:
        if not bilibili_progress_callback:
            return
        bilibili_progress_callback(
            {
                "stage": stage,
                "progress": progress,
                **extra,
            }
        )

    emit_bilibili_progress(
        "正在扫描本地 xhs 作者映射" if normalized_workflow_mode == "full" else "正在准备仅整理博主 / UP",
        6,
    )
    xhs_result = await analyze_saved_xhs_authors(
        vault_path=vault_path,
        cookie=xhs_cookie,
        resolve_author_ids=bool(xhs_cookie),
        resolve_limit=0,
    )

    followed_result = {
        "total": 0,
        "groups": [],
        "ups": [],
    }
    if bilibili_sessdata:
        emit_bilibili_progress("正在收集全部 B站 UP 列表", 12)
        followed_result = await bilibili_fetch_followed_ups(
            sessdata=bilibili_sessdata,
            max_count=bilibili_max_count,
            progress_callback=lambda payload: emit_bilibili_progress(
                f"正在收集全部 B站 UP 列表 · {str(payload.get('stage') or '进行中')}",
                min(28, 12 + max(0, int(payload.get("current_page") or 0)) * 4),
                current_page=int(payload.get("current_page") or 0),
                page_size=int(payload.get("page_size") or 0),
                fetched_count=int(payload.get("fetched_count") or 0),
            ),
        )
        emit_bilibili_progress(
            f"已收集 {int(followed_result.get('total') or 0)} 个 B站 UP，正在分析本地内容标签",
            30,
            total_followed_count=int(followed_result.get("total") or 0),
            fetched_count=int(followed_result.get("total") or 0),
        )

    bilibili_result = await analyze_saved_bilibili_favorites(
        vault_path=vault_path,
        followed_ups=followed_result.get("ups") or [],
        progress_callback=lambda payload: emit_bilibili_progress(
            f"本地 B站内容分析 · {str(payload.get('stage') or '进行中')}",
            _map_progress_percent(payload.get("progress"), 32, 46),
            total_files=int(payload.get("total_files") or 0),
            processed_files=int(payload.get("processed_files") or 0),
            matched_followed_count=int(payload.get("matched_followed_count") or 0),
            total_groups=int(payload.get("total_groups") or 0),
        ),
    )

    existing_xhs_profiles = dict(
        (((prefs.get("modules") or {}).get("xiaohongshu-tracker") or {}).get("creator_profiles") or {})
    )
    existing_bilibili_profiles = dict(
        (((prefs.get("modules") or {}).get("bilibili-tracker") or {}).get("creator_profiles") or {})
    )
    already_grouped = bool(existing_xhs_profiles or existing_bilibili_profiles)

    if normalized_workflow_mode == "creator-only":
        emit_bilibili_progress("正在复用已有共享组规则整理博主 / UP", 46)
        shared_bundle = await _build_shared_creator_assignment_bundle(
            prefs=prefs,
            xhs_authors=xhs_result.get("candidates") or [],
            bilibili_candidates=bilibili_result.get("all_candidates") or [],
            vault_path=vault_path,
            bilibili_sessdata=bilibili_sessdata,
            bilibili_followed_ups=followed_result.get("ups") or [],
            include_bilibili_recent_fetch=bool(bilibili_sessdata),
            progress_callback=bilibili_progress_callback,
        )
    else:
        shared_bundle = await _build_shared_creator_grouping_bundle(
            prefs=prefs,
            xhs_authors=xhs_result.get("candidates") or [],
            bilibili_candidates=bilibili_result.get("all_candidates") or [],
            vault_path=vault_path,
            bilibili_sessdata=bilibili_sessdata,
            bilibili_followed_ups=followed_result.get("ups") or [],
            include_bilibili_recent_fetch=bool(bilibili_sessdata),
            progress_callback=bilibili_progress_callback,
        )
    emit_bilibili_progress(
        "正在同步共享分组到 B站监控",
        98,
        total_groups=len(shared_bundle.get("group_options") or []),
        total_followed_count=max(
            int(followed_result.get("total") or 0),
            int(shared_bundle.get("bilibili_seed_count") or 0),
        ),
        processed_followed_count=int(shared_bundle.get("bilibili_seed_count") or 0),
    )
    shared_group_options = sync_shared_creator_group_options(
        prefs,
        shared_bundle["group_options"],
        replace_existing=True,
    )
    xhs_sync = _sync_xhs_profiles_into_prefs(
        prefs=prefs,
        incoming_profiles=shared_bundle["xhs_profiles"],
        shared_group_options=shared_group_options,
        added_by="shared-smart-groups",
        subscription_store=subscription_store,
        skipped=shared_bundle["xhs_skipped"],
    )
    bilibili_sync = _sync_bilibili_profiles_into_prefs(
        prefs=prefs,
        incoming_profiles=shared_bundle["bilibili_profiles"],
        shared_group_options=shared_group_options,
        skipped=shared_bundle["bilibili_skipped"],
    )

    bilibili_module_prefs = prefs.setdefault("modules", {}).setdefault("bilibili-tracker", {})
    bilibili_module_prefs["favorite_up_uids"] = []
    bilibili_module_prefs["favorite_up_excluded_uids"] = []
    bilibili_module_prefs["favorite_up_profiles"] = {}

    _update_shared_grouping_snapshot(
        prefs,
        shared_group_options=shared_group_options,
        shared_catalog=shared_bundle["shared_catalog"],
        signal_group_labels=shared_bundle["signal_group_labels"],
        creator_lookup=_build_shared_creator_lookup(prefs),
        vault_signal_database=shared_bundle["vault_signal_database"],
        shared_data_paths=shared_bundle["shared_data_paths"],
    )

    total_user_ids = len((prefs.get("modules", {}).get("xiaohongshu-tracker", {}) or {}).get("user_ids", []))
    if normalized_workflow_mode == "creator-only":
        shared_message = (
            f"已复用现有 {len(shared_group_options)} 个共享组，仅重新整理 {len(shared_bundle['combined_entries'])} 位跨平台博主 / UP；"
            "这次不会重建共享标签库和共享组规则，只会按已保存映射回填作者归组。"
            "小红书作者仍只根据本地笔记映射；已登记且已有标签的作者不会重复补抓最近内容。"
        )
    else:
        shared_message = (
            f"{'在已有分组基础上增量更新' if already_grouped else '首次生成'} "
            f"{len(shared_bundle['combined_entries'])} 位跨平台作者的共享智能分组，共享 {len(shared_group_options)} 个组别；"
            f"{_describe_vault_signal_database_status(shared_bundle['vault_signal_database'])}"
            "小红书旧的“收藏反推博主”入口已并入共享智能分组，作者仅根据本地笔记映射，不再尝试网页关注列表；"
            "已登记且已有标签的作者不会重复补抓最近内容。"
        )

    return {
        "workflow_mode": normalized_workflow_mode,
        "already_grouped": already_grouped,
        "followed_result": followed_result,
        "xhs_result": xhs_result,
        "bilibili_result": bilibili_result,
        "shared_bundle": shared_bundle,
        "group_options": shared_group_options,
        "xhs_sync": xhs_sync,
        "bilibili_sync": bilibili_sync,
        "shared_result": {
            "success": True,
            "workflow_mode": normalized_workflow_mode,
            "message": shared_message,
            "xhs_dir": xhs_result.get("xhs_dir"),
            "bilibili_dir": bilibili_result.get("bilibili_dir"),
            "favorites_dir": bilibili_result.get("favorites_dir"),
            "xhs_candidates": xhs_result.get("candidates") or [],
            "xhs_candidate_message": str(xhs_result.get("message") or "").strip(),
            "total_notes": int(xhs_result.get("total_notes") or 0),
            "total_candidates": len(xhs_result.get("candidates") or []),
            "matched_creator_count": len(xhs_sync["incoming_profiles"]),
            "new_profile_count": len(xhs_sync["new_profile_ids"]),
            "updated_profile_count": len(xhs_sync["updated_profile_ids"]),
            "total_creator_count": len(xhs_sync["merged_profiles"]),
            "added_user_ids": xhs_sync["added_user_ids"],
            "total_user_ids": total_user_ids,
            "group_options": shared_group_options,
            "profiles": xhs_sync["merged_profiles"],
            "skipped": xhs_sync["skipped"],
            "shared_group_count": len(shared_group_options),
            "shared_catalog_count": len(shared_bundle["shared_catalog"]),
            "vault_signal_count": int((shared_bundle["vault_signal_database"] or {}).get("signal_count") or 0),
            "vault_indexed_file_count": int((shared_bundle["vault_signal_database"] or {}).get("indexed_files") or 0),
            "vault_new_file_count": int((shared_bundle["vault_signal_database"] or {}).get("new_files") or 0),
            "vault_updated_file_count": int((shared_bundle["vault_signal_database"] or {}).get("updated_files") or 0),
            "vault_removed_file_count": int((shared_bundle["vault_signal_database"] or {}).get("removed_files") or 0),
            "vault_reused_file_count": int((shared_bundle["vault_signal_database"] or {}).get("reused_files") or 0),
            "bilibili_candidate_count": int(bilibili_result.get("total_authors") or 0),
            "xhs_candidate_count": shared_bundle["xhs_entry_count"],
            "ai_signal_group_count": len(shared_bundle["ai_signal_group_labels"]),
            "ai_refined_signal_group_count": len(shared_bundle["ai_refined_signal_group_labels"]),
            "ai_pending_author_assignment_count": int(shared_bundle["ai_pending_author_assignment_count"] or 0),
            "fallback_signal_group_count": len(shared_bundle["fallback_signal_group_labels"]),
            "xhs_lookup_resolved_count": shared_bundle["xhs_lookup_resolved_count"],
            "bilibili_lookup_resolved_count": shared_bundle["bilibili_lookup_resolved_count"],
            "xhs_recent_fetch": shared_bundle["xhs_recent_fetch"],
            "bilibili_recent_fetch": shared_bundle["bilibili_recent_fetch"],
            "group_refinement_iterations": shared_bundle["group_refinement_iterations"],
            "shared_data_paths": shared_bundle["shared_data_paths"],
            "bilibili_profiles": bilibili_sync["merged_profiles"],
            "matched_followed_count": int(bilibili_result.get("matched_followed_count") or 0),
            "total_groups": len(shared_group_options),
            "total_files": int(bilibili_result.get("total_files") or 0),
            "processed_files": int(bilibili_result.get("total_files") or 0),
            "already_grouped": already_grouped,
        },
    }


def _sync_xhs_grouping_into_prefs(
    *,
    prefs: dict,
    authors: list[dict],
    added_by: str,
    subscription_store,
) -> dict:
    entries = _build_xhs_grouping_entries(authors)
    _merge_xhs_creator_name_map(prefs, authors, source=added_by)
    group_options = assign_dynamic_smart_groups(entries)
    incoming_profiles, skipped = _build_xhs_profiles_from_entries(entries)
    shared_group_options = sync_shared_creator_group_options(prefs, group_options)
    _update_shared_grouping_snapshot(
        prefs,
        shared_group_options=shared_group_options,
        shared_catalog=_build_shared_creator_catalog(entries),
        signal_group_labels={},
        creator_lookup=_build_shared_creator_lookup(prefs),
    )
    return _sync_xhs_profiles_into_prefs(
        prefs=prefs,
        incoming_profiles=incoming_profiles,
        shared_group_options=shared_group_options,
        added_by=added_by,
        subscription_store=subscription_store,
        skipped=skipped,
    )


def _merge_xhs_creator_name_map(
    prefs: dict,
    entries: list[dict] | None,
    *,
    source: str,
) -> dict[str, dict]:
    prefs.setdefault("modules", {})
    module_prefs = prefs["modules"].setdefault("xiaohongshu-tracker", {})
    current_map = dict(module_prefs.get("creator_name_map", {}) or {})
    now = datetime.utcnow().isoformat()
    for entry in entries or []:
        author = str(entry.get("author") or "").strip()
        author_id = str(entry.get("author_id") or "").strip()
        if not author or not author_id:
            continue
        key = normalize_creator_name_key(author) or author.lower()
        if not key:
            continue
        current_map[key] = {
            "author": author,
            "author_id": author_id,
            "profile_url": str(entry.get("profile_url") or "").strip(),
            "source": source,
            "updated_at": now,
        }
    module_prefs["creator_name_map"] = current_map
    return current_map


def _lookup_xhs_creator_id_from_map(prefs: dict, creator_query: str) -> dict | None:
    creator_query = str(creator_query or "").strip()
    if not creator_query:
        return None
    module_prefs = (prefs.get("modules", {}) or {}).get("xiaohongshu-tracker", {}) or {}
    creator_name_map = dict(module_prefs.get("creator_name_map", {}) or {})
    normalized_query = normalize_creator_name_key(creator_query) or creator_query.lower()
    direct = creator_name_map.get(normalized_query)
    if direct:
        return direct
    for value in creator_name_map.values():
        if not isinstance(value, dict):
            continue
        author = str(value.get("author") or "").strip()
        if author and normalized_query in (normalize_creator_name_key(author) or author.lower()):
            return value
    return None


def _mask_cookie_fields(payload: dict) -> dict:
    masked = {}
    for key, value in payload.items():
        if key == "cookie" and value:
            masked[key] = "<configured>"
        else:
            masked[key] = value
    return masked


def _summarize_xhs_task_input(kind: str, payload: dict) -> str:
    if kind == "search":
        sort_label = "综合排序" if str(payload.get("sort_by", "comprehensive")).strip().lower() == "comprehensive" else payload.get("sort_by", "comprehensive")
        return f"关键词扫描: {payload.get('keyword', '')} | 排序: {sort_label} | 最低点赞: {payload.get('min_likes', 0)}"
    if kind == "trends":
        return f"趋势关键词: {payload.get('keyword', '')}"
    if kind == "comments":
        return f"评论目标: {payload.get('note_id', '') or payload.get('note_url', '')} | 数量: {payload.get('max_comments', 50)}"
    if kind == "following-feed":
        return f"关注流扫描: {', '.join(payload.get('keywords', []))} | 上限: {payload.get('max_notes', 50)}"
    if kind == "following-creators":
        return f"已关注博主 | 上限: {payload.get('max_creators', 200)}"
    if kind == "creator-recent":
        return f"指定UP主: {payload.get('creator_query', '')} | 最近: {payload.get('recent_days', 180)}天 | 上限: {payload.get('max_notes', 20)}"
    if kind == "crawl-note":
        return f"单条入库: {payload.get('url', '')}"
    if kind == "crawl-batch":
        urls = payload.get("urls", [])
        return f"批量入库: {len(urls)} 条链接"
    if kind == "author-candidates":
        return f"作者候选分析 | 回查ID: {'开' if payload.get('resolve_author_ids', True) else '关'} | 限制: {payload.get('resolve_limit', 12)}"
    if kind == "smart-groups":
        mode_label = "仅整理博主 / UP" if str(payload.get("mode") or "").strip() == "creator-only" else "完整重建"
        return f"智能分组({mode_label}) | 回查ID: {'开' if payload.get('resolve_author_ids', True) else '关'} | 限制: {payload.get('resolve_limit', 12)}"
    return kind


def _create_xhs_task(kind: str, input_payload: dict | None = None) -> str:
    task_id = uuid.uuid4().hex
    safe_payload = _mask_cookie_fields(input_payload or {})
    _XHS_TASKS[task_id] = {
        "task_id": task_id,
        "kind": kind,
        "status": "running",
        "stage": "任务已创建",
        "can_cancel": False,
        "result": None,
        "error": None,
        "input": safe_payload,
        "input_summary": _summarize_xhs_task_input(kind, safe_payload),
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    _save_xhs_tasks()
    return task_id


def _update_xhs_task(task_id: str, **payload):
    if task_id in _XHS_TASKS:
        _XHS_TASKS[task_id].update(payload)
        _XHS_TASKS[task_id]["updated_at"] = datetime.utcnow().isoformat()
        _save_xhs_tasks()


def _save_xhs_tasks() -> None:
    _XHS_TASKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"tasks": list(_XHS_TASKS.values())[-200:]}
    tmp = _XHS_TASKS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, _XHS_TASKS_PATH)


def _load_xhs_tasks() -> None:
    if not _XHS_TASKS_PATH.exists():
        return
    try:
        data = json.loads(_XHS_TASKS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return
    tasks = data.get("tasks", [])
    for task in tasks[-200:]:
        if not isinstance(task, dict) or not task.get("task_id"):
            continue
        if task.get("status") == "running":
            task["status"] = "interrupted"
            task["stage"] = "应用重启后中断"
            task["error"] = task.get("error") or "后台进程已重启，未完成任务无法自动续跑"
            task["updated_at"] = datetime.utcnow().isoformat()
        _XHS_TASKS[str(task["task_id"])] = task


_load_xhs_tasks()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso_datetime(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except Exception:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _create_bilibili_task(kind: str, initial_payload: dict | None = None) -> str:
    task_id = uuid.uuid4().hex
    now = _utc_now_iso()
    _BILIBILI_TASKS[task_id] = {
        "task_id": task_id,
        "kind": kind,
        "status": "running",
        "stage": "任务已创建",
        "result": None,
        "error": None,
        "can_cancel": True,
        "auto_cancel_on_disconnect": True,
        "heartbeat_timeout_seconds": _BILIBILI_TASK_HEARTBEAT_TIMEOUT_SECONDS,
        "created_at": now,
        "updated_at": now,
        "heartbeat_at": now,
        **dict(initial_payload or {}),
    }
    return task_id


def _update_bilibili_task(task_id: str, **payload) -> None:
    task = _BILIBILI_TASKS.get(task_id)
    if not isinstance(task, dict):
        return
    task.update(payload)
    task["updated_at"] = _utc_now_iso()


def _touch_bilibili_task_heartbeat(task_id: str) -> None:
    task = _BILIBILI_TASKS.get(task_id)
    if not isinstance(task, dict):
        return
    status = str(task.get("status") or "")
    if status in _BILIBILI_TERMINAL_STATUSES:
        return
    task["heartbeat_at"] = _utc_now_iso()


def _cancel_bilibili_task(
    task_id: str,
    *,
    reason: str,
    stage: str = "前端已断开，正在停止后台任务",
) -> dict | None:
    task = _BILIBILI_TASKS.get(task_id)
    if not isinstance(task, dict):
        return None

    status = str(task.get("status") or "")
    if status in _BILIBILI_TERMINAL_STATUSES or status == "cancelling":
        return task

    _update_bilibili_task(
        task_id,
        status="cancelling",
        stage=stage,
        error=reason,
        can_cancel=False,
    )
    task["heartbeat_at"] = _utc_now_iso()

    running_task = _BILIBILI_ASYNC_TASKS.get(task_id)
    if running_task and not running_task.done():
        running_task.cancel()
    else:
        _update_bilibili_task(
            task_id,
            status="cancelled",
            stage="后台任务已停止",
            error=reason,
            can_cancel=False,
        )
    return task


async def _watch_bilibili_task_lease(task_id: str) -> None:
    while True:
        await asyncio.sleep(_BILIBILI_TASK_WATCHDOG_INTERVAL_SECONDS)
        task = _BILIBILI_TASKS.get(task_id)
        if not isinstance(task, dict):
            return

        status = str(task.get("status") or "")
        if status in _BILIBILI_TERMINAL_STATUSES or status == "cancelling":
            return
        if not task.get("auto_cancel_on_disconnect", True):
            continue

        heartbeat_at = _parse_iso_datetime(
            task.get("heartbeat_at") or task.get("created_at") or task.get("updated_at")
        )
        if heartbeat_at is None:
            continue
        timeout_seconds = max(
            5,
            int(task.get("heartbeat_timeout_seconds") or _BILIBILI_TASK_HEARTBEAT_TIMEOUT_SECONDS),
        )
        if (datetime.now(timezone.utc) - heartbeat_at).total_seconds() < timeout_seconds:
            continue

        _cancel_bilibili_task(
            task_id,
            reason=f"前端在 {timeout_seconds} 秒内未继续轮询，后台任务已自动停止",
        )
        return


def _spawn_bilibili_task(task_id: str, runner) -> None:
    async def wrapped() -> None:
        lease_task = asyncio.create_task(_watch_bilibili_task_lease(task_id))
        try:
            await runner()
        except asyncio.CancelledError:
            current = _BILIBILI_TASKS.get(task_id) or {}
            _update_bilibili_task(
                task_id,
                status="cancelled",
                stage="后台任务已停止",
                error=str(current.get("error") or "前端已断开，后台任务已停止"),
                can_cancel=False,
            )
        finally:
            lease_task.cancel()
            try:
                await lease_task
            except asyncio.CancelledError:
                pass
            _BILIBILI_ASYNC_TASKS.pop(task_id, None)

    _BILIBILI_ASYNC_TASKS[task_id] = asyncio.create_task(wrapped())


class SearchRequest(BaseModel):
    keyword: str
    max_results: int = 20
    min_likes: int = 100
    sort_by: str = "comprehensive"  # comprehensive, likes, time
    recent_days: Optional[int] = None
    cookie: Optional[str] = None  # 小红书登录 Cookie
    use_extension: bool = True
    extension_port: int = 9334
    dedicated_window_mode: bool = False


class CommentsRequest(BaseModel):
    note_id: str
    note_url: Optional[str] = None
    max_comments: int = 50
    sort_by: str = "likes"
    cookie: Optional[str] = None
    use_extension: bool = True
    extension_port: int = 9334
    dedicated_window_mode: bool = False
    load_all_comments: bool = True
    click_more_replies: bool = True
    max_replies_threshold: int = 10


class XHSCrawlNoteRequest(BaseModel):
    url: str
    cookie: Optional[str] = None
    include_images: bool = False
    include_video: bool = False
    include_live_photo: bool = False
    include_comments: bool = False
    include_sub_comments: bool = False
    comments_limit: int = 20
    use_extension: bool = True
    extension_port: int = 9334
    dedicated_window_mode: bool = False
    use_cdp: bool = True
    cdp_port: int = 9222
    vault_path: Optional[str] = None


class XHSCrawlBatchRequest(BaseModel):
    urls: list[str]
    cookie: Optional[str] = None
    include_images: bool = False
    include_video: bool = False
    include_live_photo: bool = False
    include_comments: bool = False
    include_sub_comments: bool = False
    comments_limit: int = 20
    use_extension: bool = True
    extension_port: int = 9334
    dedicated_window_mode: bool = False
    use_cdp: bool = True
    cdp_port: int = 9222
    vault_path: Optional[str] = None


class XHSSavePreviewNote(BaseModel):
    id: str = ""
    title: str = "无标题"
    content: str = ""
    author: str = "未知"
    author_id: str = ""
    likes: int = 0
    collects: int = 0
    comments_count: int = 0
    url: str = ""
    published_at: Optional[str] = None
    cover_image: Optional[str] = None
    note_type: Optional[str] = None
    images: list[str] = []
    video_url: Optional[str] = None
    xsec_token: str = ""
    xsec_source: str = ""


class XHSSavePreviewsRequest(BaseModel):
    notes: list[XHSSavePreviewNote]
    vault_path: Optional[str] = None
    subfolder: Optional[str] = None
    cookie: Optional[str] = None
    use_extension: bool = True
    extension_port: int = 9334
    dedicated_window_mode: bool = False
    use_cdp: bool = True
    cdp_port: int = 9222
    download_images_mode: str = "smart"
    save_strategy: str = "card"
    short_content_threshold: int = 120
    include_comments: bool = False
    comments_limit: int = 20
    comments_sort_by: str = "likes"


class XHSAlbumListRequest(BaseModel):
    cookie: Optional[str] = None
    cdp_port: int = 9222
    background: bool = True
    allow_cdp_fallback: bool = False
    use_extension: bool = True
    extension_port: int = 9334
    dedicated_window_mode: bool = False
    vault_path: Optional[str] = None


class XHSAlbumCrawlRequest(BaseModel):
    albums: list[dict]
    cookie: Optional[str] = None
    include_images: bool = False
    include_video: bool = False
    include_live_photo: bool = False
    include_comments: bool = False
    include_sub_comments: bool = False
    comments_limit: int = 20
    cdp_port: int = 9222
    max_notes_per_album: Optional[int] = None
    before_date: Optional[str] = None
    recent_days: Optional[int] = None
    crawl_mode: str = "incremental"
    crawl_delay_seconds: float = 12.0
    batch_size: Optional[int] = None
    batch_pause_seconds: float = 0.0
    use_extension: bool = True
    extension_port: int = 9334
    dedicated_window_mode: bool = False
    vault_path: Optional[str] = None


class XHSBrowserCookieRequest(BaseModel):
    browser: Optional[str] = None


class XHSAuthorCandidatesRequest(BaseModel):
    cookie: Optional[str] = None
    resolve_author_ids: bool = True
    resolve_limit: int = 0
    vault_path: Optional[str] = None
    mode: str = "full"


class XHSAuthorSyncRequest(BaseModel):
    authors: list[dict]


class TrendsRequest(BaseModel):
    keyword: str
    cookie: Optional[str] = None


class ZhihuSearchRequest(BaseModel):
    keyword: str
    max_results: int = 20
    min_votes: int = 100
    sort_by: str = "votes"  # votes, time
    cookie: Optional[str] = None


class ZhihuCommentsRequest(BaseModel):
    content_id: str
    max_comments: int = 50
    sort_by: str = "likes"


class ZhihuTrendsRequest(BaseModel):
    keyword: str


class ArxivAPISearchRequest(BaseModel):
    keywords: list[str] = []
    categories: Optional[list[str]] = None
    mode: str = "OR"
    max_results: int = 50
    days_back: Optional[int] = None
    sort_by: str = "submittedDate"
    sort_order: str = "descending"
    advanced: Optional[dict] = None


class ArxivAPISearchResponse(BaseModel):
    total: int
    papers: list[dict]
    query: str
    search_time_ms: float


@router.post("/xiaohongshu/search")
async def api_xiaohongshu_search(req: SearchRequest):
    """搜索小红书高赞内容"""
    from fastapi import HTTPException
    from abo.config import load as load_config
    try:
        result = await fetch_xhs_keyword_search_result(
            keyword=req.keyword,
            max_results=req.max_results,
            min_likes=req.min_likes,
            sort_by=req.sort_by,
            recent_days=req.recent_days,
            cookie=req.cookie or load_config().get("xiaohongshu_cookie"),
            use_extension=req.use_extension,
            extension_port=req.extension_port,
            dedicated_window_mode=req.dedicated_window_mode,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/xiaohongshu/config")
async def get_xiaohongshu_config():
    """获取小红书工具配置（从全局配置中读取）"""
    from abo.config import load as load_config
    config = load_config()
    return {
        "cookie_configured": bool(config.get("xiaohongshu_cookie")),
        "cookie_preview": config.get("xiaohongshu_cookie", "")[:50] + "..." if config.get("xiaohongshu_cookie") else None,
    }


class CookieConfig(BaseModel):
    cookie: str


class FollowingFeedRequest(BaseModel):
    cookie: Optional[str] = None
    keywords: list[str]
    max_notes: int = 50
    recent_days: int = 180
    sort_by: str = "time"
    use_extension: bool = True
    extension_port: int = 9334
    dedicated_window_mode: bool = False


class XHSCreatorRecentRequest(BaseModel):
    creator_query: str
    cookie: Optional[str] = None
    recent_days: int = 180
    max_notes: int = 20
    use_extension: bool = True
    extension_port: int = 9334
    dedicated_window_mode: bool = False
    manual_current_tab: bool = False
    require_extension_success: bool = False


@router.post("/xiaohongshu/following-feed")
async def api_xiaohongshu_following_feed(req: FollowingFeedRequest):
    """获取关注列表中匹配关键词的笔记"""
    from abo.config import load as load_config
    from abo.main import _prefs

    async def update_creator_mapping(entries: list[dict], source: str) -> None:
        prefs = _prefs.all_data()
        _merge_xhs_creator_name_map(prefs, entries, source=source)
        _prefs.update(prefs)

    return await fetch_xhs_following_feed_result(
        cookie=req.cookie or load_config().get("xiaohongshu_cookie"),
        keywords=req.keywords,
        max_notes=req.max_notes,
        recent_days=req.recent_days,
        sort_by=req.sort_by,
        use_extension=req.use_extension,
        extension_port=req.extension_port,
        dedicated_window_mode=req.dedicated_window_mode,
        update_creator_mapping=update_creator_mapping,
    )


@router.post("/xiaohongshu/creator-notes/start")
async def api_xiaohongshu_creator_notes_start(req: XHSCreatorRecentRequest):
    from abo.config import load as load_config
    from abo.main import _prefs
    import asyncio

    task_id = _create_xhs_task("creator-recent", req.model_dump())
    _update_xhs_task(task_id, can_cancel=True)

    async def runner():
        try:
            async with xhs_serial_task("指定 UP 主抓取", lambda stage: _update_xhs_task(task_id, stage=stage)):
                _update_xhs_task(task_id, stage="解析 UP 主并抓取最近动态")
                cookie = req.cookie or load_config().get("xiaohongshu_cookie")

                def lookup_creator_mapping(creator_query: str) -> dict | None:
                    return _lookup_xhs_creator_id_from_map(_prefs.all_data(), creator_query)

                async def update_creator_mapping(entries: list[dict], source: str) -> None:
                    prefs = _prefs.all_data()
                    _merge_xhs_creator_name_map(prefs, entries, source=source)
                    _prefs.update(prefs)

                result = await fetch_xhs_creator_recent_result(
                    creator_query=req.creator_query,
                    cookie=cookie,
                    recent_days=req.recent_days,
                    max_notes=req.max_notes,
                    use_extension=req.use_extension,
                    extension_port=req.extension_port,
                    dedicated_window_mode=req.dedicated_window_mode,
                    manual_current_tab=req.manual_current_tab,
                    require_extension_success=req.require_extension_success,
                    lookup_creator_mapping=lookup_creator_mapping,
                    update_creator_mapping=update_creator_mapping,
                )
                _update_xhs_task(task_id, status="completed", stage="指定 UP 主抓取完成", result=result, can_cancel=False)
        except asyncio.CancelledError:
            _update_xhs_task(task_id, status="cancelled", stage="已中断", can_cancel=False)
            raise
        except Exception as e:
            _update_xhs_task(task_id, status="failed", stage="指定 UP 主抓取失败", error=str(e), can_cancel=False)
        finally:
            _XHS_ASYNC_TASKS.pop(task_id, None)

    _XHS_ASYNC_TASKS[task_id] = asyncio.create_task(runner())
    return {"success": True, "task_id": task_id}

@router.post("/xiaohongshu/config")
async def set_xiaohongshu_config(config: CookieConfig):
    """保存小红书 Cookie 配置"""
    from abo.config import load as load_config, save as save_config
    existing = load_config()
    existing["xiaohongshu_cookie"] = config.cookie
    save_config(existing)
    return {
        "success": True,
        "cookie_configured": True,
        "cookie_preview": config.cookie[:50] + "..." if len(config.cookie) > 50 else config.cookie,
    }


@router.post("/xiaohongshu/config/from-browser")
async def get_cookie_from_browser(req: Optional[XHSBrowserCookieRequest] = Body(default=None)):
    """从本地浏览器自动获取小红书 Cookie。优先使用 CDP，失败再尝试系统浏览器 Cookie。"""
    async def get_cookies_from_cdp(port: int = 9222) -> list[dict]:
        import httpx
        import websockets

        async with httpx.AsyncClient(timeout=5) as client:
            version = (await client.get(f"http://127.0.0.1:{port}/json/version")).json()
        browser_ws = version.get("webSocketDebuggerUrl")
        if not browser_ws:
            raise RuntimeError("CDP 调试端口未返回 webSocketDebuggerUrl")

        async with websockets.connect(browser_ws, max_size=16 * 1024 * 1024) as ws:
            await ws.send(json.dumps({"id": 1, "method": "Storage.getCookies", "params": {}}))
            while True:
                data = json.loads(await ws.recv())
                if data.get("id") == 1:
                    cookies = data.get("result", {}).get("cookies", [])
                    break

        return [
            {
                "name": item.get("name"),
                "value": item.get("value"),
                "domain": item.get("domain"),
                "path": item.get("path", "/"),
            }
            for item in cookies
            if "xiaohongshu.com" in str(item.get("domain", ""))
        ]

    def get_default_browser_order(preferred: str | None = None) -> list[str]:
        import subprocess

        mapping = {
            "com.microsoft.edgemac": "edge",
            "com.google.chrome": "chrome",
            "com.apple.safari": "safari",
            "org.mozilla.firefox": "firefox",
            "com.brave.browser": "brave",
            "com.brave.Browser": "brave",
        }
        preferred_name = (preferred or "").strip().lower()
        order: list[str] = []
        if preferred_name and preferred_name not in {"default", "auto"}:
            order.append(preferred_name)
        try:
            bundle_id = subprocess.check_output(
                ["osascript", "-e", "id of app (path to default web browser)"],
                text=True,
                timeout=3,
            ).strip()
            default_name = mapping.get(bundle_id)
            if default_name:
                order.append(default_name)
        except Exception as e:
            errors.append(f"默认浏览器识别失败: {e}")

        for name in ["edge", "chrome", "chromium", "brave", "safari", "firefox", "opera"]:
            if name not in order:
                order.append(name)
        return order

    def get_cookies_from_browser_cookie3(preferred: str | None = None) -> tuple[list[dict], str]:
        import browser_cookie3

        cookie_list: list[dict] = []
        loaders = []
        for name in get_default_browser_order(preferred):
            loader = getattr(browser_cookie3, name, None)
            if loader:
                loaders.append((name, loader))

        seen: set[tuple[str, str, str]] = set()
        used_sources: list[str] = []
        for loader_name, loader in loaders:
            try:
                jar = loader(domain_name="xiaohongshu.com")
            except Exception as e:
                errors.append(f"{loader_name}: {e}")
                continue
            found_in_loader = 0
            for cookie in jar:
                key = (cookie.name, cookie.domain, cookie.path)
                if key in seen:
                    continue
                seen.add(key)
                found_in_loader += 1
                cookie_list.append(
                    {
                        "name": cookie.name,
                        "value": cookie.value,
                        "domain": cookie.domain,
                        "path": cookie.path,
                    }
                )
            if found_in_loader:
                used_sources.append(loader_name)
        return cookie_list, "默认浏览器" if used_sources else "浏览器 Cookie 库"

    def pick_cookie(cookie_list: list[dict], name: str) -> Optional[str]:
        for cookie in cookie_list:
            if cookie.get("name") == name:
                return cookie.get("value")
        return None

    errors: list[str] = []
    try:
        try:
            cookie_list = await get_cookies_from_cdp()
            source = "CDP 浏览器"
        except Exception as e:
            errors.append(f"CDP: {e}")
            cookie_list, source = get_cookies_from_browser_cookie3(req.browser if req else None)

        if not cookie_list:
            return {
                "success": False,
                "error": "未找到小红书 Cookie。请先在本机浏览器登录 xiaohongshu.com；如果要使用 CDP，请用 --remote-debugging-port=9222 启动浏览器。",
                "debug": errors,
            }

        cookie_json = json.dumps(cookie_list, ensure_ascii=False)
        from abo.config import load as load_config, save as save_config
        existing = load_config()
        existing["xiaohongshu_cookie"] = cookie_json
        save_config(existing)

        web_session = pick_cookie(cookie_list, "web_session")
        id_token = pick_cookie(cookie_list, "id_token")

        return {
            "success": True,
            "cookie_count": len(cookie_list),
            "cookie": cookie_json,
            "cookie_preview": cookie_json[:100] + "...",
            "web_session": web_session,
            "id_token": id_token,
            "source": source,
            "message": f"成功从{source}获取 {len(cookie_list)} 个 Cookie",
            "debug": errors,
        }

    except Exception as e:
        return {
            "success": False,
            "error": f"获取浏览器 Cookie 失败: {str(e)}",
            "debug": errors,
        }


@router.post("/xiaohongshu/comments")
async def api_xiaohongshu_comments(req: CommentsRequest):
    """获取笔记评论（按赞排序）"""
    from abo.config import load as load_config

    async with xhs_serial_task("评论抓取"):
        result = await xiaohongshu_fetch_comments(
            note_id=req.note_id,
            note_url=req.note_url,
            max_comments=req.max_comments,
            sort_by=req.sort_by,
            cookie=req.cookie or load_config().get("xiaohongshu_cookie"),
            use_extension=req.use_extension,
            extension_port=req.extension_port,
            dedicated_window_mode=req.dedicated_window_mode,
            load_all_comments=req.load_all_comments,
            click_more_replies=req.click_more_replies,
            max_replies_threshold=req.max_replies_threshold,
        )
    return result
@router.post("/xiaohongshu/crawl-note")
async def api_xiaohongshu_crawl_note(req: XHSCrawlNoteRequest):
    """抓取单条小红书笔记并保存到情报库 xhs/主动保存 文件夹。"""
    from fastapi import HTTPException
    from abo.config import get_vault_path, load as load_config

    config = load_config()
    cookie = req.cookie or config.get("xiaohongshu_cookie")
    vault_path = req.vault_path or (str(get_vault_path()) if get_vault_path() else None)
    try:
        async with xhs_serial_task("单条入库"):
            return await crawl_xhs_note_to_vault(
                req.url,
                cookie=cookie,
                vault_path=vault_path,
                include_images=req.include_images,
                include_video=req.include_video,
                include_live_photo=req.include_live_photo,
                include_comments=req.include_comments,
                include_sub_comments=req.include_sub_comments,
                comments_limit=req.comments_limit,
                use_extension=req.use_extension,
                extension_port=req.extension_port,
                dedicated_window_mode=req.dedicated_window_mode,
                use_cdp=req.use_cdp,
                cdp_port=req.cdp_port,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/xiaohongshu/crawl-batch")
async def api_xiaohongshu_crawl_batch(req: XHSCrawlBatchRequest):
    """批量抓取小红书笔记并保存到情报库 xhs/主动保存 文件夹。"""
    from abo.config import get_vault_path, load as load_config

    config = load_config()
    cookie = req.cookie or config.get("xiaohongshu_cookie")
    vault_path = req.vault_path or (str(get_vault_path()) if get_vault_path() else None)

    results = []
    for url in req.urls:
        clean = url.strip()
        if not clean:
            continue
        try:
            async with xhs_serial_task("批量入库"):
                result = await crawl_xhs_note_to_vault(
                    clean,
                    cookie=cookie,
                    vault_path=vault_path,
                    include_images=req.include_images,
                    include_video=req.include_video,
                    include_live_photo=req.include_live_photo,
                    include_comments=req.include_comments,
                    include_sub_comments=req.include_sub_comments,
                    comments_limit=req.comments_limit,
                    use_extension=req.use_extension,
                    extension_port=req.extension_port,
                    dedicated_window_mode=req.dedicated_window_mode,
                    use_cdp=req.use_cdp,
                    cdp_port=req.cdp_port,
                )
            results.append(result)
        except Exception as e:
            results.append({"success": False, "url": clean, "error": str(e)})

    return {
        "success": True,
        "total": len(results),
        "saved": sum(1 for item in results if item.get("success")),
        "failed": sum(1 for item in results if not item.get("success")),
        "results": results,
    }


def _xhs_preview_slug(text: str, fallback: str) -> str:
    import re

    clean = re.sub(r'[\\/:*?"<>|#\n\r\t]+', " ", text or "").strip()
    clean = re.sub(r"\s+", " ", clean)[:42].strip()
    return clean or fallback or "xhs-note"


def _xhs_preview_markdown(note: XHSSavePreviewNote) -> str:
    title = (note.title or "小红书笔记").strip()
    content = (note.content or "搜索预览未提供正文。").strip()
    date = (note.published_at or datetime.now().strftime("%Y-%m-%d")).split("T", 1)[0]
    images = [url for url in (note.images or []) if url]
    if note.cover_image and note.cover_image not in images:
        images.insert(0, note.cover_image)

    detail_lines = [
        f"原帖标题：{title}",
        "",
        content,
        "",
    ]
    for index, image_url in enumerate(images[:12], 1):
        detail_lines.append(f"![图{index}]({image_url})")
        detail_lines.append("")
    if note.video_url:
        detail_lines.append(f"[打开视频]({note.video_url})")
        detail_lines.append("")

    attr_lines = [
        f"- **来源**: 小红书 · {note.author or '未知'}",
        f"- **帖子ID**: {note.id or '未知'}",
        f"- **链接**: {note.url or '未知'}",
        f"- **日期**: {date}",
        f"- **类型**: {note.note_type or 'normal'}",
        f"- **互动**: {int(note.likes or 0)}赞 / {int(note.collects or 0)}收藏 / {int(note.comments_count or 0)}评论",
    ]
    if note.xsec_token:
        attr_lines.append(f"- **xsec_token**: {note.xsec_token}")
    if note.xsec_source:
        attr_lines.append(f"- **xsec_source**: {note.xsec_source}")

    def quote(lines: list[str]) -> str:
        return "\n".join([f"> {line}" if line else ">" for line in lines])

    parts = [
        f"# {title}",
        "",
        content.splitlines()[0][:160] if content else "已保存这条小红书搜索预览。",
        "",
        "**与我的关联：** 这条来自小红书搜索结果，已进入可检索的 Obsidian 流程。",
        "",
        "**值得深挖吗：** 先按搜索预览保留，后续需要完整正文时再执行详情抓取。",
        "",
        "> [!tip]- 详情",
        quote(detail_lines),
        "",
        "> [!quote]- 评论与点赞",
        quote([f"搜索预览显示：{int(note.likes or 0)}赞 / {int(note.collects or 0)}收藏 / {int(note.comments_count or 0)}评论。"]),
        "",
        "> [!info]- 笔记属性",
        quote(attr_lines),
        "",
    ]
    return "\n".join(parts).rstrip() + "\n"


def _should_download_preview_images(
    note: XHSSavePreviewNote,
    *,
    mode: str,
    threshold: int,
) -> bool:
    normalized_mode = (mode or "smart").strip().lower()
    if normalized_mode == "always":
        return bool(note.images or note.cover_image)
    if normalized_mode == "never":
        return False
    content = re.sub(r"\s+", "", note.content or "")
    return len(content) <= max(0, threshold) and bool(note.images or note.cover_image)


@router.post("/xiaohongshu/save-previews")
async def api_xiaohongshu_save_previews(req: XHSSavePreviewsRequest):
    """把搜索/关注结果按统一入库格式保存到情报库 xhs/主动保存。"""
    from abo.config import get_vault_path, load as load_config

    vault_path = Path(req.vault_path).expanduser() if req.vault_path else get_vault_path()
    if not vault_path:
        raise HTTPException(status_code=400, detail="未配置情报库路径，请先在设置或引导中选择情报库")

    config = load_config()
    cookie = req.cookie or config.get("xiaohongshu_cookie")
    xhs_dir = vault_path / "xhs"
    active_save_dir = xhs_dir / "主动保存"
    active_save_dir.mkdir(parents=True, exist_ok=True)

    results = []
    target_dir = str((active_save_dir / req.subfolder).resolve()) if req.subfolder else str(active_save_dir.resolve())
    for index, note in enumerate(req.notes, 1):
        note_payload = note.model_dump()
        include_images = _should_download_preview_images(
            note,
            mode=req.download_images_mode,
            threshold=req.short_content_threshold,
        )
        try:
            normalized_save_strategy = (req.save_strategy or "card").strip().lower()
            if note.url and normalized_save_strategy == "detail":
                async with xhs_serial_task("预览详情入库"):
                    result = await crawl_xhs_note_to_vault(
                        note.url,
                        cookie=cookie,
                        vault_path=vault_path,
                        include_images=include_images,
                        include_video=False,
                        include_live_photo=False,
                        include_comments=req.include_comments,
                        include_sub_comments=False,
                        comments_limit=max(1, req.comments_limit) if req.include_comments else 0,
                        comments_sort_by=req.comments_sort_by,
                        use_extension=req.use_extension,
                        extension_port=req.extension_port,
                        dedicated_window_mode=req.dedicated_window_mode,
                        use_cdp=req.use_cdp,
                        cdp_port=req.cdp_port,
                        subfolder=req.subfolder,
                        seed_data=note_payload,
                    )
            else:
                result = await save_xhs_seed_note_to_vault(
                    seed_data=note_payload,
                    vault_path=vault_path,
                    include_images=include_images,
                    include_video=False,
                    subfolder=req.subfolder,
                )
            target_dir = result.get("xhs_dir") or target_dir
            results.append(
                {
                    "success": True,
                    "note_id": result.get("note_id") or note.id,
                    "title": result.get("title") or note.title,
                    "markdown_path": result.get("markdown_path"),
                    "detail_strategy": result.get("detail_strategy"),
                    "warnings": result.get("warnings") or [],
                }
            )
        except Exception as exc:
            try:
                fallback = await save_xhs_seed_note_to_vault(
                    seed_data=note_payload,
                    vault_path=vault_path,
                    include_images=include_images,
                    include_video=False,
                    subfolder=req.subfolder,
                )
                target_dir = fallback.get("xhs_dir") or target_dir
                fallback_warnings = list(fallback.get("warnings") or [])
                fallback_warnings.insert(0, f"统一详情抓取失败，已回退为卡片摘要保存: {exc}")
                results.append(
                    {
                        "success": True,
                        "note_id": fallback.get("note_id") or note.id,
                        "title": fallback.get("title") or note.title,
                        "markdown_path": fallback.get("markdown_path"),
                        "detail_strategy": "seed_preview_fallback",
                        "warnings": fallback_warnings,
                    }
                )
            except Exception as fallback_exc:
                results.append({"success": False, "note_id": note.id, "title": note.title, "error": str(fallback_exc)})
        if index < len(req.notes):
            await asyncio.sleep(0.45)

    return {
        "success": True,
        "total": len(results),
        "saved": sum(1 for item in results if item.get("success")),
        "failed": sum(1 for item in results if not item.get("success")),
        "xhs_dir": target_dir,
        "results": results,
    }


@router.post("/xiaohongshu/albums")
async def api_xiaohongshu_albums(req: XHSAlbumListRequest):
    """列出小红书收藏专辑，并带上本地增量进度。"""
    from fastapi import HTTPException
    from abo.config import get_vault_path, load as load_config

    config = load_config()
    cookie = req.cookie or config.get("xiaohongshu_cookie")
    vault_path = req.vault_path or (str(get_vault_path()) if get_vault_path() else None)
    try:
        async with xhs_serial_task("收藏专辑列表"):
            return await list_xhs_album_previews(
                cookie=cookie,
                vault_path=vault_path,
                cdp_port=req.cdp_port,
                background=req.background,
                allow_cdp_fallback=req.allow_cdp_fallback,
                use_extension=req.use_extension,
                extension_port=req.extension_port,
                dedicated_window_mode=req.dedicated_window_mode,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@router.post("/xiaohongshu/albums/start")
async def api_xiaohongshu_albums_start(req: XHSAlbumListRequest):
    """后台启动收藏专辑发现任务。"""
    from abo.config import get_vault_path, load as load_config
    import asyncio

    config = load_config()
    cookie = req.cookie or config.get("xiaohongshu_cookie")
    vault_path = req.vault_path or (str(get_vault_path()) if get_vault_path() else None)
    task_id = uuid.uuid4().hex
    _XHS_ALBUM_TASKS[task_id] = {
        "task_id": task_id,
        "status": "running",
        "stage": "任务已创建",
        "albums_total": 0,
        "result": None,
        "error": None,
        "kind": "list",
        "can_cancel": True,
    }

    def update_progress(payload: dict):
        _XHS_ALBUM_TASKS[task_id].update(payload)

    async def runner():
        try:
            async with xhs_serial_task("收藏专辑列表", lambda stage: _XHS_ALBUM_TASKS[task_id].update({"stage": stage})):
                result = await list_xhs_album_previews(
                    cookie=cookie,
                    vault_path=vault_path,
                    cdp_port=req.cdp_port,
                    background=req.background,
                    allow_cdp_fallback=req.allow_cdp_fallback,
                    progress_callback=update_progress,
                    use_extension=req.use_extension,
                    extension_port=req.extension_port,
                    dedicated_window_mode=req.dedicated_window_mode,
                )
                _XHS_ALBUM_TASKS[task_id]["status"] = "completed"
                _XHS_ALBUM_TASKS[task_id]["stage"] = "专辑列表读取完成"
                _XHS_ALBUM_TASKS[task_id]["albums_total"] = result.get("total", 0)
                _XHS_ALBUM_TASKS[task_id]["result"] = result
                _XHS_ALBUM_TASKS[task_id]["can_cancel"] = False
        except asyncio.CancelledError:
            _XHS_ALBUM_TASKS[task_id]["status"] = "cancelled"
            _XHS_ALBUM_TASKS[task_id]["stage"] = "已中断"
            _XHS_ALBUM_TASKS[task_id]["can_cancel"] = False
        except Exception as e:
            _XHS_ALBUM_TASKS[task_id]["status"] = "failed"
            _XHS_ALBUM_TASKS[task_id]["stage"] = "读取失败"
            _XHS_ALBUM_TASKS[task_id]["error"] = str(e)
            _XHS_ALBUM_TASKS[task_id]["can_cancel"] = False
        finally:
            _XHS_ALBUM_ASYNC_TASKS.pop(task_id, None)

    _XHS_ALBUM_ASYNC_TASKS[task_id] = asyncio.create_task(runner())
    return {"success": True, "task_id": task_id}


@router.get("/xiaohongshu/albums/{task_id}")
async def api_xiaohongshu_albums_progress(task_id: str):
    task = _XHS_ALBUM_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.post("/xiaohongshu/albums/crawl")
async def api_xiaohongshu_albums_crawl(req: XHSAlbumCrawlRequest):
    """启动按选中的收藏专辑抓取任务。"""
    from abo.config import get_vault_path, load as load_config
    import asyncio

    config = load_config()
    cookie = req.cookie or config.get("xiaohongshu_cookie")
    vault_path = req.vault_path or (str(get_vault_path()) if get_vault_path() else None)
    task_id = uuid.uuid4().hex
    _XHS_ALBUM_TASKS[task_id] = {
        "task_id": task_id,
        "status": "running",
        "stage": "任务已创建",
        "saved": 0,
        "skipped": 0,
        "failed": 0,
        "total_albums": len(req.albums),
        "current_album": "",
        "current_album_index": 0,
        "current_note_index": 0,
        "total_notes": 0,
        "result": None,
        "error": None,
        "kind": "crawl",
        "can_cancel": True,
    }

    def update_progress(payload: dict):
        _XHS_ALBUM_TASKS[task_id].update(payload)

    async def runner():
        try:
            async with xhs_serial_task("收藏专辑抓取", lambda stage: _XHS_ALBUM_TASKS[task_id].update({"stage": stage})):
                result = await crawl_xhs_albums_incremental(
                    req.albums,
                    cookie=cookie,
                    vault_path=vault_path,
                    include_images=req.include_images,
                    include_video=req.include_video,
                    include_live_photo=req.include_live_photo,
                    include_comments=req.include_comments,
                    include_sub_comments=req.include_sub_comments,
                    comments_limit=req.comments_limit,
                    cdp_port=req.cdp_port,
                    max_notes_per_album=req.max_notes_per_album,
                    before_date=req.before_date,
                    recent_days=req.recent_days,
                    crawl_mode=req.crawl_mode,
                    crawl_delay_seconds=req.crawl_delay_seconds,
                    batch_size=req.batch_size,
                    batch_pause_seconds=req.batch_pause_seconds,
                    progress_callback=update_progress,
                    use_extension=req.use_extension,
                    extension_port=req.extension_port,
                    dedicated_window_mode=req.dedicated_window_mode,
                )
                _XHS_ALBUM_TASKS[task_id]["status"] = "completed"
                _XHS_ALBUM_TASKS[task_id]["stage"] = "全部完成"
                _XHS_ALBUM_TASKS[task_id]["result"] = result
                _XHS_ALBUM_TASKS[task_id]["can_cancel"] = False
        except asyncio.CancelledError:
            _XHS_ALBUM_TASKS[task_id]["status"] = "cancelled"
            _XHS_ALBUM_TASKS[task_id]["stage"] = "已中断"
            _XHS_ALBUM_TASKS[task_id]["can_cancel"] = False
        except Exception as e:
            _XHS_ALBUM_TASKS[task_id]["status"] = "failed"
            _XHS_ALBUM_TASKS[task_id]["error"] = str(e)
            _XHS_ALBUM_TASKS[task_id]["stage"] = "任务失败"
            _XHS_ALBUM_TASKS[task_id]["can_cancel"] = False
        finally:
            _XHS_ALBUM_ASYNC_TASKS.pop(task_id, None)

    _XHS_ALBUM_ASYNC_TASKS[task_id] = asyncio.create_task(runner())
    return {"success": True, "task_id": task_id}


@router.post("/xiaohongshu/albums/tasks/{task_id}/cancel")
async def api_xiaohongshu_album_task_cancel(task_id: str):
    task_state = _XHS_ALBUM_TASKS.get(task_id)
    if not task_state:
        raise HTTPException(status_code=404, detail="task not found")
    if task_state.get("status") not in {"running", "pending"}:
        return {"success": True, "status": task_state.get("status"), "message": "任务已经结束"}
    task_state["status"] = "cancelling"
    task_state["stage"] = "正在中断"
    task_state["can_cancel"] = False
    running_task = _XHS_ALBUM_ASYNC_TASKS.get(task_id)
    if running_task:
        running_task.cancel()
    return {"success": True, "status": "cancelling"}


@router.get("/xiaohongshu/albums/crawl/{task_id}")
async def api_xiaohongshu_albums_crawl_progress(task_id: str):
    task = _XHS_ALBUM_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.post("/xiaohongshu/authors/sync")
async def api_xiaohongshu_author_sync(req: XHSAuthorSyncRequest):
    """把作者候选同步到模块管理的小红书 user_ids 订阅。"""
    from abo.main import _prefs, _subscription_store

    prefs = _prefs.all_data()
    sync_result = _sync_xhs_grouping_into_prefs(
        prefs=prefs,
        authors=req.authors or [],
        added_by="xhs-author-sync",
        subscription_store=_subscription_store,
    )
    _prefs.update(prefs)

    return {
        "success": True,
        "added_count": len(sync_result["added_user_ids"]),
        "added_user_ids": sync_result["added_user_ids"],
        "total_user_ids": len((prefs.get("modules", {}).get("xiaohongshu-tracker", {}) or {}).get("user_ids", [])),
        "skipped": sync_result["skipped"],
        "creator_profiles": sync_result["merged_profiles"],
        "group_options": sync_result["group_options"],
    }


@router.get("/xiaohongshu/tasks/{task_id}")
async def api_xiaohongshu_task_progress(task_id: str):
    task = _XHS_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.post("/xiaohongshu/tasks/{task_id}/cancel")
async def api_xiaohongshu_task_cancel(task_id: str):
    task = _XHS_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    if not task.get("can_cancel"):
        raise HTTPException(status_code=400, detail="task cannot be cancelled")
    if task.get("status") not in {"running", "cancelling"}:
        raise HTTPException(status_code=400, detail="task is not running")

    task["status"] = "cancelling"
    task["stage"] = "正在中断"
    task["can_cancel"] = False
    _save_xhs_tasks()

    running_task = _XHS_ASYNC_TASKS.get(task_id)
    if running_task:
        running_task.cancel()
    return {"success": True, "status": "cancelling"}


@router.get("/xiaohongshu/tasks")
async def api_xiaohongshu_task_list(limit: int = 20):
    tasks = sorted(
        _XHS_TASKS.values(),
        key=lambda item: (item.get("updated_at") or item.get("created_at") or ""),
        reverse=True,
    )
    return {"tasks": tasks[: max(1, min(limit, 100))]}


@router.post("/xiaohongshu/search/start")
async def api_xiaohongshu_search_start(req: SearchRequest):
    from abo.config import load as load_config
    import asyncio

    task_id = _create_xhs_task("search", req.model_dump())

    async def runner():
        try:
            async with xhs_serial_task("关键词搜索", lambda stage: _update_xhs_task(task_id, stage=stage)):
                _update_xhs_task(task_id, stage="搜索小红书笔记")
                result = await fetch_xhs_keyword_search_result(
                    keyword=req.keyword,
                    max_results=req.max_results,
                    min_likes=req.min_likes,
                    sort_by=req.sort_by,
                    recent_days=req.recent_days,
                    cookie=req.cookie or load_config().get("xiaohongshu_cookie"),
                    use_extension=req.use_extension,
                    extension_port=req.extension_port,
                    dedicated_window_mode=req.dedicated_window_mode,
                )
                _update_xhs_task(task_id, status="completed", stage="搜索完成", result=result)
        except Exception as e:
            _update_xhs_task(task_id, status="failed", stage="搜索失败", error=str(e))

    asyncio.create_task(runner())
    return {"success": True, "task_id": task_id}


@router.post("/xiaohongshu/trends/start")
async def api_xiaohongshu_trends_start(req: TrendsRequest):
    from abo.config import load as load_config
    import asyncio

    task_id = _create_xhs_task("trends", req.model_dump())

    async def runner():
        try:
            async with xhs_serial_task("趋势分析", lambda stage: _update_xhs_task(task_id, stage=stage)):
                _update_xhs_task(task_id, stage="分析热门趋势")
                result = await xiaohongshu_analyze_trends(
                    keyword=req.keyword,
                    cookie=req.cookie or load_config().get("xiaohongshu_cookie"),
                )
                _update_xhs_task(task_id, status="completed", stage="趋势分析完成", result=result)
        except Exception as e:
            _update_xhs_task(task_id, status="failed", stage="趋势分析失败", error=str(e))

    asyncio.create_task(runner())
    return {"success": True, "task_id": task_id}


@router.post("/xiaohongshu/comments/start")
async def api_xiaohongshu_comments_start(req: CommentsRequest):
    from abo.config import load as load_config
    import asyncio

    task_id = _create_xhs_task("comments", req.model_dump())

    async def runner():
        try:
            async with xhs_serial_task("评论抓取", lambda stage: _update_xhs_task(task_id, stage=stage)):
                _update_xhs_task(task_id, stage="抓取评论")
                result = await xiaohongshu_fetch_comments(
                    note_id=req.note_id,
                    note_url=req.note_url,
                    max_comments=req.max_comments,
                    sort_by=req.sort_by,
                    cookie=req.cookie or load_config().get("xiaohongshu_cookie"),
                    use_extension=req.use_extension,
                    extension_port=req.extension_port,
                    dedicated_window_mode=req.dedicated_window_mode,
                    load_all_comments=req.load_all_comments,
                    click_more_replies=req.click_more_replies,
                    max_replies_threshold=req.max_replies_threshold,
                )
                _update_xhs_task(task_id, status="completed", stage="评论抓取完成", result=result)
        except Exception as e:
            _update_xhs_task(task_id, status="failed", stage="评论抓取失败", error=str(e))

    asyncio.create_task(runner())
    return {"success": True, "task_id": task_id}


@router.post("/xiaohongshu/following-feed/start")
async def api_xiaohongshu_following_feed_start(req: FollowingFeedRequest):
    from abo.config import load as load_config
    from abo.main import _prefs
    import asyncio

    task_id = _create_xhs_task("following-feed", req.model_dump())
    _update_xhs_task(task_id, can_cancel=True)

    async def runner():
        try:
            async with xhs_serial_task("关注流扫描", lambda stage: _update_xhs_task(task_id, stage=stage)):
                _update_xhs_task(task_id, stage="扫描关注流")

                async def update_creator_mapping(entries: list[dict], source: str) -> None:
                    prefs = _prefs.all_data()
                    _merge_xhs_creator_name_map(prefs, entries, source=source)
                    _prefs.update(prefs)

                result = await fetch_xhs_following_feed_result(
                    cookie=req.cookie or load_config().get("xiaohongshu_cookie"),
                    keywords=req.keywords,
                    max_notes=req.max_notes,
                    recent_days=req.recent_days,
                    sort_by=req.sort_by,
                    use_extension=req.use_extension,
                    extension_port=req.extension_port,
                    dedicated_window_mode=req.dedicated_window_mode,
                    update_creator_mapping=update_creator_mapping,
                )
                _update_xhs_task(task_id, status="completed", stage="关注流扫描完成", result=result, can_cancel=False)
        except asyncio.CancelledError:
            _update_xhs_task(task_id, status="cancelled", stage="已中断", can_cancel=False)
            raise
        except Exception as e:
            _update_xhs_task(task_id, status="failed", stage="关注流扫描失败", error=str(e), can_cancel=False)
        finally:
            _XHS_ASYNC_TASKS.pop(task_id, None)

    _XHS_ASYNC_TASKS[task_id] = asyncio.create_task(runner())
    return {"success": True, "task_id": task_id}


@router.post("/xiaohongshu/crawl-note/start")
async def api_xiaohongshu_crawl_note_start(req: XHSCrawlNoteRequest):
    from abo.config import get_vault_path, load as load_config
    import asyncio

    config = load_config()
    cookie = req.cookie or config.get("xiaohongshu_cookie")
    vault_path = req.vault_path or (str(get_vault_path()) if get_vault_path() else None)
    task_id = _create_xhs_task("crawl-note", req.model_dump())

    async def runner():
        try:
            async with xhs_serial_task("单条入库", lambda stage: _update_xhs_task(task_id, stage=stage)):
                _update_xhs_task(task_id, stage="保存单条笔记到 xhs/主动保存")
                result = await crawl_xhs_note_to_vault(
                    req.url,
                    cookie=cookie,
                    vault_path=vault_path,
                    include_images=req.include_images,
                    include_video=req.include_video,
                    include_live_photo=req.include_live_photo,
                    include_comments=req.include_comments,
                    include_sub_comments=req.include_sub_comments,
                    comments_limit=req.comments_limit,
                    use_extension=req.use_extension,
                    extension_port=req.extension_port,
                    dedicated_window_mode=req.dedicated_window_mode,
                    use_cdp=req.use_cdp,
                    cdp_port=req.cdp_port,
                )
                _update_xhs_task(task_id, status="completed", stage="单条入库完成", result=result)
        except Exception as e:
            _update_xhs_task(task_id, status="failed", stage="单条入库失败", error=str(e))

    asyncio.create_task(runner())
    return {"success": True, "task_id": task_id}


@router.post("/xiaohongshu/crawl-batch/start")
async def api_xiaohongshu_crawl_batch_start(req: XHSCrawlBatchRequest):
    from abo.config import get_vault_path, load as load_config
    import asyncio

    config = load_config()
    cookie = req.cookie or config.get("xiaohongshu_cookie")
    vault_path = req.vault_path or (str(get_vault_path()) if get_vault_path() else None)
    task_id = _create_xhs_task("crawl-batch", req.model_dump())

    async def runner():
        results: list[dict] = []
        saved = 0
        failed = 0
        total = len(req.urls)
        try:
            async with xhs_serial_task("批量入库", lambda stage: _update_xhs_task(task_id, stage=stage)):
                for index, url in enumerate(req.urls, 1):
                    _update_xhs_task(task_id, stage=f"批量入库 {index}/{total}", current=index, total=total)
                    try:
                        result = await crawl_xhs_note_to_vault(
                            url,
                            cookie=cookie,
                            vault_path=vault_path,
                            include_images=req.include_images,
                            include_video=req.include_video,
                            include_live_photo=req.include_live_photo,
                            include_comments=req.include_comments,
                            include_sub_comments=req.include_sub_comments,
                            comments_limit=req.comments_limit,
                            use_extension=req.use_extension,
                            extension_port=req.extension_port,
                            dedicated_window_mode=req.dedicated_window_mode,
                            use_cdp=req.use_cdp,
                            cdp_port=req.cdp_port,
                        )
                        results.append(result)
                        saved += 1
                    except Exception as item_error:
                        results.append({"success": False, "url": url, "error": str(item_error)})
                        failed += 1
                _update_xhs_task(task_id, status="completed", stage="批量入库完成", result={"success": True, "total": total, "saved": saved, "failed": failed, "results": results})
        except Exception as e:
            _update_xhs_task(task_id, status="failed", stage="批量入库失败", error=str(e))

    asyncio.create_task(runner())
    return {"success": True, "task_id": task_id}

@router.post("/xiaohongshu/authors/smart-groups/start")
async def api_xiaohongshu_author_smart_groups_start(req: XHSAuthorCandidatesRequest):
    from abo.config import get_vault_path, load as load_config
    from abo.main import _prefs, _subscription_store
    import asyncio

    config = load_config()
    vault_path = req.vault_path or (str(get_vault_path()) if get_vault_path() else None)
    task_id = _create_xhs_task("smart-groups", req.model_dump())

    async def runner():
        try:
            prefs = _prefs.all_data()
            bilibili_module_prefs = (prefs.get("modules", {}) or {}).get("bilibili-tracker", {}) or {}
            bilibili_sessdata = str(bilibili_module_prefs.get("sessdata") or "").strip()
            normalized_mode = "creator-only" if str(req.mode or "").strip() == "creator-only" else "full"
            _update_xhs_task(
                task_id,
                stage="扫描本地 xhs + B站数据并增量维护共享智能分组"
                if normalized_mode == "full"
                else "复用已有共享组规则，仅整理博主 / UP",
            )
            workflow = await _run_shared_creator_grouping_workflow(
                prefs=prefs,
                subscription_store=_subscription_store,
                vault_path=vault_path,
                xhs_cookie=req.cookie or config.get("xiaohongshu_cookie"),
                bilibili_sessdata=bilibili_sessdata,
                workflow_mode=normalized_mode,
            )
            _prefs.update(prefs)

            shared_result = dict(workflow.get("shared_result") or {})
            result = dict(workflow.get("xhs_result") or {})
            bilibili_result = dict(workflow.get("bilibili_result") or {})
            shared_bundle = dict(workflow.get("shared_bundle") or {})
            sync_result = dict(workflow.get("xhs_sync") or {})
            bilibili_sync = dict(workflow.get("bilibili_sync") or {})

            _update_xhs_task(
                task_id,
                status="completed",
                stage="共享智能分组完成",
                result={
                    **shared_result,
                    "xhs_dir": result.get("xhs_dir"),
                    "total_notes": int(result.get("total_notes") or 0),
                    "total_candidates": len(result.get("candidates") or []),
                    "matched_creator_count": len(sync_result.get("incoming_profiles") or {}),
                    "new_profile_count": len(sync_result.get("new_profile_ids") or []),
                    "updated_profile_count": len(sync_result.get("updated_profile_ids") or []),
                    "total_creator_count": len(sync_result.get("merged_profiles") or {}),
                    "shared_group_count": len(shared_result.get("group_options") or []),
                    "shared_catalog_count": len(shared_bundle.get("shared_catalog") or {}),
                    "bilibili_candidate_count": int(bilibili_result.get("total_authors") or 0),
                    "xhs_candidate_count": int(shared_bundle.get("xhs_entry_count") or 0),
                    "added_user_ids": sync_result.get("added_user_ids") or [],
                    "total_user_ids": int(shared_result.get("total_user_ids") or 0),
                    "already_grouped": bool(shared_result.get("already_grouped")),
                    "workflow_mode": shared_result.get("workflow_mode") or normalized_mode,
                    "group_options": shared_result.get("group_options") or [],
                    "profiles": sync_result.get("merged_profiles") or {},
                    "skipped": sync_result.get("skipped") or [],
                    "bilibili_profiles": bilibili_sync.get("merged_profiles") or {},
                },
            )
        except Exception as e:
            _update_xhs_task(task_id, status="failed", stage="共享智能分组失败", error=str(e))

    asyncio.create_task(runner())
    return {"success": True, "task_id": task_id}


@router.post("/xiaohongshu/trends")
async def api_xiaohongshu_trends(req: TrendsRequest):
    """分析小红书 Trends"""
    from abo.config import load as load_config
    result = await xiaohongshu_analyze_trends(
        keyword=req.keyword,
        cookie=req.cookie or load_config().get("xiaohongshu_cookie"),
    )
    return result


class XiaohongshuVerifyRequest(BaseModel):
    web_session: str
    id_token: Optional[str] = None


@router.post("/xiaohongshu/verify")
async def api_xiaohongshu_verify(req: XiaohongshuVerifyRequest):
    """验证小红书 web_session 是否有效"""
    result = await xiaohongshu_verify_cookie(req.web_session, req.id_token)
    return result


# ===== 哔哩哔哩工具 =====

class BilibiliFollowedRequest(BaseModel):
    sessdata: str
    keywords: list[str] = []
    tag_filters: list[str] = []
    author_ids: list[str] = []
    dynamic_types: list[int] = [8, 2, 4, 64]  # video, image, text, article
    limit: int = 20
    days_back: int = 7
    page_limit: int | None = None
    scan_cutoff_days: int | None = None
    monitor_label: str = ""
    monitor_subfolder: str = ""


class BilibiliDirectLinksRequest(BaseModel):
    sessdata: str
    urls: list[str] = []


class BilibiliFollowedUpsRequest(BaseModel):
    sessdata: str
    max_count: int = 5000


class BilibiliFollowedUpsCrawlRequest(BaseModel):
    sessdata: str
    max_count: int = 5000


class BilibiliSmartGroupRequest(BaseModel):
    sessdata: str
    vault_path: Optional[str] = None
    max_count: int = 5000
    mode: str = "full"


class BilibiliVerifyRequest(BaseModel):
    sessdata: str


class BilibiliCrawlVaultRequest(BaseModel):
    cookie: Optional[str] = None
    vault_path: Optional[str] = None
    include_dynamics: bool = True
    include_favorites: bool = True
    include_watch_later: bool = True
    dynamic_limit: int = 9
    favorite_folder_limit: int = 1
    favorite_item_limit: int = 3
    watch_later_limit: int = 3
    use_cdp: bool = True
    cdp_port: int = 9222


class BilibiliFavoriteFoldersRequest(BaseModel):
    cookie: Optional[str] = None
    use_cdp: bool = True
    cdp_port: int = 9222


class BilibiliFavoriteCrawlRequest(BaseModel):
    cookie: Optional[str] = None
    vault_path: Optional[str] = None
    folder_ids: list[str]
    crawl_mode: str = "incremental"
    item_limit: int = 20
    since_days: Optional[int] = None
    since_date: Optional[str] = None
    use_cdp: bool = True
    cdp_port: int = 9222


class BilibiliDynamicItem(BaseModel):
    id: str
    dynamic_id: str
    title: str
    content: str
    author: str
    author_id: str
    url: str
    published_at: Optional[str] = None
    dynamic_type: str
    pic: Optional[str] = None
    images: list[str] = []
    bvid: str = ""
    tags: list[str] = []
    matched_keywords: list[str] = []
    matched_tags: list[str] = []
    monitor_label: str = ""
    monitor_subfolder: str = ""
    crawl_source: str = ""
    crawl_source_label: str = ""


class BilibiliSelectedDynamicsSaveRequest(BaseModel):
    vault_path: Optional[str] = None
    dynamics: list[BilibiliDynamicItem]


@router.post("/bilibili/followed")
async def api_bilibili_followed(req: BilibiliFollowedRequest):
    """
    获取哔哩哔哩关注列表动态（带关键词过滤）

    - sessdata: B站登录 Cookie
    - keywords: 关键词过滤列表
    - dynamic_types: [8=视频, 2=图文, 4=文字, 64=专栏]
    - limit: 过滤后最多保留数量（上限 200，后端会按需扫描更多动态）
    - days_back: 只返回几天内的动态
    """
    result = await bilibili_fetch_followed(
        sessdata=req.sessdata,
        keywords=req.keywords if req.keywords else None,
        tag_filters=req.tag_filters if req.tag_filters else None,
        author_ids=req.author_ids if req.author_ids else None,
        dynamic_types=req.dynamic_types,
        limit=req.limit,
        days_back=req.days_back,
        page_limit=req.page_limit,
        scan_cutoff_days=req.scan_cutoff_days,
        monitor_label=req.monitor_label or None,
        monitor_subfolder=req.monitor_subfolder or None,
    )
    return result


@router.post("/bilibili/links")
async def api_bilibili_links(req: BilibiliDirectLinksRequest):
    """按给定 Bilibili 链接解析动态/视频/专栏预览，供前端复用统一卡片与入库链路。"""
    result = await bilibili_fetch_dynamics_by_urls(
        sessdata=req.sessdata,
        urls=req.urls,
    )
    return result


@router.post("/bilibili/followed/crawl")
async def api_bilibili_followed_crawl(req: BilibiliFollowedRequest):
    """后台抓取关注动态，并通过轮询返回最终结果。"""
    task_id = _create_bilibili_task(
        "followed-dynamics",
        {
            "pages_scanned": 0,
            "matched_count_before_keep": 0,
            "kept_count": 0,
            "total_found": 0,
        },
    )

    async def runner():
        try:
            _update_bilibili_task(task_id, stage="正在扫描关注动态")
            result = await bilibili_fetch_followed(
                sessdata=req.sessdata,
                keywords=req.keywords if req.keywords else None,
                tag_filters=req.tag_filters if req.tag_filters else None,
                author_ids=req.author_ids if req.author_ids else None,
                dynamic_types=req.dynamic_types,
                limit=req.limit,
                days_back=req.days_back,
                page_limit=req.page_limit,
                scan_cutoff_days=req.scan_cutoff_days,
                monitor_label=req.monitor_label or None,
                monitor_subfolder=req.monitor_subfolder or None,
            )
            fetch_stats = result.get("fetch_stats") or {}
            _update_bilibili_task(
                task_id,
                status="completed",
                stage="关注动态抓取完成",
                result=result,
                total_found=int(result.get("total_found") or 0),
                pages_scanned=int(fetch_stats.get("pages_scanned") or 0),
                matched_count_before_keep=int(fetch_stats.get("matched_count_before_keep") or 0),
                kept_count=len(result.get("dynamics") or []),
                can_cancel=False,
            )
        except Exception as e:
            _update_bilibili_task(
                task_id,
                status="failed",
                stage="关注动态抓取失败",
                error=str(e),
                can_cancel=False,
            )

    _spawn_bilibili_task(task_id, runner)
    return {"success": True, "task_id": task_id}


@router.get("/bilibili/followed/crawl/{task_id}")
async def api_bilibili_followed_crawl_progress(task_id: str):
    task = _BILIBILI_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    _touch_bilibili_task_heartbeat(task_id)
    return task


@router.post("/bilibili/followed-ups")
async def api_bilibili_followed_ups(req: BilibiliFollowedUpsRequest):
    """获取哔哩哔哩关注的 UP 列表。"""
    result = await bilibili_fetch_followed_ups(
        sessdata=req.sessdata,
        max_count=req.max_count,
    )
    return result


@router.post("/bilibili/followed-ups/crawl")
async def api_bilibili_followed_ups_crawl(req: BilibiliFollowedUpsCrawlRequest):
    """后台抓取关注 UP 列表，并返回分页进度。"""
    task_id = _create_bilibili_task(
        "followed-ups",
        {
            "current_page": 0,
            "page_size": 50,
            "fetched_count": 0,
        },
    )

    def update_progress(payload: dict):
        _update_bilibili_task(task_id, **payload)

    async def runner():
        try:
            result = await bilibili_fetch_followed_ups(
                sessdata=req.sessdata,
                max_count=req.max_count,
                progress_callback=update_progress,
            )
            _update_bilibili_task(
                task_id,
                status="completed",
                stage="关注列表抓取完成",
                result=result,
                can_cancel=False,
            )
        except Exception as e:
            _update_bilibili_task(
                task_id,
                status="failed",
                stage="关注列表抓取失败",
                error=str(e),
                can_cancel=False,
            )

    _spawn_bilibili_task(task_id, runner)
    return {"success": True, "task_id": task_id}


@router.get("/bilibili/followed-ups/crawl/{task_id}")
async def api_bilibili_followed_ups_crawl_progress(task_id: str):
    task = _BILIBILI_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    _touch_bilibili_task_heartbeat(task_id)
    return task


@router.post("/bilibili/followed-ups/smart-groups/start")
async def api_bilibili_followed_ups_smart_groups_start(req: BilibiliSmartGroupRequest):
    """增量维护跨平台共享智能分组，并同步两边作者。"""
    from abo.config import get_vault_path
    from abo.config import load as load_config
    from abo.main import _prefs, _subscription_store

    normalized_mode = "creator-only" if str(req.mode or "").strip() == "creator-only" else "full"
    task_id = _create_bilibili_task(
        "followed-up-smart-groups",
        {
            "workflow_mode": normalized_mode,
            "progress": 0,
            "total_files": 0,
            "processed_files": 0,
            "matched_followed_count": 0,
            "total_groups": 0,
            "total_followed_count": 0,
            "processed_followed_count": 0,
            "current_followed_name": "",
            "fetched_count": 0,
            "current_page": 0,
            "page_size": 0,
        },
    )
    vault_path = req.vault_path or (str(get_vault_path()) if get_vault_path() else None)

    def update_progress(payload: dict):
        _update_bilibili_task(task_id, **payload)

    async def runner():
        try:
            update_progress({
                "stage": "正在扫描本地 xhs + B站数据" if normalized_mode == "full" else "正在复用已有共享组规则",
                "progress": 4,
            })
            config = load_config()
            prefs = _prefs.all_data()
            workflow = await _run_shared_creator_grouping_workflow(
                prefs=prefs,
                subscription_store=_subscription_store,
                vault_path=vault_path,
                xhs_cookie=config.get("xiaohongshu_cookie"),
                bilibili_sessdata=req.sessdata,
                bilibili_max_count=req.max_count,
                bilibili_progress_callback=update_progress,
                workflow_mode=normalized_mode,
            )
            _prefs.update(prefs)

            shared_result = dict(workflow.get("shared_result") or {})
            result = dict(workflow.get("bilibili_result") or {})
            shared_bundle = dict(workflow.get("shared_bundle") or {})
            xhs_sync = dict(workflow.get("xhs_sync") or {})
            bilibili_sync = dict(workflow.get("bilibili_sync") or {})

            _update_bilibili_task(
                task_id,
                status="completed",
                stage="共享智能分组完成",
                progress=100,
                matched_followed_count=int(result.get("matched_followed_count") or 0),
                total_groups=len(shared_result.get("group_options") or []),
                total_followed_count=max(
                    int(workflow.get("followed_result", {}).get("total") or 0),
                    int(shared_bundle.get("bilibili_seed_count") or 0),
                ),
                processed_followed_count=int(shared_bundle.get("bilibili_seed_count") or 0),
                result={
                    **result,
                    **shared_result,
                    "workflow_mode": shared_result.get("workflow_mode") or normalized_mode,
                    "group_options": shared_result.get("group_options") or [],
                    "shared_group_options": shared_result.get("group_options") or [],
                    "shared_catalog_count": len(shared_bundle.get("shared_catalog") or {}),
                    "xhs_candidate_count": int(shared_bundle.get("xhs_entry_count") or 0),
                    "bilibili_candidate_count": int(shared_bundle.get("bilibili_entry_count") or 0),
                    "xhs_profiles": xhs_sync.get("merged_profiles") or {},
                    "profiles": bilibili_sync.get("merged_profiles") or {},
                },
                can_cancel=False,
            )
        except Exception as e:
            _update_bilibili_task(
                task_id,
                status="failed",
                stage="共享智能分组失败",
                error=str(e),
                can_cancel=False,
            )

    _spawn_bilibili_task(task_id, runner)
    return {"success": True, "task_id": task_id}


@router.get("/bilibili/followed-ups/smart-groups/{task_id}")
async def api_bilibili_followed_ups_smart_groups_progress(task_id: str):
    task = _BILIBILI_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    _touch_bilibili_task_heartbeat(task_id)
    return task


@router.post("/bilibili/tasks/{task_id}/cancel")
async def api_bilibili_task_cancel(task_id: str):
    task = _BILIBILI_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")

    status = str(task.get("status") or "")
    if status in _BILIBILI_TERMINAL_STATUSES or status == "cancelling":
        task["can_cancel"] = False
        return {"success": True, "status": status or "cancelled"}

    _cancel_bilibili_task(
        task_id,
        reason="前端已离开页面，后台任务已停止",
        stage="前端已离开页面，正在停止后台任务",
    )
    return {"success": True, "status": "cancelling"}


@router.post("/bilibili/verify")
async def api_bilibili_verify(req: BilibiliVerifyRequest):
    """验证 SESSDATA 是否有效"""
    result = await bilibili_verify_sessdata(req.sessdata)
    return result


@router.post("/bilibili/crawl-to-vault")
async def api_bilibili_crawl_to_vault(req: BilibiliCrawlVaultRequest):
    """抓取 Bilibili 动态、收藏夹、稍后再看到情报库 bilibili 文件夹。"""
    try:
        result = await crawl_bilibili_to_vault(
            cookie=req.cookie,
            vault_path=req.vault_path,
            include_dynamics=req.include_dynamics,
            include_favorites=req.include_favorites,
            include_watch_later=req.include_watch_later,
            dynamic_limit=req.dynamic_limit,
            favorite_folder_limit=req.favorite_folder_limit,
            favorite_item_limit=req.favorite_item_limit,
            watch_later_limit=req.watch_later_limit,
            use_cdp=req.use_cdp,
            cdp_port=req.cdp_port,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bilibili/dynamics/save-selected")
async def api_bilibili_save_selected_dynamics(req: BilibiliSelectedDynamicsSaveRequest):
    """把预览中勾选的 Bilibili 动态写入情报库。"""
    try:
        if not req.dynamics:
            raise HTTPException(status_code=400, detail="未选择任何动态")
        return await save_selected_dynamics_to_vault(
            [item.model_dump() for item in req.dynamics],
            vault_path=req.vault_path,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bilibili/favorites/folders")
async def api_bilibili_favorite_folders(req: BilibiliFavoriteFoldersRequest):
    """列出 Bilibili 收藏夹，并返回每个收藏夹第一个视频封面。"""
    try:
        cookie_header = await resolve_cookie_header(req.cookie, use_cdp=req.use_cdp, cdp_port=req.cdp_port)
        if "SESSDATA=" not in cookie_header:
            raise RuntimeError("未获取到 Bilibili SESSDATA，请先登录浏览器")
        verify = await verify_cookie_header(cookie_header)
        if not verify["valid"]:
            raise RuntimeError(f"Bilibili 登录态无效: {verify}")
        folders = await fetch_favorite_folder_previews(cookie_header, mid=verify["mid"])
        return {
            "success": True,
            "folders": folders,
            "folder_count": len(folders),
            "login": verify,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bilibili/favorites/folders/crawl")
async def api_bilibili_favorite_folders_crawl(req: BilibiliFavoriteFoldersRequest):
    """后台读取收藏栏预览，返回当前步骤与已处理数量。"""
    task_id = _create_bilibili_task(
        "favorite-folders",
        {
            "processed_folders": 0,
            "total_folders": 0,
            "current_folder": "",
        },
    )

    def update_progress(payload: dict):
        _update_bilibili_task(task_id, **payload)

    async def runner():
        try:
            cookie_header = await resolve_cookie_header(req.cookie, use_cdp=req.use_cdp, cdp_port=req.cdp_port)
            if "SESSDATA=" not in cookie_header:
                raise RuntimeError("未获取到 Bilibili SESSDATA，请先登录浏览器")
            verify = await verify_cookie_header(cookie_header)
            if not verify["valid"]:
                raise RuntimeError(f"Bilibili 登录态无效: {verify}")
            folders = await fetch_favorite_folder_previews(
                cookie_header,
                mid=verify["mid"],
                progress_callback=update_progress,
            )
            _update_bilibili_task(
                task_id,
                status="completed",
                stage="收藏栏预览读取完成",
                result={
                    "success": True,
                    "folders": folders,
                    "folder_count": len(folders),
                    "login": verify,
                },
                can_cancel=False,
            )
        except Exception as e:
            _update_bilibili_task(
                task_id,
                status="failed",
                stage="收藏栏预览读取失败",
                error=str(e),
                can_cancel=False,
            )

    _spawn_bilibili_task(task_id, runner)
    return {"success": True, "task_id": task_id}


@router.get("/bilibili/favorites/folders/crawl/{task_id}")
async def api_bilibili_favorite_folders_crawl_progress(task_id: str):
    task = _BILIBILI_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    _touch_bilibili_task_heartbeat(task_id)
    return task


@router.post("/bilibili/favorites/crawl")
async def api_bilibili_crawl_favorites(req: BilibiliFavoriteCrawlRequest):
    """按选中的收藏夹增量抓取，已记录的 BV/资源不会重复写入。"""
    try:
        result = await crawl_selected_favorites_to_vault(
            cookie=req.cookie,
            vault_path=req.vault_path,
            folder_ids=req.folder_ids,
            crawl_mode=req.crawl_mode,
            item_limit=req.item_limit,
            since_days=req.since_days,
            since_date=req.since_date,
            use_cdp=req.use_cdp,
            cdp_port=req.cdp_port,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bilibili/favorites/crawl/start")
async def api_bilibili_crawl_favorites_start(req: BilibiliFavoriteCrawlRequest):
    """后台增量抓取选中的收藏夹/稍后再看，并暴露进度。"""
    task_id = _create_bilibili_task(
        "favorite-crawl",
        {
            "selected_folder_count": len(req.folder_ids),
            "current_step": "init",
            "current_folder": "",
            "current_page": 0,
            "fetched_count": 0,
            "saved_count": 0,
            "skipped_count": 0,
        },
    )

    def update_progress(payload: dict):
        _update_bilibili_task(task_id, **payload)

    async def runner():
        try:
            result = await crawl_selected_favorites_to_vault(
                cookie=req.cookie,
                vault_path=req.vault_path,
                folder_ids=req.folder_ids,
                crawl_mode=req.crawl_mode,
                item_limit=req.item_limit,
                since_days=req.since_days,
                since_date=req.since_date,
                use_cdp=req.use_cdp,
                cdp_port=req.cdp_port,
                progress_callback=update_progress,
            )
            _update_bilibili_task(
                task_id,
                status="completed",
                stage="收藏内容入库完成",
                result=result,
                can_cancel=False,
            )
        except Exception as e:
            _update_bilibili_task(
                task_id,
                status="failed",
                stage="收藏内容入库失败",
                error=str(e),
                can_cancel=False,
            )

    _spawn_bilibili_task(task_id, runner)
    return {"success": True, "task_id": task_id}


@router.get("/bilibili/favorites/crawl/{task_id}")
async def api_bilibili_crawl_favorites_progress(task_id: str):
    task = _BILIBILI_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    _touch_bilibili_task_heartbeat(task_id)
    return task


@router.post("/bilibili/debug")
async def api_bilibili_debug(req: BilibiliVerifyRequest):
    """
    调试端点：直接测试 Bilibili API 并返回原始响应
    用于诊断为什么获取不到关注动态
    """
    import httpx

    DYNAMIC_API = "https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/dynamic_new"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": f"SESSDATA={req.sessdata}",
        "Referer": "https://t.bilibili.com/",
    }

    results = {}

    async with httpx.AsyncClient(timeout=30) as client:
        # 测试 1: type_list=8 (仅视频)
        try:
            resp1 = await client.get(DYNAMIC_API, params={"type_list": 8}, headers=headers)
            data1 = resp1.json()
            results["video_only"] = {
                "status_code": resp1.status_code,
                "code": data1.get("code"),
                "message": data1.get("message"),
                "cards_count": len(data1.get("data", {}).get("cards", [])),
            }
        except Exception as e:
            results["video_only"] = {"error": str(e)}

        # 测试 2: type_list=268435455 (全部)
        try:
            resp2 = await client.get(DYNAMIC_API, params={"type_list": 268435455}, headers=headers)
            data2 = resp2.json()
            cards = data2.get("data", {}).get("cards", [])
            results["all_types"] = {
                "status_code": resp2.status_code,
                "code": data2.get("code"),
                "message": data2.get("message"),
                "cards_count": len(cards),
                "first_card_types": [c.get("desc", {}).get("type") for c in cards[:5]],
            }
        except Exception as e:
            results["all_types"] = {"error": str(e)}

        # 测试 3: 无 type_list 参数
        try:
            resp3 = await client.get(DYNAMIC_API, headers=headers)
            data3 = resp3.json()
            results["no_params"] = {
                "status_code": resp3.status_code,
                "code": data3.get("code"),
                "message": data3.get("message"),
                "cards_count": len(data3.get("data", {}).get("cards", [])),
            }
        except Exception as e:
            results["no_params"] = {"error": str(e)}

    return {
        "sessdata_preview": req.sessdata[:20] + "..." if len(req.sessdata) > 20 else req.sessdata,
        "tests": results,
        "suggestions": [
            "如果所有测试都返回 0 卡片，可能是：",
            "1. SESSDATA 过期但 API 没有正确返回错误码",
            "2. 账号没有关注任何用户",
            "3. 关注用户最近没有发布动态",
            "4. API 端点或参数格式已更改",
            "5. 需要在 Cookie 中提供额外的验证字段（如 bili_jct）",
        ]
    }


@router.get("/bilibili/config")
async def get_bilibili_config():
    """获取哔哩哔哩工具配置（从全局配置中读取）"""
    from abo.config import load as load_config
    config = load_config()
    return {
        "cookie_configured": bool(config.get("bilibili_cookie")),
        "cookie_preview": config.get("bilibili_cookie", "")[:50] + "..." if config.get("bilibili_cookie") else None,
    }


@router.post("/bilibili/config")
async def set_bilibili_config(config: CookieConfig):
    """保存哔哩哔哩 Cookie 配置"""
    from abo.config import load as load_config, save as save_config
    existing = load_config()
    existing["bilibili_cookie"] = config.cookie
    save_config(existing)
    return {
        "success": True,
        "cookie_configured": True,
        "cookie_preview": config.cookie[:50] + "..." if len(config.cookie) > 50 else config.cookie,
    }


@router.post("/bilibili/config/from-browser")
async def get_bilibili_cookie_from_browser():
    """从本地浏览器读取哔哩哔哩 Cookie；优先现有 CDP，失败后扫描浏览器 Cookie。"""
    try:
        cookie_list = await export_bilibili_cookies_auto(port=9222, auto_launch_browser=False)

        if not cookie_list:
            return {
                "success": False,
                "error": "未找到哔哩哔哩 Cookie，请先登录 bilibili.com",
            }

        # 保存到配置
        from abo.config import load as load_config, save as save_config
        existing = load_config()
        existing["bilibili_cookie"] = json.dumps(cookie_list)
        save_config(existing)

        return {
            "success": True,
            "cookie_count": len(cookie_list),
            "cookie": json.dumps(cookie_list, ensure_ascii=False),
            "cookie_preview": json.dumps(cookie_list, ensure_ascii=False)[:100] + "...",
            "message": f"成功从本机浏览器获取 {len(cookie_list)} 个 Cookie",
        }

    except Exception as e:
        return {
            "success": False,
            "error": f"获取浏览器 Cookie 失败: {str(e)}",
        }


# === 知乎工具 API ===

@router.post("/zhihu/search")
async def api_zhihu_search(req: ZhihuSearchRequest):
    """搜索知乎高赞内容"""
    result = await zhihu_search(
        keyword=req.keyword,
        max_results=req.max_results,
        min_votes=req.min_votes,
        sort_by=req.sort_by,
        cookie=req.cookie,
    )
    return result


@router.get("/zhihu/config")
async def get_zhihu_config():
    """获取知乎工具配置"""
    from abo.config import load as load_config
    config = load_config()
    return {
        "cookie_configured": bool(config.get("zhihu_cookie")),
        "cookie_preview": config.get("zhihu_cookie", "")[:50] + "..." if config.get("zhihu_cookie") else None,
    }


@router.post("/zhihu/config")
async def set_zhihu_config(config: CookieConfig):
    """保存知乎 Cookie 配置"""
    from abo.config import load as load_config, save as save_config
    existing = load_config()
    existing["zhihu_cookie"] = config.cookie
    save_config(existing)
    return {
        "success": True,
        "cookie_configured": True,
        "cookie_preview": config.cookie[:50] + "..." if len(config.cookie) > 50 else config.cookie,
    }


@router.post("/zhihu/config/from-browser")
async def get_zhihu_cookie_from_browser():
    """从本地浏览器自动获取知乎 Cookie"""
    try:
        import browser_cookie3

        # 获取 Chrome 浏览器的 cookie
        cj = browser_cookie3.chrome(domain_name="zhihu.com")

        # 转换为列表格式
        cookie_list = []
        for cookie in cj:
            cookie_list.append({
                "name": cookie.name,
                "value": cookie.value,
                "domain": cookie.domain,
                "path": cookie.path,
            })

        if not cookie_list:
            return {
                "success": False,
                "error": "未找到知乎 Cookie，请先登录 zhihu.com",
            }

        # 保存到配置
        from abo.config import load as load_config, save as save_config
        existing = load_config()
        existing["zhihu_cookie"] = json.dumps(cookie_list)
        save_config(existing)

        return {
            "success": True,
            "cookie_count": len(cookie_list),
            "cookie_preview": json.dumps(cookie_list)[:100] + "...",
            "message": f"成功从浏览器获取 {len(cookie_list)} 个 Cookie",
        }

    except Exception as e:
        return {
            "success": False,
            "error": f"获取浏览器 Cookie 失败: {str(e)}",
        }


@router.post("/zhihu/comments")
async def api_zhihu_comments(req: ZhihuCommentsRequest):
    """获取知乎内容评论"""
    result = await zhihu_fetch_comments(
        content_id=req.content_id,
        max_comments=req.max_comments,
        sort_by=req.sort_by,
    )
    return result


@router.post("/zhihu/trends")
async def api_zhihu_trends(req: ZhihuTrendsRequest):
    """分析知乎 Trends"""
    result = await zhihu_analyze_trends(keyword=req.keyword)
    return result


# ===== arXiv API 工具 =====

@router.post("/arxiv/search")
async def api_arxiv_search(req: ArxivAPISearchRequest):
    import time
    from fastapi import HTTPException
    start_time = time.time()

    if req.mode not in ("AND", "OR"):
        raise HTTPException(status_code=400, detail="mode must be 'AND' or 'OR'")

    try:
        papers = await arxiv_api_search(
            keywords=req.keywords,
            categories=req.categories,
            mode=req.mode,
            max_results=req.max_results,
            days_back=req.days_back,
            sort_by=req.sort_by,
            sort_order=req.sort_order,
            advanced=req.advanced,
        )
        search_time_ms = (time.time() - start_time) * 1000
        query_label = (
            " ".join(
                f"{c.get('field', 'all')}:{c.get('value', '')}"
                for c in (req.advanced or {}).get("conditions", [])
                if c.get("value")
            )
            if req.advanced
            else " ".join(req.keywords)
        )
        return {
            "total": len(papers),
            "papers": papers,
            "query": query_label,
            "search_time_ms": round(search_time_ms, 2),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"arXiv API error: {str(e)}")


@router.get("/arxiv/categories")
async def get_arxiv_categories():
    from abo.default_modules.arxiv.category import ALL_SUBCATEGORIES
    return {
        "categories": [
            {"code": code, "name": name, "main": code.split(".")[0]}
            for code, name in ALL_SUBCATEGORIES.items()
        ]
    }


class ArxivFiguresRequest(BaseModel):
    arxiv_id: str


@router.post("/arxiv/figures")
async def api_arxiv_figures(req: ArxivFiguresRequest):
    """获取arXiv论文的图片（模型架构图等）"""
    from abo.tools.arxiv_api import ArxivAPITool
    tool = ArxivAPITool()
    try:
        figures = await tool.fetch_figures(req.arxiv_id)
        return {"figures": figures}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch figures: {str(e)}")


class ArxivIntroductionRequest(BaseModel):
    arxiv_id: str
    abstract: Optional[str] = None


@router.post("/arxiv/introduction")
async def api_arxiv_introduction(req: ArxivIntroductionRequest):
    """获取 arXiv 论文的 Introduction 段落，并返回结构化 digest。"""
    from abo.tools.arxiv_api import ArxivAPITool, build_structured_digest_markdown

    tool = ArxivAPITool()
    try:
        introduction = await tool.fetch_introduction(req.arxiv_id)
        return {
            "introduction": introduction,
            "formatted_digest": build_structured_digest_markdown(req.abstract or "", introduction),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch introduction: {str(e)}")


class ArxivSaveRequest(BaseModel):
    arxiv_id: str
    title: str
    authors: list[str]
    summary: str
    pdf_url: str
    arxiv_url: str
    primary_category: str
    published: str
    comment: Optional[str] = None
    figures: list[dict] = []
    tracking_label: Optional[str] = None
    introduction: Optional[str] = None
    formatted_digest: Optional[str] = None


@router.post("/arxiv/save")
async def api_arxiv_save(req: ArxivSaveRequest):
    """保存 arXiv 论文到分组目录，结构与 follow-up 保存保持一致。"""
    import frontmatter
    import httpx
    from mimetypes import guess_extension
    from abo.config import get_literature_path
    from abo.tools.arxiv_api import ArxivAPITool, build_structured_digest_markdown

    lit_path = get_literature_path()
    if not lit_path:
        raise HTTPException(status_code=400, detail="未配置文献库路径，请先在设置中配置")

    paper_relative_dir = build_arxiv_grouped_relative_dir(
        {
            "id": req.arxiv_id,
            "title": req.title,
            "published": req.published,
            "metadata": {
                "paper_tracking_label": req.tracking_label,
                "primary_category": req.primary_category,
                "published": req.published,
            },
        },
        root_folder="arxiv",
        paper_fallback=req.arxiv_id,
    )
    base_dir = lit_path / Path(paper_relative_dir)
    try:
        base_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"无法创建目录: {str(e)}")

    note_name = base_dir.name
    md_file_name = f"{note_name}.md"
    md_file_path = base_dir / md_file_name
    pdf_file_path = base_dir / "paper.pdf"
    figures_dir = base_dir / "figures"
    figures_dir.mkdir(exist_ok=True)
    introduction_text = str(req.introduction or "").strip()
    formatted_digest = str(req.formatted_digest or "").strip()

    saved_figures: list[dict] = []
    async with httpx.AsyncClient(timeout=120) as client:
        pdf_downloaded = False
        try:
            pdf_resp = await client.get(req.pdf_url, follow_redirects=True)
            if pdf_resp.status_code == 200:
                pdf_file_path.write_bytes(pdf_resp.content)
                pdf_downloaded = True
        except Exception as e:
            print(f"Failed to download PDF: {e}")

        for i, fig in enumerate(req.figures[:6]):
            img_url = str(fig.get("url", "")).strip()
            if not img_url:
                continue
            try:
                img_resp = await client.get(img_url)
                if img_resp.status_code != 200:
                    continue
                content_type = img_resp.headers.get("content-type", "image/png")
                ext = guess_extension(content_type) or ".png"
                filename = f"figure_{i + 1}{ext if ext.startswith('.') else f'.{ext}'}"
                figure_path = figures_dir / filename
                figure_path.write_bytes(img_resp.content)
                saved_figures.append(
                    {
                        "filename": filename,
                        "caption": fig.get("caption", f"Figure {i + 1}"),
                        "local_path": f"figures/{filename}",
                        "original_url": img_url,
                    }
                )
            except Exception as e:
                print(f"Failed to download figure {i + 1}: {e}")

    if not introduction_text:
        try:
            introduction_text = await ArxivAPITool().fetch_introduction(req.arxiv_id)
        except Exception as e:
            print(f"Failed to fetch introduction for {req.arxiv_id}: {e}")
            introduction_text = ""

    if not formatted_digest:
        formatted_digest = build_structured_digest_markdown(req.summary or "", introduction_text)

    content_parts = [f"# {req.title}\n", "## 论文信息\n"]
    if req.authors:
        content_parts.append(f"**Authors:** {', '.join(req.authors)}\n")
    content_parts.append(f"**arXiv ID:** [{req.arxiv_id}]({req.arxiv_url})\n")
    if req.primary_category:
        content_parts.append(f"**Category:** {req.primary_category}\n")
    if req.published:
        content_parts.append(f"**Published:** {req.published}\n")
    if req.tracking_label:
        content_parts.append(f"**Tracking:** {req.tracking_label}\n")
    if req.comment:
        content_parts.append(f"**Comment:** {req.comment}\n")

    if req.summary:
        content_parts.append("\n## Abstract\n")
        content_parts.append(f"{req.summary}\n")

    if introduction_text:
        content_parts.append("\n## Introduction\n")
        content_parts.append(f"{introduction_text}\n")

    if saved_figures:
        content_parts.append("\n## Figures\n")
        for fig in saved_figures:
            content_parts.append(f"### {fig['caption']}\n")
            content_parts.append(f"![{fig['caption']}]({fig['local_path']})\n")

    if pdf_downloaded:
        content_parts.append("\n## PDF\n")
        content_parts.append("[下载PDF](paper.pdf)\n")

    md_content = "\n".join(content_parts)

    frontend_figures = [
        {
            **fig,
            "local_path": str((paper_relative_dir / fig["local_path"]).as_posix()),
        }
        for fig in saved_figures
    ]

    post = frontmatter.Post(md_content)
    post.metadata.update(
        {
            "abo-type": "arxiv-paper",
            "authors": req.authors,
            "arxiv-id": req.arxiv_id,
            "arxiv-url": req.arxiv_url,
            "pdf-url": req.pdf_url,
            "pdf-path": "paper.pdf" if pdf_downloaded else None,
            "published": req.published,
            "primary-category": req.primary_category,
            "tracking-label": req.tracking_label or "",
            "comment": req.comment or "",
            "abstract": req.summary,
            "introduction": introduction_text,
            "formatted-digest": formatted_digest,
            "figures": frontend_figures,
            "saved-at": datetime.now().isoformat(),
        }
    )
    post.metadata.update(
        UnifiedVaultEntry(
            entry_id=req.arxiv_id,
            entry_type="paper",
            title=req.title,
            summary=req.summary,
            source_url=req.arxiv_url,
            source_platform="arxiv",
            source_module="arxiv-api",
            authors=req.authors,
            published=req.published,
            tags=[req.primary_category] if req.primary_category else [],
            obsidian_path=str((paper_relative_dir / md_file_name).as_posix()),
        ).to_metadata()
    )
    md_file_path.write_text(frontmatter.dumps(post), encoding="utf-8")

    note_relative_path = str(md_file_path.relative_to(lit_path))

    _paper_store.upsert_from_payload(
        {
            "id": req.arxiv_id,
            "title": req.title,
            "authors": req.authors,
            "summary": req.summary,
            "arxiv_url": req.arxiv_url,
            "pdf_url": req.pdf_url,
            "published": req.published,
            "categories": [req.primary_category] if req.primary_category else [],
            "figures": frontend_figures,
            "metadata": {
                "arxiv-id": req.arxiv_id,
                "paper_tracking_label": req.tracking_label or "",
                "pdf_path": "paper.pdf" if pdf_downloaded else "",
                "figures": frontend_figures,
                "abstract": req.summary,
                "introduction": introduction_text,
                "formatted-digest": formatted_digest,
                "saved_to_literature": True,
                "literature_path": note_relative_path,
            },
            "literature_path": note_relative_path,
            "saved_to_literature": True,
        },
        source_module="arxiv-api",
    )

    return {
        "success": True,
        "saved_to": note_relative_path,
        "pdf_path": str((paper_relative_dir / "paper.pdf").as_posix()) if pdf_downloaded else None,
        "introduction": introduction_text,
        "formatted_digest": formatted_digest,
        "files": [
            md_file_name,
            *(["paper.pdf"] if pdf_downloaded else []),
            *[fig["filename"] for fig in saved_figures],
        ],
    }
