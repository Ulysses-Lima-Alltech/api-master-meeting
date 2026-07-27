"""openai_harness.py — an OpenAI-compatible HarnessPort for Chat/Q&A mode.

This adapter satisfies the HarnessPort protocol (yielding UnitEvents like message-delta and done)
but implements it via a direct HTTP stream to any OpenAI-compatible `/chat/completions` endpoint.
It allows the Side Agent to use ChatGPT (or Gemini, via compat) for Q&A tasks without the heavy
tool-calling and file-editing machinery of `claude-code`.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Iterable, Iterator, Optional

import httpx

from llm.errors import LLMAuthError, LLMConfigError, LLMError
from llm.ports import HarnessPort

logger = logging.getLogger("agent.openai_harness")


class OpenAIHarness(HarnessPort):
    name = "openai-compat"

    def __init__(self, *, base_url: Optional[str] = None, api_key: Optional[str] = None,
                 model: Optional[str] = None, timeout: float = 120.0,
                 transport: Optional[httpx.BaseTransport] = None) -> None:
        self._base = (base_url or os.environ.get("VEXA_LLM_BASE_URL")
                      or os.environ.get("ANTHROPIC_BASE_URL") or "").rstrip("/")
        self._key = (api_key or os.environ.get("VEXA_LLM_API_KEY")
                     or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                     or os.environ.get("ANTHROPIC_API_KEY") or "")
        self._model = model or os.environ.get("VEXA_LLM_MODEL") or "gpt-4o"
        self._client = httpx.Client(timeout=timeout, transport=transport)

    def prepare(self, work: Path, chat_root: Optional[Path] = None) -> None:
        pass

    def transcript_bytes(self, work: Path, session_id: str) -> int:
        return 0

    def preflight(self) -> Optional[str]:
        if not self._key:
            return "No OpenAI-compatible API key found (VEXA_LLM_API_KEY)."
        return None

    def run_turn(self, work: Path, prompt: str, *, allowed_tools: Iterable[str] = (),
                 session: Optional[str] = None, model: Optional[str] = None,
                 mcp_config: Optional[str] = None) -> Iterator[dict]:
        target = (model or "").strip() or self._model
        if not self._base:
            yield {
                "type": "done", "ok": False, "sessionId": session,
                "reply": "No completion endpoint configured.",
                "detail": "Set VEXA_LLM_BASE_URL."
            }
            return

        system_instruction = "You are the Vexa Side Agent. You are an expert assistant."
        if allowed_tools:
            system_instruction += "\n\n(Note: Tool execution is disabled in this runner. You are in Q&A mode)."

        messages = [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt}
        ]
        headers = {"Authorization": f"Bearer {self._key}"} if self._key else {}

        full_reply = ""
        try:
            with self._client.stream("POST", f"{self._base}/chat/completions",
                                     json={"model": target, "messages": messages, "stream": True},
                                     headers=headers) as r:
                if r.status_code in (401, 403):
                    yield {"type": "done", "ok": False, "sessionId": session, "reply": "Auth Error", "detail": f"{r.status_code} - {r.text[:200]}"}
                    return
                if r.status_code >= 400:
                    yield {"type": "done", "ok": False, "sessionId": session, "reply": "API Error", "detail": f"{r.status_code} - {r.text[:200]}"}
                    return

                for line in r.iter_lines():
                    if line.startswith("data: ") and line != "data: [DONE]":
                        payload = line[6:]
                        try:
                            data = json.loads(payload)
                            delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            if delta:
                                full_reply += delta
                                yield {"type": "message-delta", "text": delta}
                        except json.JSONDecodeError:
                            continue
                
                yield {"type": "done", "ok": True, "sessionId": session, "reply": full_reply}
        except Exception as e:
            logger.exception("OpenAI streaming failed")
            yield {"type": "done", "ok": False, "sessionId": session, "reply": "Error connecting to OpenAI", "detail": str(e)}
