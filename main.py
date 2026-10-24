from __future__ import annotations
import asyncio, hashlib, hmac, json, secrets, time, zipfile
from io import BytesIO
from typing import Any
from urllib.parse import urlencode
import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware
from .config import settings
from .documents import extract_text
from .ai import generate_manifest
from .security import safe_project_path, is_publishable

app = FastAPI(title="AI Project Builder API", version="1.0.0")
app.add_middleware(SessionMiddleware, secret_key=settings.session_secret, same_site="lax", https_only=settings.cookie_secure, max_age=3600)
app.add_middleware(CORSMiddleware, allow_origins=[settings.frontend_url], allow_credentials=True, allow_methods=["GET","POST","OPTIONS"], allow_headers=["Content-Type"])
PROJECTS: dict[str, dict[str, Any]] = {}
OAUTH_STATES: dict[str, float] = {}
GITHUB_TOKENS: dict[str, str] = {}
MAX_FILE_BYTES = max(1, settings.max_upload_mb) * 1024 * 1024

class GenerateRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=20000)
    language: str = Field(default="React + FastAPI", max_length=120)
    requirements: str = Field(default="", max_length=120000)

class PublishRequest(BaseModel):
    project_id: str
    mode: str = Field(pattern="^(create|existing)$")
    repo_name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=350)
    private: bool = True
    branch: str = Field(default="main", min_length=1, max_length=100)
    confirm: bool = False
    owner: str | None = None

def github_ready():
    return bool(settings.github_client_id and settings.github_client_secret)

def get_token(request: Request) -> str:
    token = GITHUB_TOKENS.get(request.session.get("sid", ""))
    if not token:
        raise HTTPException(401, "Connect GitHub first.")
    return token

async def gh_request(method: str, url: str, token: str, **kwargs):
    async with httpx.AsyncClient(timeout=45) as client:
        r = await client.request(method, url, headers={
            "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "AI-Project-Builder"
        }, **kwargs)
    if r.status_code >= 400:
        detail = "GitHub API request failed"
        try:
            body = r.json()
            detail = body.get("message", detail)
            if r.status_code == 403 and r.headers.get("X-RateLimit-Remaining") == "0":
                detail = "GitHub API rate limit reached. Try again later."
        except Exception:
            pass
        raise HTTPException(r.status_code if r.status_code < 500 else 502, detail)
    return r

@app.get("/api/health")
async def health():
    return {"status": "ok", "ai_configured": bool(settings.ai_api_key), "github_configured": github_ready()}

@app.post("/api/projects/analyze")
async def analyze(topic: str = Form(""), language: str = Form("React + FastAPI"), files: list[UploadFile] = File(default=[])):
    extracted = []
    for f in files:
        if not f.filename:
            continue
        if f.size and f.size > MAX_FILE_BYTES:
            raise HTTPException(413, f"{f.filename} exceeds the upload limit.")
        data = await f.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(413, f"{f.filename} exceeds the upload limit.")
        try:
            text = extract_text(f.filename, data)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if text.strip():
            extracted.append(f"--- {f.filename} ---\n{text}")
    return {"topic": topic[:20000], "language": language, "requirements": "\n\n".join(extracted)[:120000], "uploaded_files": len(files)}

@app.post("/api/projects/generate")
async def generate(req: GenerateRequest):
    if not req.topic.strip() and not req.requirements.strip():
        raise HTTPException(400, "Enter a project topic or upload a specification.")
    try:
        manifest = await generate_manifest(req.topic.strip() or "Use the uploaded specification", req.language, req.requirements)
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"AI provider error ({e.response.status_code}). Check provider settings and quota.")
    except (httpx.HTTPError, RuntimeError) as e:
        raise HTTPException(502, str(e))
    files: dict[str, str] = {}
    for item in manifest["files"]:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str) or not isinstance(item.get("content"), str):
            continue
        try:
            path = safe_project_path(item["path"])
        except ValueError:
            continue
        if len(item["content"].encode("utf-8")) > 2_000_000:
            continue
        files[path] = item["content"]
    if not files:
        raise HTTPException(502, "AI returned no safe project files. Retry with a more specific prompt.")
    pid = secrets.token_urlsafe(18)
    PROJECTS[pid] = {"id": pid, "name": str(manifest.get("project_name") or "generated-project")[:100], "summary": str(manifest.get("summary") or "")[:2000], "files": files, "created": time.time()}
    return {"project_id": pid, "project_name": PROJECTS[pid]["name"], "summary": PROJECTS[pid]["summary"], "files": [{"path": p, "size": len(c.encode("utf-8"))} for p,c in sorted(files.items())]}

