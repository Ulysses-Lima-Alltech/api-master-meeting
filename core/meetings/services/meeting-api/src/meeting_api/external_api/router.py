import os
import re
import json
import uuid
from typing import Optional, Any, Protocol, runtime_checkable
from fastapi import APIRouter, Header, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from ..bot_spawn.ports import MeetingRepo, RuntimeClient, SpawnFailed, MaxBotsExceeded
from ..bot_spawn.service import request_bot
from ..recordings.ports import RecordingRepo, Storage

@runtime_checkable
class CommandPublisher(Protocol):
    async def publish(self, channel: str, message: str) -> Any:
        ...

# Auth Dependency - fixed to properly read the header without raising 422
def verify_api_key(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    secret = os.getenv("INTERNAL_API_SECRET", "lite-internal-secret")
    if not x_api_key or x_api_key != secret:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")
    return x_api_key

def _extract_native_id(platform: str, url: str) -> str:
    """Extract native meeting ID from URL to avoid 409 DuplicateMeeting bugs."""
    if platform == "google_meet":
        m = re.search(r'meet\.google\.com/([a-z\-]+)', url)
        return m.group(1) if m else str(uuid.uuid4())
    if platform == "teams":
        m = re.search(r'meetup-join/([^/]+)', url)
        return m.group(1) if m else str(uuid.uuid4())
    if platform == "zoom":
        m = re.search(r'j/(\d+)', url)
        return m.group(1) if m else str(uuid.uuid4())
    return str(uuid.uuid4())

_BOOTING_STATUSES = {"requested", "joining", "awaiting_admission"}
_SUPPORTED_PLATFORMS = {"google_meet", "zoom", "teams", "browser_session"}

def build_router(
    repo: MeetingRepo,
    runtime: RuntimeClient,
    command_publisher: CommandPublisher,
    recording_repo: RecordingRepo,
    storage: Storage,
    transcript_store: Any,
) -> APIRouter:
    router = APIRouter(prefix="/api/external")

    @router.post("/bots")
    async def dispatch_bot(
        request: Request,
        x_api_key: str = Depends(verify_api_key)
    ):
        try:
            body = await request.json()
        except:
            raise HTTPException(status_code=422, detail="invalid JSON body")
            
        meeting_url = body.get("meeting_url")
        if not meeting_url:
            raise HTTPException(status_code=422, detail="meeting_url is required")
            
        platform = body.get("platform", "google_meet")
        bot_name = body.get("bot_name", "Vexa Recorder")
        language = body.get("language", "pt-BR")

        native_id = _extract_native_id(platform, meeting_url)

        try:
            meeting = await request_bot(
                repo,
                runtime,
                user_id=1,  # System user
                platform=platform,
                native_meeting_id=native_id,
                meeting_url=meeting_url,
                bot_name=bot_name,
                default_avatar_url="",
                language=language,
                transcription_tier="realtime",
                recording_enabled=True,
                transcribe_enabled=True,
                max_concurrent=10
            )
        except MaxBotsExceeded as e:
            raise HTTPException(status_code=429, detail=str(e))
        except SpawnFailed as e:
            raise HTTPException(status_code=502, detail=str(e))

        return JSONResponse(status_code=201, content=meeting)

    @router.post("/bots/{platform}/{native_meeting_id}/stop")
    async def stop_meeting(
        platform: str,
        native_meeting_id: str,
        x_api_key: str = Depends(verify_api_key)
    ):
        if platform not in _SUPPORTED_PLATFORMS:
            raise HTTPException(status_code=422, detail=f"unsupported platform '{platform}'")
            
        meeting = await repo.find_active(1, platform, native_meeting_id)
        if not meeting:
            raise HTTPException(status_code=404, detail="No active meeting for this bot")
            
        meeting_id = meeting["id"]
        status = meeting.get("status")
        bot_container_id = meeting.get("bot_container_id")
        
        # Mark as stopping
        sessions = await repo.list_sessions(meeting_id=meeting_id)
        if sessions:
            await repo.update_meeting_status(
                session_uid=sessions[-1], status="stopping", data={"stop_requested": True},
            )
            
        # Publish stop command
        cmd = json.dumps({"action": "leave"})
        await command_publisher.publish(f"bot_commands:meeting:{meeting_id}", cmd)
        
        # Teardown if still booting (avoid zombie bots)
        if runtime is not None and bot_container_id and status in _BOOTING_STATUSES:
            try:
                await runtime.delete_workload(bot_container_id)
            except Exception:
                pass
                
        return JSONResponse(content={"status": "stopping", "meeting_id": meeting_id})

    @router.post("/meetings/{meeting_id}/transcribe")
    async def transcribe_meeting(
        meeting_id: int,
        x_api_key: str = Depends(verify_api_key)
    ):
        transcript = await transcript_store.get_transcript_by_id(
            user_id=1, 
            meeting_id=meeting_id
        )
        
        if not transcript:
            raise HTTPException(status_code=404, detail="Transcript not found or meeting still active")
            
        return JSONResponse(content=transcript)

    return router

