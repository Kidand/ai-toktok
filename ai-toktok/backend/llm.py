"""LLM calling module using the openai and anthropic packages.
Uses streaming to avoid SSL record layer failures with large responses."""

from typing import Generator

from openai import OpenAI
from anthropic import Anthropic
from models import LLMConfig

DEFAULT_OPENAI_BASE = "https://api.openai.com/v1"
DEFAULT_ANTHROPIC_BASE = "https://api.anthropic.com"


def call_llm(
    config: LLMConfig,
    system_prompt: str,
    user_message: str,
    *,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> str:
    if config.provider == "anthropic":
        return _call_anthropic(config, system_prompt, user_message, temperature, max_tokens)
    return _call_openai(config, system_prompt, user_message, temperature, max_tokens)


def _call_openai(
    config: LLMConfig,
    system_prompt: str,
    user_message: str,
    temperature: float,
    max_tokens: int,
) -> str:
    base_url = (config.baseUrl.rstrip("/") if config.baseUrl else DEFAULT_OPENAI_BASE)
    if not base_url.endswith("/v1"):
        if "/v1" not in base_url:
            base_url = base_url.rstrip("/") + "/v1"

    client = OpenAI(api_key=config.apiKey, base_url=base_url, timeout=300.0)

    model = config.model or "gpt-4o"
    print(f"[callOpenAI] Requesting: {base_url}/chat/completions model={model}")

    # Use streaming to avoid SSL record layer failures with large responses
    stream = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )

    full = ""
    for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        full += delta

    print(f"[callOpenAI] Success, response length: {len(full)}")
    return full


def _call_anthropic(
    config: LLMConfig,
    system_prompt: str,
    user_message: str,
    temperature: float,
    max_tokens: int,
) -> str:
    base_url = config.baseUrl.rstrip("/") if config.baseUrl else DEFAULT_ANTHROPIC_BASE

    client = Anthropic(api_key=config.apiKey, base_url=base_url, timeout=300.0)

    model = config.model or "claude-sonnet-4-20250514"

    # Use streaming to avoid SSL issues
    full = ""
    with client.messages.stream(
        model=model,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
        temperature=temperature,
        max_tokens=max_tokens,
    ) as stream:
        for text in stream.text_stream:
            full += text

    return full


def stream_llm(
    config: LLMConfig,
    system_prompt: str,
    user_message: str,
    *,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> Generator[str, None, None]:
    """Yield tokens one by one from the LLM."""
    if config.provider == "anthropic":
        yield from _stream_anthropic(config, system_prompt, user_message, temperature, max_tokens)
    else:
        yield from _stream_openai(config, system_prompt, user_message, temperature, max_tokens)


def _stream_openai(
    config: LLMConfig,
    system_prompt: str,
    user_message: str,
    temperature: float,
    max_tokens: int,
) -> Generator[str, None, None]:
    base_url = (config.baseUrl.rstrip("/") if config.baseUrl else DEFAULT_OPENAI_BASE)
    if not base_url.endswith("/v1"):
        if "/v1" not in base_url:
            base_url = base_url.rstrip("/") + "/v1"

    client = OpenAI(api_key=config.apiKey, base_url=base_url, timeout=300.0)
    model = config.model or "gpt-4o"

    stream = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            yield delta


def _stream_anthropic(
    config: LLMConfig,
    system_prompt: str,
    user_message: str,
    temperature: float,
    max_tokens: int,
) -> Generator[str, None, None]:
    base_url = config.baseUrl.rstrip("/") if config.baseUrl else DEFAULT_ANTHROPIC_BASE
    client = Anthropic(api_key=config.apiKey, base_url=base_url, timeout=300.0)
    model = config.model or "claude-sonnet-4-20250514"

    with client.messages.stream(
        model=model,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
        temperature=temperature,
        max_tokens=max_tokens,
    ) as stream:
        for text in stream.text_stream:
            if text:
                yield text
