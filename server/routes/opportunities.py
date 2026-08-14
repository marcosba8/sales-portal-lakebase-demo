"""Opportunity (pipeline) routes."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from server.db import get_conn
from server.schema_detector import detect_features

router = APIRouter(prefix="/api/opportunities", tags=["opportunities"])

# Allowed values (mirror the seed data). Stage -> probability is derived
# server-side so demo data stays internally consistent.
PRODUCT_LINES = ["Platform", "Data Warehouse", "ML/AI", "Governance", "Streaming"]
STAGE_PROBABILITY = {
    "Prospecting": 10,
    "Qualification": 25,
    "Proposal": 50,
    "Negotiation": 75,
    "Closed Won": 100,
    "Closed Lost": 0,
}


class NewOpportunity(BaseModel):
    """Payload for creating an opportunity. account_id must reference an
    existing account (validated below) so no fake customers are introduced.
    Probability is derived from stage, not accepted from the client."""
    account_id: int
    product_line: str
    stage: str
    amount_usd: float = Field(gt=0)
    close_date: str  # ISO date, e.g. "2026-09-30"

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

@router.post("")
def create_opportunity(payload: NewOpportunity):
    """Insert a new opportunity (the app's write-back path — feeds Lakebase CDF).

    Validates the account exists and the stage/product are known values, derives
    probability from stage, and auto-assigns a unique opp_number. Returns the
    created row in the same shape as the list endpoint so the UI can prepend it.
    """
    # Validate enums up front (parameterized insert still, but fail clearly).
    if payload.product_line not in PRODUCT_LINES:
        raise HTTPException(400, detail=f"Unknown product line '{payload.product_line}'.")
    if payload.stage not in STAGE_PROBABILITY:
        raise HTTPException(400, detail=f"Unknown stage '{payload.stage}'.")
    probability = STAGE_PROBABILITY[payload.stage]

    with get_conn() as conn:
        features = detect_features(conn)
        if not features["opportunities_available"]:
            raise HTTPException(503, detail="Pipeline temporarily unavailable.")

        cur = conn.cursor()

        # Guard: account must exist (no fake customers).
        cur.execute("SELECT name, segment FROM sales.accounts WHERE id = %s", (payload.account_id,))
        acct = cur.fetchone()
        if not acct:
            raise HTTPException(400, detail="Selected account does not exist.")
        account_name, segment = acct

        # Auto-assign a unique opp_number (max+1, or 1000 if empty).
        cur.execute("SELECT COALESCE(MAX(opp_number), 999) + 1 FROM sales.opportunities")
        opp_number = cur.fetchone()[0]

        cur.execute(
            """
            INSERT INTO sales.opportunities
                (account_id, close_date, opp_number, amount_usd, stage, probability, product_line)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id, account_id, close_date, opp_number, amount_usd,
                      stage, probability, product_line,
                      ROUND(amount_usd * probability / 100.0, 2) AS weighted_amount
            """,
            (payload.account_id, payload.close_date, opp_number, payload.amount_usd,
             payload.stage, probability, payload.product_line),
        )
        col_names = [desc[0] for desc in cur.description]
        row = dict(zip(col_names, cur.fetchone()))
        row["account_name"] = account_name
        row["segment"] = segment

    return {"opportunity": row}


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
