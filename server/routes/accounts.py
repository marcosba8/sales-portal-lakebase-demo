"""Account API routes."""
from fastapi import APIRouter, HTTPException
from server.db import get_conn
from server.schema_detector import detect_features

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

@router.get("")
def list_accounts():
    with get_conn() as conn:
        features = detect_features(conn)
        if not features["accounts_available"]:
            raise HTTPException(503, "Accounts service temporarily unavailable")

        cur = conn.cursor()

        # Build dynamic SELECT based on available columns
        cols = "id, name, industry, region, segment, owner_rep, tier, status, created_date"
        if features["health_score_active"]:
            cols += ", health_score"

        cur.execute(f"SELECT {cols} FROM sales.accounts ORDER BY created_date DESC")
        col_names = [desc[0] for desc in cur.description]
        rows = [dict(zip(col_names, row)) for row in cur.fetchall()]

        return {"accounts": rows, "features": features}

@router.get("/{account_id}")
def get_account(account_id: int):
    with get_conn() as conn:
        features = detect_features(conn)
        if not features["accounts_available"]:
            raise HTTPException(503, "Accounts service temporarily unavailable")

        cur = conn.cursor()
        cols = "id, name, industry, region, segment, owner_rep, tier, status, created_date"
        if features["health_score_active"]:
            cols += ", health_score"

        cur.execute(f"SELECT {cols} FROM sales.accounts WHERE id = %s", (account_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Account not found")

        col_names = [desc[0] for desc in cur.description]
        account = dict(zip(col_names, row))

        # Get renewals if available
        if features["renewals_active"]:
            cur.execute("""
                SELECT renewal_type, contract_value_usd, renewal_date, likelihood
                FROM sales.renewals
                WHERE account_id = %s ORDER BY renewal_date
            """, (account_id,))
            renewal_cols = [desc[0] for desc in cur.description]
            account["renewals"] = [dict(zip(renewal_cols, r)) for r in cur.fetchall()]

        # Get risk alerts if available
        if features["alerts_active"]:
            cur.execute("""
                SELECT alert_type, severity, message, created_at
                FROM sales.risk_alerts
                WHERE account_id = %s ORDER BY created_at DESC
            """, (account_id,))
            alert_cols = [desc[0] for desc in cur.description]
            account["alerts"] = [dict(zip(alert_cols, r)) for r in cur.fetchall()]

        return {"account": account, "features": features}
