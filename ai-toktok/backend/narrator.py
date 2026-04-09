"""Narrative generation module - generates story narration, openings, epilogues."""

import json
import re
import time
import uuid
from typing import Optional

from typing import Generator

from llm import call_llm, stream_llm
from models import (
    LLMConfig, ParsedStory, PlayerConfig, GuardrailParams,
    NarrativeBalance, NarrativeEntry, CharacterInteraction,
    StoryChoice, EpilogueEntry, InteractionItem,
)


def _build_world_system_prompt(
    story: ParsedStory,
    player_config: PlayerConfig,
    guardrail: GuardrailParams,
    balance: NarrativeBalance,
) -> str:
    if player_config.entryMode == "soul-transfer":
        player_char = next(
            (c for c in story.characters if c.id == player_config.characterId), None
        )
    else:
        player_char = player_config.customCharacter

    entry_event = (
        story.keyEvents[player_config.entryEventIndex]
        if player_config.entryEventIndex < len(story.keyEvents)
        else None
    )

    char_descriptions = "\n".join(
        f"【{c.name}】{c.personality}。{c.background}"
        for c in story.characters
        if c.id != player_config.characterId
    )

    if guardrail.strictness > 0.7:
        strictness_guide = "严格遵循原作设定，角色性格不易被改变，世界规则绝对不可违反。"
    elif guardrail.strictness > 0.4:
        strictness_guide = "基本遵循原作设定，但允许合理的性格发展和意外反应。"
    else:
        strictness_guide = "角色有较大的行为弹性，可以做出更意外的反应，但核心设定仍需保持。"

    if balance.narrativeWeight > 60:
        narrative_guide = "以叙事为主，大段描写环境、心理和行为，对话穿插其中。用户选择性介入关键节点。"
    elif balance.narrativeWeight > 30:
        narrative_guide = "叙事与对话交替，既有环境描写也有频繁的角色互动。"
    else:
        narrative_guide = "以对话为主，频繁与角色交流互动，简短的环境和动作描述穿插其中。"

    player_name = player_char.name if player_char else "未知"
    player_desc = player_char.description if player_char else ""
    player_personality = player_char.personality if player_char else ""
    player_bg = player_char.background if player_char else ""
    entry_mode_label = "魂穿" if player_config.entryMode == "soul-transfer" else "转生"

    entry_point = (
        f'从"{entry_event.title}"开始：{entry_event.description}'
        if entry_event
        else "从故事开头开始"
    )

    rules_text = "\n".join(f"- {r}" for r in story.worldSetting.rules)

    return f"""你是一个沉浸式互动叙事引擎。你正在运行一个基于以下故事世界的互动叙事体验。

## 故事世界
标题：{story.title}
{story.summary}

## 世界观设定
时代：{story.worldSetting.era}
类型：{story.worldSetting.genre}
叙事风格：{story.worldSetting.toneDescription}
世界规则：
{rules_text}

## 角色列表
{char_descriptions}

## 玩家角色
模式：{entry_mode_label}
角色：{player_name}
身份：{player_desc}
性格：{player_personality}
背景：{player_bg}

## 当前剧情节点
{entry_point}

## 世界观护栏
{strictness_guide}
- 如果玩家的行为完全超出世界观（如古代世界出现现代科技），不要生硬提示"不允许"，而是通过合理的剧情方式化解（如其他角色的困惑反应、自然的阻碍等）
- 核心角色的基本设定不可被轻易改写
- 玩家的行为会有成功或失败的合理结果

## 叙事风格
{narrative_guide}

## 交互格式要求
你的每次回复必须严格按照以下JSON格式返回，不要包含任何其他文字：

{{
  "narration": "叙事内容（环境描写、动作描述、心理活动等）",
  "dialogues": [
    {{ "speaker": "角色名", "content": "对话内容" }}
  ],
  "choices": [
    {{ "text": "选项1描述", "isBranchPoint": false }},
    {{ "text": "选项2描述", "isBranchPoint": false }},
    {{ "text": "选项3描述（可选，关键分支时）", "isBranchPoint": true }}
  ],
  "interactions": [
    {{ "characterName": "与玩家互动的角色名", "event": "互动事件简述", "reaction": "角色反应", "sentiment": "positive/neutral/negative" }}
  ]
}}

注意：
- choices 提供2-3个选项供玩家选择，也可以自由输入
- 当检测到关键剧情节点时，设置 isBranchPoint 为 true
- interactions 记录本轮与玩家有直接交互的角色及其反应
- 叙事内容要生动有代入感，符合原作风格
- 对话要符合每个角色的性格特征"""


