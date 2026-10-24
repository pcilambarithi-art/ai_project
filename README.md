# AI Project Builder

A full-stack starter application for turning a topic/specification into a generated project, previewing its files, downloading a ZIP, and publishing to GitHub after OAuth authorization.

## Stack
- Frontend: React + Vite
- Backend: FastAPI
- AI: OpenAI-compatible chat completions endpoint configurable by environment
- GitHub: GitHub OAuth App + REST API
- Document extraction: PDF, DOCX, TXT, common image formats (OCR via Tesseract when installed)

## Important status
This is a functional implementation, but external integrations require credentials and local setup:
- AI generation requires `AI_API_KEY` and a compatible API endpoint/model.
- GitHub publishing requires a GitHub OAuth App client ID/secret and callback URL.
- Image OCR requires the Tesseract executable installed on the host.
- OAuth/session security settings must be configured for the deployment origin. Use HTTPS in production.

The generator asks the AI for a JSON file manifest and validates every path. It is not a sandbox: generated source code is untrusted. Review before running or publishing it.

## Requirements
- Python 3.11+
- Node.js 20+
- GitHub OAuth App (callback URL: `http://localhost:8000/api/github/callback` for local development)

## Setup

### 1. Backend
```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```
Edit `backend/.env` and set `AI_API_KEY`, `AI_MODEL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, and `FRONTEND_URL`. For an OpenAI-compatible endpoint, set `AI_BASE_URL` (default is `https://api.openai.com/v1`).

Run:
```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Frontend
In a second terminal:
```powershell
cd frontend
npm install
npm run dev
```
Open the Vite URL shown in the terminal (usually http://localhost:5173).

### 3. GitHub OAuth
Create an OAuth App in GitHub Developer Settings:
- Homepage URL: `http://localhost:5173`
- Authorization callback URL: `http://localhost:8000/api/github/callback`
- Set its client ID and secret in `backend/.env`.

The backend requests the `repo` scope because it needs to create private/public repositories and write files to repositories. GitHub's OAuth scope is broad; for stricter least-privilege deployments, replace this with a GitHub App installation flow and repository-scoped permissions.

## Tests
```powershell
cd backend
pytest
```

## API
- `GET /api/health`
- `POST /api/projects/analyze` — accepts multipart `topic`, optional `language`, optional `files`
- `POST /api/projects/generate` — generates and stores a project manifest
- `GET /api/projects/{project_id}/files`
- `GET /api/projects/{project_id}/files/{path}` — preview a file
- `GET /api/projects/{project_id}/download`
- `GET /api/github/login`
- `GET /api/github/callback`
- `GET /api/github/repositories`
- `POST /api/github/publish`

## Security notes
- Set a random `SESSION_SECRET` and use HTTPS outside local development.
- Configure `COOKIE_SECURE=true` for HTTPS deployments.
- Do not expose backend `.env`; `.gitignore` excludes it.
- Generated projects cannot include credential-like files; archive and publish filters deny common secret filenames and directories.
- Uploaded files are capped at 10 MiB each and the combined extracted text is capped.
- OAuth state is single-use and validated. Session cookies are HttpOnly and SameSite=Lax.
- The sample stores project manifests and OAuth tokens in process memory; data is lost on restart and this is not suitable for multi-worker/production use. Use encrypted persistent storage and a shared session backend for deployment.
