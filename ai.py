import json
import httpx
from .config import settings

SYSTEM = '''You are a senior software engineer. Produce a complete, coherent, runnable project based on the specification.
Return ONLY valid JSON with shape {"project_name":"short-name","summary":"...","files":[{"path":"relative/path","content":"complete file text"}]}.
Include the requested functional application, tests where useful, README.md, .gitignore, .env.example, and dependency manifests. Do not include secrets or real credentials. Keep files focused and avoid binary files. Every path must be relative and use forward slashes. Never output .env, private keys, tokens, or dependency/build folders. For machine learning research projects, include reproducible data assumptions, training/evaluation scripts, metrics, and explainability where applicable. Do not claim to have trained a model or downloaded datasets unless the code actually does so.'''

async def generate_manifest(topic: str, language: str, requirements: str = "") -> dict:
    if not settings.ai_api_key:
        raise RuntimeError("AI_API_KEY is not configured in backend/.env")
    prompt = f"Preferred stack/language: {language}\nProject topic and requirements:\n{topic}\n\nExtracted uploaded specification:\n{requirements}"
    url = settings.ai_base_url.rstrip("/") + "/chat/completions"
    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=20.0)) as client:
        response = await client.post(url, headers={"Authorization": f"Bearer {settings.ai_api_key}"}, json={
            "model": settings.ai_model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
        })
        response.raise_for_status()
        payload = response.json()
    content = payload["choices"][0]["message"]["content"]
    try:
        manifest = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError("AI provider returned invalid JSON; retry generation.") from exc
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list):
        raise RuntimeError("AI response did not contain a valid files manifest.")
    return manifest