def _build_history_context(history: list[NarrativeEntry], max_entries: int = 20) -> str:
    recent = history[-max_entries:]
    parts = []
    for entry in recent:
        if entry.type == "narration":
            parts.append(f"[叙事] {entry.content}")
        elif entry.type == "dialogue":
            parts.append(f"[{entry.speaker}] {entry.content}")
        elif entry.type == "player-action":
            parts.append(f"[玩家行动] {entry.content}")
        elif entry.type == "system":
            parts.append(f"[系统] {entry.content}")
        else:
            parts.append(entry.content)
    return "\n\n".join(parts)


def generate_narration(
    config: LLMConfig,
    story: ParsedStory,
    player_config: PlayerConfig,
    guardrail: GuardrailParams,
    balance: NarrativeBalance,
    history: list[NarrativeEntry],
    player_input: str,
) -> dict:
    system_prompt = _build_world_system_prompt(story, player_config, guardrail, balance)
    history_context = _build_history_context(history)

    if history_context:
        user_message = f"## 之前的剧情\n{history_context}\n\n## 玩家当前行动\n{player_input}"
    else:
        user_message = f"故事开始。玩家已进入故事世界。\n\n玩家的第一个行动：{player_input or '（观察周围环境）'}"

    response = call_llm(
        config,
        system_prompt,
        user_message,
        temperature=0.3 + guardrail.temperature * 0.7,
        max_tokens=4096,
    )

    json_str = response
    json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", response)
    if json_match:
        json_str = json_match.group(1)

    try:
        parsed = json.loads(json_str.strip())
    except json.JSONDecodeError:
        return {
            "entries": [
                {
                    "id": str(uuid.uuid4()),
                    "type": "narration",
                    "content": response,
                    "timestamp": int(time.time() * 1000),
                    "choices": [
                        {"id": str(uuid.uuid4()), "text": "继续观察", "isBranchPoint": False},
                        {"id": str(uuid.uuid4()), "text": "与附近的人交谈", "isBranchPoint": False},
                    ],
                }
            ],
            "interactions": [],
        }

    entries = []

    if parsed.get("narration"):
        entries.append({
            "id": str(uuid.uuid4()),
            "type": "narration",
            "content": parsed["narration"],
            "timestamp": int(time.time() * 1000),
        })

    for d in parsed.get("dialogues", []):
        entries.append({
            "id": str(uuid.uuid4()),
            "type": "dialogue",
            "speaker": d.get("speaker", ""),
            "content": d.get("content", ""),
            "timestamp": int(time.time() * 1000),
        })

    choices = [
        {
            "id": str(uuid.uuid4()),
            "text": c.get("text", ""),
            "isBranchPoint": c.get("isBranchPoint", False),
        }
        for c in parsed.get("choices", [])
    ]
    if entries and choices:
        entries[-1]["choices"] = choices

    interactions = []
    for inter in parsed.get("interactions", []):
        char = next(
            (c for c in story.characters if c.name == inter.get("characterName")), None
        )
        if char:
            interactions.append({
                "characterId": char.id,
                "characterName": char.name,
                "interactions": [
                    {
                        "event": inter.get("event", ""),
                        "playerAction": player_input,
                        "characterReaction": inter.get("reaction", ""),
                        "sentiment": inter.get("sentiment", "neutral"),
                    }
                ],
            })

    return {"entries": entries, "interactions": interactions}


def generate_opening(
    config: LLMConfig,
    story: ParsedStory,
    player_config: PlayerConfig,
    guardrail: GuardrailParams,
    balance: NarrativeBalance,
) -> dict:
    result = generate_narration(
        config, story, player_config, guardrail, balance, [],
        "（我刚刚来到这个世界，环顾四周）",
    )
    return {"entries": result["entries"]}


def generate_epilogue(
    config: LLMConfig,
    story: ParsedStory,
    player_config: PlayerConfig,
    character_interactions: list[dict],
    narrative_history: list[dict],
) -> list[dict]:
    if player_config.entryMode == "soul-transfer":
        player_char = next(
            (c for c in story.characters if c.id == player_config.characterId), None
        )
    else:
        player_char = player_config.customCharacter

    interaction_parts = []
    for ci in character_interactions:
        events = "\n".join(
            f"- 事件：{i['event']}，玩家行动：{i['playerAction']}，{ci['characterName']}的反应：{i['characterReaction']}（{i['sentiment']}）"
            for i in ci.get("interactions", [])
        )
        interaction_parts.append(f"【{ci['characterName']}】\n{events}")

    interaction_summary = "\n\n".join(interaction_parts)
    player_name = player_char.name if player_char else "旅人"

    system_prompt = f"""你是一个后日谈生成器。故事已经结束，现在需要为每个与玩家有过交集的角色生成回忆评价。

故事世界：{story.title}
玩家角色：{player_name}

要求：
- 每个角色的回忆必须精准提到具体的交互事件，不能是泛泛之词
- 回忆的语气要符合角色性格
- 要体现出玩家的选择确实被记住了
- 以第一人称（角色视角）叙述

返回严格JSON格式：
[
  {{ "characterName": "角色名", "memoir": "该角色对玩家的回忆评价（200-400字）" }}
]"""

    response = call_llm(
        config, system_prompt, f"## 交互记录\n{interaction_summary}",
        temperature=0.6, max_tokens=4096,
    )

    json_str = response
    json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", response)
    if json_match:
        json_str = json_match.group(1)

    parsed = json.loads(json_str.strip())

    result = []
    for p in parsed:
        char = next((c for c in story.characters if c.name == p.get("characterName")), None)
        result.append({
            "characterId": char.id if char else "",
            "characterName": p.get("characterName", ""),
            "memoir": p.get("memoir", ""),
        })

    return result