def get_project(project_id: str):
    project = PROJECTS.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found or server restarted.")
    return project

@app.get("/api/projects/{project_id}/files")
async def list_files(project_id: str):
    p = get_project(project_id)
    return {"project_id": project_id, "project_name": p["name"], "summary": p["summary"], "files": [{"path": n, "size": len(c.encode("utf-8"))} for n,c in sorted(p["files"].items())]}

@app.get("/api/projects/{project_id}/files/{path:path}")
async def preview_file(project_id: str, path: str):
    p = get_project(project_id)
    try:
        path = safe_project_path(path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if path not in p["files"]:
        raise HTTPException(404, "File not found.")
    return {"path": path, "content": p["files"][path]}

@app.get("/api/projects/{project_id}/download")
async def download_project(project_id: str):
    p = get_project(project_id)
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in sorted(p["files"].items()):
            if is_publishable(path):
                zf.writestr(f"{p['name']}/{path}", content)
    buffer.seek(0)
    filename = "".join(c for c in p["name"] if c.isalnum() or c in "-_") or "project"
    return StreamingResponse(buffer, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{filename}.zip"'})

@app.get("/api/github/login")
async def github_login(request: Request):
    if not github_ready():
        raise HTTPException(503, "Configure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in backend/.env.")
    state = secrets.token_urlsafe(32)
    OAUTH_STATES[state] = time.time() + 600
    request.session["sid"] = request.session.get("sid") or secrets.token_urlsafe(24)
    request.session["oauth_state"] = state
    params = urlencode({"client_id": settings.github_client_id, "redirect_uri": settings.github_callback_url, "scope": "repo", "state": state})
    return RedirectResponse("https://github.com/login/oauth/authorize?" + params, status_code=302)

@app.get("/api/github/callback")
async def github_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error:
        raise HTTPException(400, "GitHub authorization was cancelled or denied.")
    expected = request.session.pop("oauth_state", None)
    expiry = OAUTH_STATES.pop(state, 0)
    if not expected or not hmac.compare_digest(str(expected), state) or expiry < time.time() or not code:
        raise HTTPException(400, "Invalid or expired OAuth state. Restart GitHub connection.")
    if not github_ready():
        raise HTTPException(503, "GitHub OAuth is not configured.")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post("https://github.com/login/oauth/access_token", headers={"Accept":"application/json"}, data={
            "client_id": settings.github_client_id, "client_secret": settings.github_client_secret,
            "code": code, "redirect_uri": settings.github_callback_url
        })
    if r.status_code >= 400 or not r.json().get("access_token"):
        raise HTTPException(502, "GitHub token exchange failed.")
    sid = request.session.get("sid") or secrets.token_urlsafe(24)
    request.session["sid"] = sid
    GITHUB_TOKENS[sid] = r.json()["access_token"]
    return RedirectResponse(settings.frontend_url + "/?github=connected", status_code=303)

@app.get("/api/github/repositories")
async def repositories(request: Request):
    token = get_token(request)
    r = await gh_request("GET", "https://api.github.com/user", token)
    user = r.json()
    repos = await gh_request("GET", "https://api.github.com/user/repos?per_page=100&sort=updated", token)
    return {"user": {"login": user.get("login"), "avatar_url": user.get("avatar_url")}, "repositories": [{"full_name": x["full_name"], "private": x["private"], "default_branch": x.get("default_branch","main"), "html_url": x["html_url"]} for x in repos.json()]}

@app.post("/api/github/publish")
async def publish(req: PublishRequest, request: Request):
    if not req.confirm:
        raise HTTPException(400, "Review the file list and set confirm=true before publishing.")
    token = get_token(request)
    p = get_project(req.project_id)
    if not p["files"]:
        raise HTTPException(400, "No files to publish.")
    me = (await gh_request("GET", "https://api.github.com/user", token)).json()
    owner = req.owner or me.get("login")
    if req.mode == "create":
        created = await gh_request("POST", "https://api.github.com/user/repos", token, json={
            "name": req.repo_name, "description": req.description, "private": req.private, "auto_init": True
        })
        repo = created.json()
        owner = repo["owner"]["login"]
    else:
        if not owner:
            raise HTTPException(400, "Repository owner is required.")
        repo = (await gh_request("GET", f"https://api.github.com/repos/{owner}/{req.repo_name}", token)).json()
    branch = req.branch or repo.get("default_branch") or "main"
    # Confirm target branch exists; for a newly created auto-initialized repo use its default branch if requested branch is absent.
    try:
        ref = (await gh_request("GET", f"https://api.github.com/repos/{owner}/{req.repo_name}/git/ref/heads/{branch}", token)).json()
        base_sha = ref["object"]["sha"]
    except HTTPException:
        if req.mode == "create" and branch != repo.get("default_branch", "main"):
            branch = repo.get("default_branch", "main")
            ref = (await gh_request("GET", f"https://api.github.com/repos/{owner}/{req.repo_name}/git/ref/heads/{branch}", token)).json()
            base_sha = ref["object"]["sha"]
        else:
            raise HTTPException(409, "Target branch does not exist. Choose an existing branch or create it first.")
    base_commit = (await gh_request("GET", f"https://api.github.com/repos/{owner}/{req.repo_name}/git/commits/{base_sha}", token)).json()
    tree_items = []
    count = 0
    for path, content in sorted(p["files"].items()):
        if not is_publishable(path):
            continue
        if len(content.encode("utf-8")) > 1_000_000:
            continue
        blob = (await gh_request("POST", f"https://api.github.com/repos/{owner}/{req.repo_name}/git/blobs", token, json={"content":content,"encoding":"utf-8"})).json()
        tree_items.append({"path":path,"mode":"100644","type":"blob","sha":blob["sha"]})
        count += 1
    if not tree_items:
        raise HTTPException(400, "No publishable files found.")
    tree = (await gh_request("POST", f"https://api.github.com/repos/{owner}/{req.repo_name}/git/trees", token, json={"base_tree":base_commit["tree"]["sha"],"tree":tree_items})).json()
    commit = (await gh_request("POST", f"https://api.github.com/repos/{owner}/{req.repo_name}/git/commits", token, json={
        "message": "Publish generated project with AI Project Builder", "tree":tree["sha"], "parents":[base_sha]
    })).json()
    await gh_request("PATCH", f"https://api.github.com/repos/{owner}/{req.repo_name}/git/refs/heads/{branch}", token, json={"sha":commit["sha"],"force":False})
    return {"status":"published","repository_url":repo.get("html_url") or f"https://github.com/{owner}/{req.repo_name}","branch":branch,"commit":commit["html_url"],"files_published":count}

@app.get("/api/github/status")
async def github_status(request: Request):
    try:
        token = get_token(request)
        user = (await gh_request("GET", "https://api.github.com/user", token)).json()
        return {"connected": True, "login": user.get("login")}
    except HTTPException as exc:
        if exc.status_code == 401:
            return {"connected": False}
        raise

@app.post("/api/github/logout")
async def github_logout(request: Request):
    sid = request.session.get("sid")
    if sid:
        GITHUB_TOKENS.pop(sid, None)
    request.session.clear()
    return {"connected": False}
