"""Story parsing module - extracts characters, locations, events from story text."""

import json
import re
import uuid
from typing import Callable, Optional

from llm import call_llm
from models import (
    LLMConfig, ParsedStory, Character, Location, KeyEvent, WorldSetting,
    Relationship,
)

CHUNK_MAX_CHARS = 24000

PARSE_SYSTEM_PROMPT = """你是一个专业的故事分析AI。你的任务是深度解析用户提供的故事文本片段，提取所有关键信息。

你必须以严格的JSON格式返回分析结果，不要包含任何其他文字。JSON结构如下：

{
  "title": "故事标题（如果文本中没有明确标题，请根据内容生成一个合适的标题）",
  "summary": "本片段梗概（100-200字）",
  "worldSetting": {
    "era": "时代背景描述",
    "genre": "故事类型（如：奇幻、武侠、科幻、现实、历史等）",
    "rules": ["世界规则1", "世界规则2"],
    "toneDescription": "叙事风格描述"
  },
  "characters": [
    {
      "name": "角色名",
      "description": "外貌及身份简述",
      "personality": "性格特征详述",
      "background": "背景故事",
      "relationships": [
        { "targetName": "关联角色名", "relation": "关系描述" }
      ]
    }
  ],
  "locations": [
    { "name": "地点名", "description": "地点描述" }
  ],
  "keyEvents": [
    {
      "title": "事件标题",
      "description": "事件描述",
      "timeIndex": 0,
      "involvedCharacters": ["角色名1", "角色名2"],
      "locationName": "发生地点名"
    }
  ],
  "timelineDescription": "本片段时间线描述"
}

注意：
- 提取所有有名字的角色，包括次要角色
- 关键事件按时间顺序排列，timeIndex从0开始递增
- 如果文本较短，也要尽量提取有价值的信息"""

MERGE_SYSTEM_PROMPT = """你是一个故事信息整合专家。用户会给你多个片段的解析结果，请合并去重，生成完整统一的故事信息。

要求：
- 合并所有角色，同名角色合并信息（取最完整的描述）
- 合并所有地点，去重
- 合并所有事件，按全局时间排序，重新编号 timeIndex（从0递增）
- 合并世界观设定（取最完整的）
- 生成统一的故事标题和完整梗概（200-400字）
- 生成完整的时间线描述

返回严格JSON格式（与输入格式相同）：
{
  "title": "...",
  "summary": "完整故事梗概",
  "worldSetting": { "era": "...", "genre": "...", "rules": [...], "toneDescription": "..." },
  "characters": [...],
  "locations": [...],
  "keyEvents": [...],
  "timelineDescription": "..."
}"""


ProgressCallback = Callable[[dict], None]


def split_into_chunks(text: str) -> list[str]:
    if len(text) <= CHUNK_MAX_CHARS:
        return [text]

    chunks: list[str] = []
    paragraphs = re.split(r"\n\s*\n", text)
    current = ""

    for para in paragraphs:
        if len(current) + len(para) + 2 > CHUNK_MAX_CHARS:
            if current:
                chunks.append(current.strip())
                current = ""
            if len(para) > CHUNK_MAX_CHARS:
                for i in range(0, len(para), CHUNK_MAX_CHARS):
                    chunks.append(para[i : i + CHUNK_MAX_CHARS])
                continue
        current += ("\n\n" if current else "") + para

    if current.strip():
        chunks.append(current.strip())

    return chunks


def extract_json(response: str) -> str:
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", response)
    return match.group(1).strip() if match else response.strip()


