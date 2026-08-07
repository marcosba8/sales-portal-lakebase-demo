"""Retention-risk routes, powered by the churn-prediction synced table."""
from fastapi import APIRouter, HTTPException
from server.db import get_conn
from server.schema_detector import detect_features

router = APIRouter(prefix="/api/churn", tags=["churn"])

@router.get("")
def list_churn():
    with get_conn() as conn:
        features = detect_features(conn)
        if not features["churn_active"]:
            raise HTTPException(503, detail="Churn predictions not yet synced from the lakehouse.")

        cur = conn.cursor()
        cur.execute("""
            SELECT account_id, account_name, segment,
                   churn_risk_score, risk_band, predicted_arr_at_risk_usd,
                   top_churn_driver, recommended_action, model_version, scored_at
            FROM sales.churn_predictions
            ORDER BY churn_risk_score DESC
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
        cur.execute("""
            SELECT
                ROUND(SUM(predicted_arr_at_risk_usd), 2) as total_arr_at_risk_usd,
                COUNT(*) FILTER (WHERE risk_band = 'High') as high_risk_accounts,
                ROUND(AVG(churn_risk_score), 2) as avg_churn_score,
                MAX(model_version) as model_version,
                MAX(scored_at) as scored_at
            FROM sales.churn_predictions
        """)
        row = cur.fetchone()
        col_names = [desc[0] for desc in cur.description]
        return {"stats": dict(zip(col_names, row)), "features": features}
