"""Feature flags endpoint - polled by frontend every 30 seconds."""
from fastapi import APIRouter
from server.db import get_conn
from server.schema_detector import detect_features, invalidate_cache

router = APIRouter(prefix="/api", tags=["features"])

@router.get("/features")
def get_features():
    with get_conn() as conn:
        return detect_features(conn)

@router.get("/health")
def health():
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "database": str(e)}

@router.post("/features/refresh")
def refresh_features():
    invalidate_cache()
    with get_conn() as conn:
        return detect_features(conn)
