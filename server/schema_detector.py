"""Detect schema features with 5-second cache."""
import time
import logging
from server.db import CHURN_SCHEMA

logger = logging.getLogger(__name__)

_cache = {}
_cache_ttl = 5
_last_refresh = 0

def detect_features(conn) -> dict:
    """Query information_schema to detect available tables and columns."""
    global _cache, _last_refresh

    now = time.time()
    if _cache and (now - _last_refresh) < _cache_ttl:
        return _cache

    cur = conn.cursor()

    # Get all tables in the sales schema. Synced tables surface as regular
    # Postgres tables/views, so accept both.
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'sales' AND table_type IN ('BASE TABLE', 'VIEW', 'FOREIGN')
    """)
    tables = {row[0] for row in cur.fetchall()}

    # The churn synced table lands in GOLD_SCHEMA (not `sales`), so detect it
    # there separately. CHURN_SCHEMA is the SAME env-derived value the Act 4 sync
    # uses as the landing schema, so detection always matches where it landed.
    cur.execute("""
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = %s AND table_name = 'churn_predictions'
          AND table_type IN ('BASE TABLE', 'VIEW', 'FOREIGN')
    """, (CHURN_SCHEMA,))
    churn_present = cur.fetchone()[0] > 0

    # Get columns for key tables
    cur.execute("""
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'sales'
    """)
    columns = {}
    for table, col in cur.fetchall():
        columns.setdefault(table, set()).add(col)

    features = {
        "accounts_available": "accounts" in tables,
        "opportunities_available": "opportunities" in tables,
        "activities_available": "sales_activities" in tables,
        "renewals_active": "renewals" in tables,
        "alerts_active": "risk_alerts" in tables,
        "health_score_active": "health_score" in columns.get("accounts", set()),
        "churn_active": churn_present,
    }

    _cache = features
    _last_refresh = now
    logger.info(f"Schema features refreshed: {features}")
    return features

def invalidate_cache():
    """Force cache refresh on next call."""
    global _last_refresh
    _last_refresh = 0
