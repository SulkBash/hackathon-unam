"""API del proyecto Hackathon NFL Big Data Bowl UNAM.

Ejecuta en desarrollo:
  Windows: .\\.venv\\Scripts\\uvicorn backend.main:app --reload
  macOS/Linux: .venv/bin/uvicorn backend.main:app --reload
"""
import os
from pathlib import Path

from fastapi import FastAPI


def cargar_env() -> None:
    f = Path(__file__).resolve().parent.parent / ".env"
    if f.exists():
        for linea in f.read_text(encoding="utf-8-sig").splitlines():
            linea = linea.strip()
            if linea and not linea.startswith("#") and "=" in linea:
                k, v = linea.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


cargar_env()

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"

app = FastAPI(title="Hackathon NFL UNAM")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/status")
def api_status() -> dict:
    files = sorted(
        p.name for p in DATA_DIR.iterdir()
        if p.is_file() and not p.name.startswith(".")
    ) if DATA_DIR.exists() else []
    return {"status": "ok", "data_files": files}
