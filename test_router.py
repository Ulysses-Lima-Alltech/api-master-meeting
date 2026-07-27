from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn
import httpx
import json

app = FastAPI()

def _meeting(path: str) -> str:
    return f"http://127.0.0.1:8081{path}"
    
def _agent(path: str) -> str:
    return f"http://127.0.0.1:8100/api/{path}"

@app.api_route("/api/external/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_external_api(path: str, request: Request):
    return JSONResponse({"target": _meeting(f"/api/external/{path}")})

@app.api_route("/agent/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def agent_proxy(path: str, request: Request):
    return JSONResponse({"target": _agent(path)})

# Write to file and test
