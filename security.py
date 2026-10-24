import re
from pathlib import PurePosixPath

DENIED_NAMES = {".env", ".env.local", ".env.production", "id_rsa", "id_ed25519", "credentials.json"}
DENIED_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", "dist", "build"}

def safe_project_path(value: str) -> str:
    if not value or len(value) > 240 or "\\" in value or "\x00" in value:
        raise ValueError("Invalid project path")
    p = PurePosixPath(value)
    if p.is_absolute() or any(part in ("", ".", "..") for part in p.parts):
        raise ValueError("Path traversal or absolute paths are not allowed")
    if any(part.lower() in DENIED_DIRS for part in p.parts):
        raise ValueError("Generated dependency/cache directories are not allowed")
    if p.name.lower() in DENIED_NAMES or p.name.lower().startswith(".env."):
        raise ValueError("Credential/environment files cannot be generated or published")
    if re.search(r"(secret|token|password|private[_-]?key)", p.name, re.I):
        raise ValueError("Potential credential filename is blocked")
    return p.as_posix()

def is_publishable(path: str) -> bool:
    try:
        safe_project_path(path)
        return True
    except ValueError:
        return False
