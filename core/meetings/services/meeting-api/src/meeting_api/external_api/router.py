import json
import os
import re
import uuid
from typing import Any, Optional, Protocol, runtime_checkable

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from ..bot_spawn.ports import DuplicateMeeting, MaxBotsExceeded, MeetingRepo, RuntimeClient, SpawnFailed
from ..bot_spawn.router import _resolve_recording_enabled, _resolve_transcribe_enabled
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

def _extract_native_id(platform: str, url: str) -> Optional[str]:
    """Extract native meeting ID from URL to avoid 409 DuplicateMeeting bugs."""
    if platform == "google_meet":
        m = re.search(r'meet\.google\.com/([^/?]+)', url)
        return m.group(1) if m else None
    if platform == "teams":
        m = re.search(r'meetup-join/([^/?]+)', url)
        return m.group(1) if m else None
    if platform == "zoom":
        m = re.search(r'j/(\d+)', url)
        return m.group(1) if m else None
    return None

_BOOTING_STATUSES = {"requested", "joining", "awaiting_admission"}
_SUPPORTED_PLATFORMS = {"google_meet", "zoom", "teams", "browser_session"}


def _coerce_user_id(*values: object) -> Optional[int]:
    for value in values:
        if value is None or value == "":
            continue
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                continue
            try:
                return int(raw)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="user_id must be an integer") from exc
    return None


def _default_external_user_id() -> int:
    configured = os.getenv("EXTERNAL_API_USER_ID") or os.getenv("VEXA_EXTERNAL_API_USER_ID") or "1"
    try:
        return int(configured)
    except ValueError:
        return 1


async def _resolve_meeting_owner(repo: MeetingRepo, meeting_id: int) -> Optional[int]:
    find_by_id = getattr(repo, "find_by_id", None)
    if not callable(find_by_id):
        return None
    meeting = await find_by_id(meeting_id)
    if not meeting:
        return None
    owner = meeting.get("user_id")
    return int(owner) if isinstance(owner, int) else _coerce_user_id(owner)


