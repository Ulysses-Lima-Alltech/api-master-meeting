import asyncio

from fastapi.testclient import TestClient

from meeting_api import create_app
from meeting_api.bot_spawn.fakes import InMemoryMeetingRepo
from meeting_api.collector.fakes import InMemoryTranscriptStore


AUTH = {"X-API-Key": "test-internal-secret"}


def test_external_stop_resolves_meeting_owner_without_hardcoded_user_one(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", AUTH["X-API-Key"])

    repo = InMemoryMeetingRepo()
    meeting = asyncio.run(
        repo.create_meeting(user_id=4, platform="google_meet", native_meeting_id="abc-defg-hij", data={})
    )
    asyncio.run(repo.create_session(meeting_id=meeting["id"], session_uid="sess-1"))

    app = create_app(meeting_repo=repo, transcript_store=InMemoryTranscriptStore())
    client = TestClient(app)

    r = client.delete("/api/external/bots/google_meet/abc-defg-hij", headers=AUTH)
    assert r.status_code == 200
    assert r.json() == {"status": "stopping", "meeting_id": meeting["id"]}
    assert repo._meetings[meeting["id"]]["status"] == "stopping"
    assert app.state.command_publisher.published[-1] == (
        f"bot_commands:meeting:{meeting['id']}",
        '{"action": "leave"}',
    )


def test_external_transcribe_resolves_transcript_owner_from_meeting_id(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", AUTH["X-API-Key"])

    repo = InMemoryMeetingRepo()
    meeting = asyncio.run(
        repo.create_meeting(user_id=4, platform="google_meet", native_meeting_id="abc-defg-hij", data={})
    )
    store = InMemoryTranscriptStore()
    store.seed_meeting(
        meeting_id=meeting["id"],
        user_id=4,
        platform="google_meet",
        native_meeting_id="abc-defg-hij",
        status="completed",
        segments=[
            {
                "segment_id": "seg-1",
                "start": 0.0,
                "end": 1.0,
                "text": "teste",
                "language": "pt-BR",
            }
        ],
    )

    client = TestClient(create_app(meeting_repo=repo, transcript_store=store))
    r = client.post(f"/api/external/meetings/{meeting['id']}/transcribe", headers=AUTH)

    assert r.status_code == 200
    body = r.json()
    assert body["id"] == meeting["id"]
    assert body["segments"][0]["text"] == "teste"
