"""Pydantic models matching the TypeScript types."""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


class LLMConfig(BaseModel):
    provider: str  # 'openai' | 'anthropic'
    apiKey: str
    model: str
    baseUrl: Optional[str] = None


class Relationship(BaseModel):
    characterId: str
    relation: str


class Character(BaseModel):
    id: str
    name: str
    description: str
    personality: str
    background: str
    relationships: list[Relationship] = []
    isOriginal: bool = True


class Location(BaseModel):
    id: str
    name: str
    description: str


class KeyEvent(BaseModel):
    id: str
    title: str
    description: str
    timeIndex: int
    involvedCharacterIds: list[str] = []
    locationId: Optional[str] = None


class WorldSetting(BaseModel):
    era: str
    genre: str
    rules: list[str] = []
    toneDescription: str


class ParsedStory(BaseModel):
    id: str
    title: str
    originalText: str
    summary: str
    worldSetting: WorldSetting
    characters: list[Character] = []
    locations: list[Location] = []
    keyEvents: list[KeyEvent] = []
    timelineDescription: str


class PlayerConfig(BaseModel):
    entryMode: str  # 'soul-transfer' | 'reincarnation'
    characterId: Optional[str] = None
    customCharacter: Optional[Character] = None
    entryEventIndex: int = 0


class NarrativeBalance(BaseModel):
    narrativeWeight: int = 50


class GuardrailParams(BaseModel):
    temperature: float = 0.5
    strictness: float = 0.5


class StoryChoice(BaseModel):
    id: str
    text: str
    isBranchPoint: bool = False


class NarrativeEntry(BaseModel):
    id: str
    type: str  # 'narration' | 'dialogue' | 'player-action' | 'system'
    speaker: Optional[str] = None
    content: str
    choices: Optional[list[StoryChoice]] = None
    playerInput: Optional[str] = None
    timestamp: int


class InteractionItem(BaseModel):
    event: str
    playerAction: str
    characterReaction: str
    sentiment: str  # 'positive' | 'neutral' | 'negative'


class CharacterInteraction(BaseModel):
    characterId: str
    characterName: str
    interactions: list[InteractionItem] = []


class EpilogueEntry(BaseModel):
    characterId: str
    characterName: str
    memoir: str
