import pytest
from app.security import safe_project_path, is_publishable

def test_safe_paths():
    assert safe_project_path("src/main.py") == "src/main.py"
    with pytest.raises(ValueError): safe_project_path("../secret.txt")
    with pytest.raises(ValueError): safe_project_path(".env")
    with pytest.raises(ValueError): safe_project_path("node_modules/x.js")
    assert not is_publishable("config/.env.production")
