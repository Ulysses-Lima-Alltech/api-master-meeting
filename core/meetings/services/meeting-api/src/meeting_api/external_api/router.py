import os
import io
import json
import httpx
from typing import Optional, Any, Protocol, runtime_checkable
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from ..bot_spawn.ports import MeetingRepo, RuntimeClient, SpawnFailed, MaxBotsExceeded, QuotaExceeded
from ..bot_spawn.service import request_bot
from ..recordings.ports import RecordingRepo, Storage
from ..recordings.service import finalize_master

@runtime_checkable
class CommandPublisher(Protocol):
    async def publish(self, channel: str, message: str) -> Any:
        ...

def _verify_api_key(api_key: Optional[str]):
    secret = os.getenv("INTERNAL_API_SECRET", "lite-internal-secret")
    if not api_key or api_key != secret:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")

def build_router(
    repo: MeetingRepo,
    runtime: RuntimeClient,
    command_publisher: CommandPublisher,
    recording_repo: RecordingRepo,
    storage: Storage,
) -> APIRouter:
    router = APIRouter(prefix="/api/external")

    @router.post("/bots")
    async def dispatch_bot(
        request: Request,
        x_api_key: Optional[str] = Header(default=None)
    ):
        _verify_api_key(x_api_key)
        
        try:
            body = await request.json()
        except:
            raise HTTPException(status_code=422, detail="invalid JSON body")
        
        meeting_url = body.get("meeting_url")
        platform = body.get("platform", "google_meet")
        if not meeting_url:
            raise HTTPException(status_code=422, detail="meeting_url is required")

        try:
            meeting = await request_bot(
                repo,
                runtime,
                user_id=1,  # Hardcoded system user or fetch from config
                platform=platform,
                native_meeting_id="", 
                meeting_url=meeting_url,
                bot_name=body.get("bot_name", "Vexa Recorder"),
                default_avatar_url="",
                language=body.get("language", "pt-BR"),
                transcription_tier="realtime",
                recording_enabled=True,
                transcribe_enabled=False, # FORCED
                max_concurrent=10
            )
        except MaxBotsExceeded as e:
            raise HTTPException(status_code=429, detail=str(e))
        except SpawnFailed as e:
            raise HTTPException(status_code=502, detail=str(e))

        return JSONResponse(status_code=201, content=meeting)

    @router.post("/meetings/{meeting_id}/stop")
    async def stop_meeting(
        meeting_id: int,
        x_api_key: Optional[str] = Header(default=None)
    ):
        _verify_api_key(x_api_key)
        
        # Publish stop command
        cmd = json.dumps({"action": "leave"})
        await command_publisher.publish(f"bot_commands:meeting:{meeting_id}", cmd)
        
        return JSONResponse(content={"status": "stopping"})

    @router.post("/meetings/{meeting_id}/transcribe")
    async def transcribe_meeting(
        meeting_id: int,
        x_api_key: Optional[str] = Header(default=None)
    ):
        _verify_api_key(x_api_key)
        
        recs = await recording_repo.list_meeting_recordings(1) # user_id 1
        rec = next((r for r in recs if r.get("meeting_id") == meeting_id), None)
        if not rec:
            raise HTTPException(status_code=404, detail="Recording not found")

        recording_id = rec.get("id")
        master_key = await finalize_master(
            recording_repo, storage, meeting_id=meeting_id, recording_id=recording_id, media_type="audio"
        )
        if not master_key:
            raise HTTPException(status_code=404, detail="No master audio file available")

        # Get audio data
        getter = getattr(storage, "get_range", getattr(storage, "get", None))
        if not getter:
            raise HTTPException(status_code=500, detail="Storage does not support get")
        
        # Fetch the entire file
        audio_data = await getter(master_key, 0, None) 
        if not audio_data:
            raise HTTPException(status_code=404, detail="File data not found")

        # Basic check for size (if > 25MB, we should split, but for simplicity here we just send)
        whisper_url = os.getenv("TRANSCRIPTION_SERVICE_URL", "https://api.openai.com/v1/audio/transcriptions")
        whisper_token = os.getenv("TRANSCRIPTION_SERVICE_TOKEN", "")

        headers = {"Authorization": f"Bearer {whisper_token}"}
        async with httpx.AsyncClient(timeout=300.0) as client:
            files = {"file": ("audio.wav", audio_data, "audio/wav")}
            data = {"model": "whisper-1", "response_format": "verbose_json", "language": "pt"}
            resp = await client.post(whisper_url, headers=headers, data=data, files=files)

            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Transcription failed: {resp.text}")

        transcript_json = resp.json()
        
        # In a complete implementation we would insert these segments into `transcript_store` here
        # so they appear in Vexa's UI. For the external API, we return the payload directly.
        return JSONResponse(content=transcript_json)

    return router
