"""Retention-risk routes, powered by the churn-prediction synced table."""
from fastapi import APIRouter, HTTPException
from server.db import get_conn, CHURN_TABLE
from server.schema_detector import detect_features

router = APIRouter(prefix="/api/churn", tags=["churn"])

@router.get("")
def list_churn():
    with get_conn() as conn:
        features = detect_features(conn)
        if not features["churn_active"]:
            raise HTTPException(503, detail="Churn predictions not yet synced from the lakehouse.")

        cur = conn.cursor()
        # Source account_name (and segment) from sales.accounts by joining on
        # account_id — the SAME source the "unknown" pre-sync view uses — so the
        # scored rows are guaranteed to be the exact accounts already shown,
        # regardless of the names baked into the gold table. The gold/synced
        # table still drives the scores, bands, ARR, drivers, etc.
        cur.execute(f"""
            SELECT c.account_id, a.name AS account_name, a.segment,
                   c.churn_risk_score, c.risk_band, c.predicted_arr_at_risk_usd,
                   c.top_churn_driver, c.recommended_action, c.model_version, c.scored_at
            FROM {CHURN_TABLE} c
            JOIN sales.accounts a ON a.id = c.account_id
            ORDER BY c.churn_risk_score DESC
            LIMIT 200
        """)
        col_names = [desc[0] for desc in cur.description]
        rows = [dict(zip(col_names, row)) for row in cur.fetchall()]
        return {"churn": rows, "features": features}

@router.get("/stats")
def churn_stats():
    with get_conn() as conn:
        features = detect_features(conn)
        if not features["churn_active"]:
            raise HTTPException(503, detail="Churn predictions not yet synced from the lakehouse.")

        cur = conn.cursor()
        cur.execute(f"""
            SELECT
                ROUND(SUM(predicted_arr_at_risk_usd), 2) as total_arr_at_risk_usd,
                COUNT(*) FILTER (WHERE risk_band = 'High') as high_risk_accounts,
                ROUND(AVG(churn_risk_score), 2) as avg_churn_score,
                MAX(model_version) as model_version,
                MAX(scored_at) as scored_at
            FROM {CHURN_TABLE}
        """)
        row = cur.fetchone()
        col_names = [desc[0] for desc in cur.description]
        return {"stats": dict(zip(col_names, row)), "features": features}