def parse_story(
    config: LLMConfig,
    story_text: str,
    on_progress: Optional[ProgressCallback] = None,
) -> ParsedStory:
    chunks = split_into_chunks(story_text)
    total_chunks = len(chunks)

    if on_progress:
        on_progress({"phase": "split", "current": 0, "total": total_chunks})

    if total_chunks == 1:
        if on_progress:
            on_progress({"phase": "parse", "current": 1, "total": 1})
        response = call_llm(
            config,
            PARSE_SYSTEM_PROMPT,
            f"请解析以下故事文本：\n\n{story_text}",
            temperature=0.3,
            max_tokens=8192,
        )
        if on_progress:
            on_progress({"phase": "build", "current": 1, "total": 1})
        return build_parsed_story(response, story_text)

    chunk_results: list[str] = []
    for i, chunk in enumerate(chunks):
        if on_progress:
            on_progress({"phase": "parse", "current": i + 1, "total": total_chunks})
        hint = f"（这是第 {i + 1}/{total_chunks} 段，请只分析本段内容）"
        response = call_llm(
            config,
            PARSE_SYSTEM_PROMPT,
            f"{hint}\n\n请解析以下故事文本片段：\n\n{chunk}",
            temperature=0.3,
            max_tokens=4096,
        )
        chunk_results.append(extract_json(response))

    if on_progress:
        on_progress({"phase": "merge", "current": 0, "total": 1})

    merge_input = "\n\n".join(
        f"=== 片段 {i + 1}/{total_chunks} ===\n{r}" for i, r in enumerate(chunk_results)
    )
    merged_response = call_llm(
        config,
        MERGE_SYSTEM_PROMPT,
        merge_input,
        temperature=0.2,
        max_tokens=8192,
    )

    if on_progress:
        on_progress({"phase": "merge", "current": 1, "total": 1})
        on_progress({"phase": "build", "current": 1, "total": 1})

    return build_parsed_story(merged_response, story_text)


def build_parsed_story(response: str, original_text: str) -> ParsedStory:
    json_str = extract_json(response)
    parsed = json.loads(json_str)
    story_id = str(uuid.uuid4())

    characters: list[Character] = []
    for c in parsed.get("characters", []):
        characters.append(
            Character(
                id=str(uuid.uuid4()),
                name=c.get("name", ""),
                description=c.get("description", ""),
                personality=c.get("personality", ""),
                background=c.get("background", ""),
                relationships=[],
                isOriginal=True,
            )
        )

    name_to_id = {c.name: c.id for c in characters}
    for i, c_raw in enumerate(parsed.get("characters", [])):
        rels = c_raw.get("relationships", [])
        if rels:
            characters[i].relationships = [
                Relationship(characterId=name_to_id[r["targetName"]], relation=r["relation"])
                for r in rels
                if r.get("targetName") in name_to_id
            ]

    locations: list[Location] = [
        Location(
            id=str(uuid.uuid4()),
            name=loc.get("name", ""),
            description=loc.get("description", ""),
        )
        for loc in parsed.get("locations", [])
    ]
    loc_name_to_id = {loc.name: loc.id for loc in locations}

    key_events: list[KeyEvent] = []
    for e in parsed.get("keyEvents", []):
        involved = [
            name_to_id[n] for n in e.get("involvedCharacters", []) if n in name_to_id
        ]
        key_events.append(
            KeyEvent(
                id=str(uuid.uuid4()),
                title=e.get("title", ""),
                description=e.get("description", ""),
                timeIndex=e.get("timeIndex", 0),
                involvedCharacterIds=involved,
                locationId=loc_name_to_id.get(e.get("locationName", "")),
            )
        )

    ws = parsed.get("worldSetting", {})
    world_setting = WorldSetting(
        era=ws.get("era", "未知"),
        genre=ws.get("genre", "未知"),
        rules=ws.get("rules", []),
        toneDescription=ws.get("toneDescription", ""),
    )

    return ParsedStory(
        id=story_id,
        title=parsed.get("title", "未命名故事"),
        originalText=original_text,
        summary=parsed.get("summary", ""),
        worldSetting=world_setting,
        characters=characters,
        locations=locations,
        keyEvents=key_events,
        timelineDescription=parsed.get("timelineDescription", ""),
    )