def generate_reincarnation(config: LLMConfig, story: ParsedStory) -> dict:
    system_prompt = """根据以下世界观，生成一个符合这个世界背景的全新原创角色。这个角色应该能自然融入故事世界，但不是原作中已有的角色。

返回严格JSON格式：
{
  "name": "角色名",
  "description": "外貌及身份简述",
  "personality": "性格特征",
  "background": "背景故事（如何来到当前位置）"
}"""

    world_info = (
        f"世界：{story.title}\n"
        f"时代：{story.worldSetting.era}\n"
        f"类型：{story.worldSetting.genre}\n"
        f"设定：{'；'.join(story.worldSetting.rules)}\n"
        f"已有角色：{'、'.join(c.name for c in story.characters)}"
    )

    response = call_llm(config, system_prompt, world_info, temperature=0.8)

    json_str = response
    json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", response)
    if json_match:
        json_str = json_match.group(1)

    return json.loads(json_str.strip())


def stream_narration(
    config: LLMConfig,
    story: ParsedStory,
    player_config: PlayerConfig,
    guardrail: GuardrailParams,
    balance: NarrativeBalance,
    history: list[NarrativeEntry],
    player_input: str,
) -> Generator[str, None, str]:
    """Stream LLM tokens, then return the full text via StopIteration.value."""
    system_prompt = _build_world_system_prompt(story, player_config, guardrail, balance)
    history_context = _build_history_context(history)

    if history_context:
        user_message = f"## 之前的剧情\n{history_context}\n\n## 玩家当前行动\n{player_input}"
    else:
        user_message = f"故事开始。玩家已进入故事世界。\n\n玩家的第一个行动：{player_input or '（观察周围环境）'}"

    full = ""
    for token in stream_llm(
        config, system_prompt, user_message,
        temperature=0.3 + guardrail.temperature * 0.7,
        max_tokens=4096,
    ):
        full += token
        yield token

    return full


def parse_narration_response(raw: str, story: ParsedStory, player_input: str) -> dict:
    """Parse the accumulated LLM response into structured entries + interactions."""
    json_str = raw
    json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if json_match:
        json_str = json_match.group(1)

    try:
        parsed = json.loads(json_str.strip())
    except json.JSONDecodeError:
        return {
            "entries": [{
                "id": str(uuid.uuid4()),
                "type": "narration",
                "content": raw,
                "timestamp": int(time.time() * 1000),
                "choices": [
                    {"id": str(uuid.uuid4()), "text": "继续观察", "isBranchPoint": False},
                    {"id": str(uuid.uuid4()), "text": "与附近的人交谈", "isBranchPoint": False},
                ],
            }],
            "interactions": [],
        }

    entries = []
    if parsed.get("narration"):
        entries.append({
            "id": str(uuid.uuid4()),
            "type": "narration",
            "content": parsed["narration"],
            "timestamp": int(time.time() * 1000),
        })
    for d in parsed.get("dialogues", []):
        entries.append({
            "id": str(uuid.uuid4()),
            "type": "dialogue",
            "speaker": d.get("speaker", ""),
            "content": d.get("content", ""),
            "timestamp": int(time.time() * 1000),
        })

    choices = [
        {"id": str(uuid.uuid4()), "text": c.get("text", ""), "isBranchPoint": c.get("isBranchPoint", False)}
        for c in parsed.get("choices", [])
    ]
    if entries and choices:
        entries[-1]["choices"] = choices

    interactions = []
    for inter in parsed.get("interactions", []):
        char = next((c for c in story.characters if c.name == inter.get("characterName")), None)
        if char:
            interactions.append({
                "characterId": char.id,
                "characterName": char.name,
                "interactions": [{
                    "event": inter.get("event", ""),
                    "playerAction": player_input,
                    "characterReaction": inter.get("reaction", ""),
                    "sentiment": inter.get("sentiment", "neutral"),
                }],
            })

    return {"entries": entries, "interactions": interactions}
