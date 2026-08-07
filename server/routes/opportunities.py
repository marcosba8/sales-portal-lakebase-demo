"""Opportunity (pipeline) routes."""
from fastapi import APIRouter, HTTPException
from server.db import get_conn
from server.schema_detector import detect_features

router = APIRouter(prefix="/api/opportunities", tags=["opportunities"])

@router.get("")
def list_opportunities():
    with get_conn() as conn:
        features = detect_features(conn)
        if not features["opportunities_available"]:
            raise HTTPException(503, detail="Pipeline temporarily unavailable.")

        cur = conn.cursor()
        cur.execute("""
            SELECT o.id, o.account_id, a.name as account_name, a.segment,
                   o.close_date, o.opp_number, o.amount_usd,
                   o.stage, o.probability, o.product_line,
                   ROUND(o.amount_usd * o.probability / 100.0, 2) as weighted_amount
            FROM sales.opportunities o
            JOIN sales.accounts a ON o.account_id = a.id
            ORDER BY o.close_date DESC
            LIMIT 100
        """)
        col_names = [desc[0] for desc in cur.description]
        rows = [dict(zip(col_names, row)) for row in cur.fetchall()]
        return {"opportunities": rows, "features": features}

@router.get("/stats")
def opportunity_stats():
    with get_conn() as conn:
        features = detect_features(conn)
        if not features["opportunities_available"]:
            raise HTTPException(503, detail="Pipeline temporarily unavailable.")

        cur = conn.cursor()
        cur.execute("""
            SELECT
                COUNT(*) as total_opps,
                ROUND(SUM(amount_usd), 2) as total_pipeline_usd,
                ROUND(SUM(amount_usd * probability / 100.0), 2) as weighted_pipeline_usd,
                ROUND(AVG(amount_usd), 2) as avg_deal_size_usd
            FROM sales.opportunities
        """)
        row = cur.fetchone()
        col_names = [desc[0] for desc in cur.description]
        return {"stats": dict(zip(col_names, row)), "features": features}
