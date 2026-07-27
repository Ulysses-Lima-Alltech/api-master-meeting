import pytest
from fastapi.testclient import TestClient
from meeting_api.app import create_app

@pytest.fixture
def client():
    app = create_app()
    return TestClient(app)

def test_evolution_webhook_audio_message(client):
    payload = {
        "event": "messages.upsert",
        "data": {
            "key": {
                "remoteJid": "5511999999999@s.whatsapp.net",
                "id": "3EB0ABCD1234",
                "fromMe": False
            },
            "pushName": "John Doe",
            "messageTimestamp": 1678888888,
            "message": {
                "audioMessage": {}
            }
        }
    }
    response = client.post("/webhooks/evolution", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert response.json()["processed_audio_messages"] == 1

def test_evolution_webhook_text_message_ignored(client):
    payload = {
        "event": "messages.upsert",
        "data": {
            "key": {
                "remoteJid": "5511999999999@s.whatsapp.net"
            },
            "message": {
                "conversation": "Hello!"
            }
        }
    }
    response = client.post("/webhooks/evolution", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert response.json()["processed_audio_messages"] == 0

def test_evolution_webhook_invalid_event(client):
    payload = {
        "event": "message.update",
        "data": {}
    }
    response = client.post("/webhooks/evolution", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "ignored"