async def _resolve_active_meeting(
    repo: MeetingRepo,
    *,
    platform: str,
    native_meeting_id: str,
    requested_user_id: Optional[int],
) -> Optional[dict]:
    candidate_ids: list[int] = []
    if requested_user_id is not None:
        candidate_ids.append(requested_user_id)
    default_user_id = _default_external_user_id()
    if default_user_id not in candidate_ids:
        candidate_ids.append(default_user_id)
    for user_id in candidate_ids:
        meeting = await repo.find_active(user_id, platform, native_meeting_id)
        if meeting:
            return meeting

    find_any = getattr(repo, "find_active_any_user", None)
    if callable(find_any):
        return await find_any(platform, native_meeting_id)
    return None

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
        if platform not in _SUPPORTED_PLATFORMS:
            raise HTTPException(status_code=422, detail=f"unsupported platform '{platform}'")
        bot_name = body.get("bot_name", "Vexa Recorder")
        language = body.get("language", "pt-BR")
        user_id = _coerce_user_id(
            body.get("user_id"),
            request.headers.get("X-User-Id"),
            request.query_params.get("user_id"),
        ) or _default_external_user_id()
        recording_enabled = _resolve_recording_enabled(body.get("recording_enabled"))
        transcribe_enabled = _resolve_transcribe_enabled(body.get("transcribe_enabled"))
        max_concurrent = _coerce_user_id(body.get("max_concurrent")) or 10

        native_id = _extract_native_id(platform, meeting_url)
        if not native_id:
            raise HTTPException(status_code=422, detail="Invalid meeting URL for the specified platform")

        try:
            meeting = await request_bot(
                repo,
                runtime,
                user_id=user_id,
                platform=platform,
                native_meeting_id=native_id,
                meeting_url=meeting_url,
                bot_name=bot_name,
                default_avatar_url="",
                language=language,
                transcription_tier="realtime",
                recording_enabled=recording_enabled,
                transcribe_enabled=transcribe_enabled,
                max_concurrent=max_concurrent,
            )
        except DuplicateMeeting as e:
            raise HTTPException(status_code=409, detail=str(e))
        except MaxBotsExceeded as e:
            raise HTTPException(status_code=429, detail=str(e))
        except SpawnFailed as e:
            raise HTTPException(status_code=502, detail=str(e))

        return JSONResponse(status_code=201, content=meeting)

    @router.api_route("/bots/{platform}/{native_meeting_id}/stop", methods=["POST", "DELETE"])
    @router.delete("/bots/{platform}/{native_meeting_id}")
    async def stop_meeting(
        request: Request,
        platform: str,
        native_meeting_id: str,
        x_api_key: str = Depends(verify_api_key)
    ):
        if platform not in _SUPPORTED_PLATFORMS:
            raise HTTPException(status_code=422, detail=f"unsupported platform '{platform}'")

        requested_user_id = _coerce_user_id(
            request.headers.get("X-User-Id"),
            request.query_params.get("user_id"),
        )
        meeting = await _resolve_active_meeting(
            repo,
            platform=platform,
            native_meeting_id=native_meeting_id,
            requested_user_id=requested_user_id,
        )
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

    @router.post("/bots/stop-all")
    async def stop_all_meetings(request: Request, x_api_key: str = Depends(verify_api_key)):
        """Finds all active meetings, marks them as stopping, sends the leave command, and tears down boots."""
        active_meetings = await repo.list_all_active()
        if not active_meetings:
            return JSONResponse(content={"status": "ok", "message": "No active meetings to stop", "count": 0})
            
        stopped_count = 0
        for meeting in active_meetings:
            meeting_id = meeting["id"]
            status = meeting.get("status")
            bot_container_id = meeting.get("bot_container_id")
            
            try:
                sessions = await repo.list_sessions(meeting_id=meeting_id)
                if sessions:
                    await repo.update_meeting_status(
                        session_uid=sessions[-1], status="stopping", data={"stop_requested": True},
                    )
                    
                cmd = json.dumps({"action": "leave"})
                await command_publisher.publish(f"bot_commands:meeting:{meeting_id}", cmd)
                
                if runtime is not None and bot_container_id and status in _BOOTING_STATUSES:
                    try:
                        await runtime.delete_workload(bot_container_id)
                    except Exception:
                        pass
                stopped_count += 1
            except Exception as e:
                # Log but continue to stop others
                pass
                
        return JSONResponse(content={"status": "ok", "message": f"Stop command issued for {stopped_count} meetings", "count": stopped_count})

    @router.post("/meetings/{meeting_id}/transcribe")
    async def transcribe_meeting(
        request: Request,
        meeting_id: int,
        x_api_key: str = Depends(verify_api_key)
    ):
        requested_user_id = _coerce_user_id(
            request.headers.get("X-User-Id"),
            request.query_params.get("user_id"),
        )
        owner_user_id = requested_user_id
        if owner_user_id is None:
            owner_user_id = await _resolve_meeting_owner(repo, meeting_id)
        if owner_user_id is None:
            owner_user_id = _default_external_user_id()

        transcript = await transcript_store.get_transcript_by_id(user_id=owner_user_id, meeting_id=meeting_id)
        
        if not transcript:
            raise HTTPException(status_code=404, detail="Transcript not found or meeting still active")
            
        return JSONResponse(content=transcript)

    @router.get("/bots/debug")
    async def get_debug_logs(x_api_key: str = Depends(verify_api_key)):
        import glob
        logs = {}
        for path in glob.glob("/tmp/vexa-workloads/*.log"):
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    logs[os.path.basename(path)] = f.read()[-50000:] # Last 50k chars to avoid huge payloads
            except Exception as e:
                logs[os.path.basename(path)] = f"Error reading log: {str(e)}"
        
        # Also return screenshots if they exist
        screenshots = []
        try:
            for path in glob.glob("/app/storage/screenshots/*.png"):
                screenshots.append(os.path.basename(path))
        except:
            pass
        logs["screenshots"] = "\n".join(screenshots)

        return JSONResponse(content=logs)

    return router
