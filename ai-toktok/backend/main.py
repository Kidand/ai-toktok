"""FastAPI backend for ai-toktok - API + static file serving."""

import json
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from models import (
    LLMConfig, ParsedStory, PlayerConfig, GuardrailParams,
    NarrativeBalance, NarrativeEntry,
)
from parser import parse_story
from narrator import (
    generate_narration,
    generate_opening,
    generate_epilogue,
    generate_reincarnation,
    stream_narration,
    parse_narration_response,
)

STATIC_DIR = Path(__file__).resolve().parent.parent / "out"

app = FastAPI(title="AI TokTok")

# ── In-memory job pool for parse tasks ──────────────────────────────────────

jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


def _cleanup_job(job_id: str, delay: float):
    time.sleep(delay)
    with jobs_lock:
        jobs.pop(job_id, None)


# ── /api/parse ──────────────────────────────────────────────────────────────


class ParseRequest(BaseModel):
    config: LLMConfig
    storyText: str


@app.post("/api/parse")
def submit_parse(req: ParseRequest):
    if not req.config.apiKey:
        return {"error": "缺少 API 密钥"}
    if not req.storyText.strip():
        return {"error": "缺少故事文本"}

    job_id = f"{int(time.time() * 1000):x}{id(req):x}"

    with jobs_lock:
        jobs[job_id] = {
            "status": "running",
            "progress": {"phase": "split", "current": 0, "total": 0},
        }

    def _run():
        try:
            def on_progress(p: dict):
                with jobs_lock:
                    if job_id in jobs:
                        jobs[job_id]["progress"] = p

            result = parse_story(req.config, req.storyText, on_progress)
            with jobs_lock:
                jobs[job_id] = {
                    "status": "done",
                    "progress": {"phase": "done", "current": 1, "total": 1},
                    "result": result.model_dump(),
                }
            threading.Thread(target=_cleanup_job, args=(job_id, 300), daemon=True).start()
        except Exception as e:
            print(f"[parse-job] Error: {e}")
            traceback.print_exc()
            with jobs_lock:
                jobs[job_id] = {
                    "status": "error",
                    "progress": {"phase": "error", "current": 0, "total": 0},
                    "error": str(e),
                }
            threading.Thread(target=_cleanup_job, args=(job_id, 60), daemon=True).start()

    threading.Thread(target=_run, daemon=True).start()
    return {"jobId": job_id}


@app.get("/api/parse")
def poll_parse(jobId: str = Query(...)):
    with jobs_lock:
        job = jobs.get(jobId)

    if not job:
        return {"error": "任务不存在或已过期"}

    resp: dict[str, Any] = {
        "status": job["status"],
        "progress": job["progress"],
    }
    if job["status"] == "done":
        resp["result"] = job.get("result")
    if job["status"] == "error":
        resp["error"] = job.get("error")
    return resp


# ── /api/narrate ────────────────────────────────────────────────────────────


class NarrateRequest(BaseModel):
    action: str
    config: LLMConfig
    story: Optional[ParsedStory] = None
    playerConfig: Optional[PlayerConfig] = None
    guardrail: Optional[GuardrailParams] = None
    balance: Optional[NarrativeBalance] = None
    history: Optional[list[dict]] = None
    playerInput: Optional[str] = None


@app.post("/api/narrate")
def narrate(req: NarrateRequest):
    try:
        if req.action == "reincarnation":
            return generate_reincarnation(req.config, req.story)

        # Streaming SSE for opening and narrate
        if req.action in ("opening", "narrate"):
            player_input = req.playerInput or ""
            if req.action == "opening":
                player_input = "（我刚刚来到这个世界，环顾四周）"

            history_entries = [NarrativeEntry(**h) for h in (req.history or [])]

            def event_stream():
                full = ""
                for token in stream_narration(
                    req.config, req.story, req.playerConfig,
                    req.guardrail, req.balance,
                    history_entries, player_input,
                ):
                    full += token
                    yield f"data: {json.dumps({'type': 'token', 'token': token}, ensure_ascii=False)}\n\n"

                # Parse final result
                result = parse_narration_response(full, req.story, player_input)
                yield f"data: {json.dumps({'type': 'done', **result}, ensure_ascii=False)}\n\n"

            return StreamingResponse(
                event_stream(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        return {"error": "未知操作"}
    except Exception as e:
        print(f"叙事生成失败: {e}")
        traceback.print_exc()
        return {"error": str(e)}


# ── /api/epilogue ───────────────────────────────────────────────────────────


class EpilogueRequest(BaseModel):
    config: LLMConfig
    story: ParsedStory
    playerConfig: PlayerConfig
    characterInteractions: list[dict]
    narrativeHistory: list[dict]


@app.post("/api/epilogue")
def epilogue(req: EpilogueRequest):
    try:
        if not req.config.apiKey:
            return {"error": "缺少 API 密钥"}

        result = generate_epilogue(
            req.config, req.story, req.playerConfig,
            req.characterInteractions, req.narrativeHistory,
        )
        return {"epilogue": result}
    except Exception as e:
        print(f"后日谈生成失败: {e}")
        traceback.print_exc()
        return {"error": str(e)}


# ── Static files (Next.js export in ../out) ─────────────────────────────────

# Mount _next assets
if (STATIC_DIR / "_next").exists():
    app.mount("/_next", StaticFiles(directory=STATIC_DIR / "_next"), name="next-assets")


@app.get("/{full_path:path}")
def serve_static(full_path: str):
    """Serve static HTML pages from the Next.js export."""
    if not full_path or full_path == "/":
        return FileResponse(STATIC_DIR / "index.html", media_type="text/html")

    # Try exact file (e.g. favicon.ico)
    exact = STATIC_DIR / full_path
    if exact.is_file():
        return FileResponse(exact)

    # Try as HTML page (e.g. /setup -> setup.html)
    html = STATIC_DIR / f"{full_path}.html"
    if html.is_file():
        return FileResponse(html, media_type="text/html")

    # Try as directory index (e.g. /setup/ -> setup/index.html)
    idx = STATIC_DIR / full_path / "index.html"
    if idx.is_file():
        return FileResponse(idx, media_type="text/html")

    # Fallback to index.html for client-side routing
    return FileResponse(STATIC_DIR / "index.html", media_type="text/html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
