import logging
from typing import Any, Dict
from fastapi import APIRouter, Request, HTTPException

log = logging.getLogger("meeting_api.evolution")

def build_evolution_router() -> APIRouter:
    router = APIRouter(prefix="/webhooks/evolution", tags=["evolution"])

    @router.post("")
    async def evolution_webhook(request: Request) -> Dict[str, Any]:
        """
        Receives Evolution API webhooks, filters for audio messages, and triggers
        transcription + sales intelligence analysis.
        """
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON")

        event = body.get("event")
        if event not in ("messages.upsert", "MESSAGES_UPSERT"):
            return {"status": "ignored", "reason": f"Unhandled event type: {event}"}
            
        data = body.get("data")
        if not data:
            return {"status": "ignored", "reason": "No data"}
            
        messages = data if isinstance(data, list) else data.get("messages", [data])
        
        processed_count = 0
        for msg in messages:
            message_content = msg.get("message", {})
            
            # Check if it's an audio message (ignoring text/image/video for this pipeline)
            if "audioMessage" not in message_content:
                continue
                
            remote_jid = msg.get("key", {}).get("remoteJid", "")
            msg_id = msg.get("key", {}).get("id", "")
            
            log.info(f"Evolution Webhook: Processing audio message {msg_id} from {remote_jid}")
            
            # STUB: The actual audio extraction and STT pipeline would be called here.
            # 1. Download base64 audio via Evolution API /chat/base64Message endpoint
            # 2. Decode and send to Vexa's transcription backend (Whisper)
            # 3. Form a synthetic 'transcript' and push it to the LLM Sales Analysis routine
            # 4. Save to CallAnalysis table
            
            processed_count += 1
            
        return {"status": "success", "processed_audio_messages": processed_count}

    return router
