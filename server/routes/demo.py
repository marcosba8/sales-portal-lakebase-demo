"""Demo orchestration routes.

These endpoints let a (non-technical) presenter drive the Lakebase demo from the
app's "Demo Control" tab instead of running the notebook. Each act maps to one
endpoint. The app's service principal executes the SQL directly against Lakebase.

Act 1: Setup & Seed Data
  Creates the `sales` schema + 3 tables and seeds realistic B2B data
  (30 accounts, ~100 opportunities, ~81 sales activities). Idempotent: if the
  data is already present it reports the existing row counts instead of
  re-seeding.

Act 2: Branching & Schema Evolution
  Create a zero-copy 'dev-health' branch, develop new features on it
  (health_score column, renewals & risk_alerts tables), then promote to
  production and delete the branch. Control-plane ops run as the app SP.

Act 3: Disaster & Point-in-Time Recovery
  Record a recovery point, DROP the opportunities table (disaster), create a
  PITR recovery branch from the recorded timestamp, then copy the rows back to
  production and delete the recovery branch.
"""
import logging
import os
import re
import time
from fastapi import APIRouter, HTTPException
from server.db import (
    get_conn, get_client, get_project, ensure_branch_endpoint, get_conn_for_branch,
    run_warehouse_sql,
)
from server.schema_detector import invalidate_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/demo", tags=["demo"])

SEED_TABLES = ("accounts", "opportunities", "sales_activities")

# Cache the computed Lakebase deep-link config (project/branch uids are stable).
_config_cache: dict | None = None


@router.get("/config")
def demo_config():
    """Compute Lakebase Catalog deep-links at runtime (no hardcoded uids/host).

    The app knows its Lakebase endpoint path (LAKEBASE_ENDPOINT env var), which
    contains the project & branch *names*. The Catalog UI URLs need the project
    and branch *uids*, which we look up via the SDK. Returns:
      - workspace_url:  the workspace host
      - lakebase_tables_url:  .../lakebase/projects/<uid>/branches/<uid>/tables
      - lakebase_project_url: .../lakebase/projects/<uid>
    Falls back to just the workspace URL if anything can't be resolved.
    """
    global _config_cache
    if _config_cache is not None:
        return _config_cache

    w, endpoint = get_client()
    workspace_url = str(w.config.host).rstrip("/")
    cfg = {"workspace_url": workspace_url,
           "lakebase_tables_url": workspace_url,
           "lakebase_project_url": workspace_url}
    try:
        # endpoint looks like: projects/<proj>/branches/<branch>/endpoints/<ep>
        m = re.match(r"projects/([^/]+)/branches/([^/]+)", endpoint or "")
        if m:
            proj_name, branch_name = m.group(1), m.group(2)
            proj = w.postgres.get_project(name=f"projects/{proj_name}")
            proj_uid = proj.uid
            branches = list(w.postgres.list_branches(parent=f"projects/{proj_name}"))
            branch = next((b for b in branches
                           if b.name.endswith(f"/branches/{branch_name}")), None)
            branch_uid = branch.uid if branch else None
            if proj_uid:
                base = f"{workspace_url}/lakebase/projects/{proj_uid}"
                cfg["lakebase_project_url"] = base
                if branch_uid:
                    cfg["lakebase_tables_url"] = f"{base}/branches/{branch_uid}/tables"
        _config_cache = cfg
    except Exception as e:
        logger.warning(f"Could not resolve Lakebase deep-links: {e}")
    return cfg

# ── Act 1 SQL (ported from sales_pipeline_lakebase_demo.py) ──────────────────

_CREATE_SCHEMA = "CREATE SCHEMA IF NOT EXISTS sales"

_CREATE_ACCOUNTS = """
CREATE TABLE IF NOT EXISTS sales.accounts (
    id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, industry VARCHAR(50) NOT NULL,
    region VARCHAR(50) NOT NULL, segment VARCHAR(30) NOT NULL,
    owner_rep VARCHAR(60) NOT NULL, tier VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Active',
    created_date DATE NOT NULL)
"""

_CREATE_OPPORTUNITIES = """
CREATE TABLE IF NOT EXISTS sales.opportunities (
    id SERIAL PRIMARY KEY, account_id INT NOT NULL REFERENCES sales.accounts(id),
    close_date DATE NOT NULL, opp_number INT NOT NULL,
    amount_usd NUMERIC(12,2) NOT NULL, stage VARCHAR(20) NOT NULL,
    probability INT NOT NULL, product_line VARCHAR(30) NOT NULL)
"""

_CREATE_ACTIVITIES = """
CREATE TABLE IF NOT EXISTS sales.sales_activities (
    id SERIAL PRIMARY KEY, account_id INT NOT NULL REFERENCES sales.accounts(id),
    activity_type VARCHAR(20) NOT NULL, outcome VARCHAR(15) NOT NULL,
    logged_at TIMESTAMP NOT NULL)
"""

_SEED_ACCOUNTS = """
INSERT INTO sales.accounts (name,industry,region,segment,owner_rep,tier,status,created_date) VALUES
('Northwind Systems','Technology','AMER East','Growth','Alex Rivera','Enterprise','Active','2023-02-14'),
('Orbit Labs','Manufacturing','AMER West','Commercial','Morgan Diaz','Mid-Market','Expansion','2022-06-01'),
('Quantum Dynamics','Retail','AMER East','Commercial','Casey Wong','Mid-Market','Active','2023-09-20'),
('Horizon Financial','Financial Services','EMEA','Growth','Taylor Brooks','Enterprise','At Risk','2021-11-03'),
('Zenith Health','Healthcare','AMER West','Growth','Jordan Kim','SMB','Active','2024-01-15'),
('Northwind Partners','Technology','EMEA','Growth','Taylor Brooks','SMB','Expansion','2023-05-10'),
('Pioneer Industries','Energy','LATAM','Enterprise','Sam Patel','Enterprise','At Risk','2020-08-22'),
('Cobalt Dynamics','Financial Services','LATAM','Commercial','Jordan Kim','Mid-Market','Active','2022-03-30'),
('Atlas Networks','Media','AMER West','Commercial','Casey Wong','Mid-Market','Expansion','2023-07-18'),
('Vertex Dynamics','Technology','EMEA','Growth','Alex Rivera','Enterprise','Active','2021-04-12'),
('Meridian Holdings','Healthcare','EMEA','Enterprise','Sam Patel','Enterprise','Active','2020-12-05'),
('Apex Labs','Energy','AMER West','Commercial','Taylor Brooks','Mid-Market','At Risk','2022-10-08'),
('Beacon Labs','Media','AMER East','Commercial','Sam Patel','Enterprise','Prospect','2024-03-01'),
('Zenith Dynamics','Energy','LATAM','Commercial','Sam Patel','SMB','At Risk','2023-01-25'),
('Horizon Systems','Retail','EMEA','Growth','Alex Rivera','Enterprise','Active','2022-08-14'),
('Catalyst Group','Public Sector','AMER East','Enterprise','Sam Patel','Mid-Market','Expansion','2021-06-30'),
('Orbit Partners','Technology','LATAM','Enterprise','Morgan Diaz','SMB','Active','2023-11-11'),
('Cobalt Group','Technology','AMER West','Commercial','Casey Wong','Enterprise','Prospect','2024-02-20'),
('Quantum Systems','Manufacturing','APJ','Growth','Sam Patel','Mid-Market','Active','2022-05-19'),
('Nimbus Financial','Financial Services','LATAM','Enterprise','Morgan Diaz','Enterprise','Prospect','2023-12-02'),
('Pioneer Networks','Financial Services','LATAM','Enterprise','Alex Rivera','Mid-Market','Active','2021-09-27'),
('Meridian Systems','Healthcare','EMEA','Commercial','Jordan Kim','Mid-Market','Active','2022-07-07'),
('Cobalt Industries','Media','LATAM','Growth','Casey Wong','Enterprise','Expansion','2023-03-16'),
('Catalyst Partners','Public Sector','EMEA','Enterprise','Sam Patel','Enterprise','Active','2020-10-19'),
('Quantum Financial','Financial Services','AMER West','Commercial','Morgan Diaz','Enterprise','Active','2021-02-08'),
('Zenith Holdings','Media','AMER West','Growth','Taylor Brooks','Enterprise','Expansion','2023-06-22'),
('Northwind Group','Retail','LATAM','Commercial','Sam Patel','Enterprise','Active','2022-11-30'),
('Horizon Holdings','Manufacturing','APJ','Enterprise','Jordan Kim','Enterprise','Active','2021-07-14'),
('Zenith Labs','Energy','APJ','Growth','Casey Wong','Mid-Market','Prospect','2024-04-05'),
('Vertex Holdings','Technology','EMEA','Commercial','Alex Rivera','Mid-Market','Active','2022-09-09')
"""

_SEED_OPPORTUNITIES = """
INSERT INTO sales.opportunities
    (account_id, close_date, opp_number, amount_usd, stage, probability, product_line)
SELECT a.id,
       a.created_date + (s.n * INTERVAL '45 days') + (RANDOM()*INTERVAL '20 days'),
       1000 + (a.id-1)*4 + s.n,
       ROUND((RANDOM()*480+20)::NUMERIC, 0) * 1000,
       (ARRAY['Prospecting','Qualification','Proposal','Negotiation','Closed Won','Closed Lost'])[r.si],
       (ARRAY[10,25,50,75,100,0])[r.si],
       (ARRAY['Platform','Data Warehouse','ML/AI','Governance','Streaming'])[FLOOR(RANDOM()*5+1)]
FROM sales.accounts a
CROSS JOIN generate_series(1,4) AS s(n)
CROSS JOIN LATERAL (SELECT FLOOR(RANDOM()*6+1)::INT AS si) r
WHERE a.id <= 25
"""

_SEED_ACTIVITIES = """
INSERT INTO sales.sales_activities (account_id, activity_type, outcome, logged_at)
SELECT a.id,
       (ARRAY['Call','Email','Meeting','Demo'])[FLOOR(RANDOM()*4+1)],
       (ARRAY['Positive','Neutral','Negative'])[FLOOR(RANDOM()*3+1)],
       a.created_date + (s.n * INTERVAL '20 days') + (RANDOM()*INTERVAL '5 days')
FROM sales.accounts a CROSS JOIN generate_series(1,3) AS s(n) WHERE a.id <= 27
"""


# Every table the demo can create, in dependency order (children first) so
# DROP works even with foreign keys. CASCADE covers the rest (e.g. Act 4's
# synced churn_predictions table).
_ALL_DEMO_TABLES = (
    "risk_alerts", "renewals", "churn_predictions", "load_test_log",
    "sales_activities", "opportunities", "accounts",
)


@router.post("/reset")
def reset_demo():
    """Drop the demo tables so it can be re-run from a clean slate.

    Drops the *tables* (which the app service principal owns) rather than the
    schema itself — the schema may be owned by whoever ran the deploy, and only
    its owner can drop it. An empty schema with no tables is a clean slate for
    the demo (feature detection keys off table existence).
    """
    log: list[str] = []
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            # Guard: nothing to do if the schema was never created.
            cur.execute("""
                SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='sales'
            """)
            if cur.fetchone()[0] == 0:
                log.append("Nothing to reset — schema 'sales' does not exist.")
                invalidate_cache()
                return {"ok": True, "log": log}
            for t in _ALL_DEMO_TABLES:
                cur.execute(f"DROP TABLE IF EXISTS sales.{t} CASCADE")

        # Clean up any leftover demo branches (dev-health, pitr-recovery) and
        # the in-memory recovery point, so a re-run starts truly fresh.
        global _recovery_point
        _recovery_point = None
        try:
            w, _ = get_client()
            for b in list(w.postgres.list_branches(parent=f"projects/{get_project()}")):
                bid = b.name.split("/branches/")[-1]
                if bid in ("dev-health", "pitr-recovery"):
                    try:
                        w.postgres.delete_branch(name=b.name).wait()
                        log.append(f"Deleted leftover branch '{bid}'.")
                    except Exception as be:
                        log.append(f"(branch '{bid}' delete deferred: {be})")
        except Exception as be:
            log.append(f"(branch cleanup skipped: {be})")

        # Act 4: delete the synced table (owned by the sync pipeline, so a plain
        # DROP won't remove it) and the gold Delta table.
        try:
            w, _ = get_client()
            try:
                w.postgres.delete_synced_table(name=f"synced_tables/{SYNCED_TABLE_ID}")
                log.append("Deleted synced table churn_predictions.")
            except Exception:
                pass
            try:
                run_warehouse_sql(f"DROP TABLE IF EXISTS {GOLD_TABLE}")
                log.append("Dropped gold Delta table.")
            except Exception:
                pass
        except Exception as be:
            log.append(f"(Act 4 cleanup skipped: {be})")

        invalidate_cache()
        log.append("Dropped all demo tables. Demo reset to a clean slate.")
        return {"ok": True, "log": log}
    except Exception as e:
        logger.exception("Demo reset failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


@router.post("/act1/create-tables")
def act1_create_tables():
    """Step 1a: create the sales schema + 3 empty tables (idempotent).

    Leaves the tables empty so the presenter can show them in the Lakebase UI
    before seeding. The app's Accounts/Opportunities tabs light up (schema
    detector keys off table existence, not row count) but render empty.
    """
    log: list[str] = []
    try:
        with get_conn() as conn:
            cur = conn.cursor()

            log.append("Creating schema & tables…")
            cur.execute(_CREATE_SCHEMA)
            cur.execute(_CREATE_ACCOUNTS)
            cur.execute(_CREATE_OPPORTUNITIES)
            cur.execute(_CREATE_ACTIVITIES)
            log.append(f"Tables ready: {', '.join(SEED_TABLES)}")

            counts = {}
            for t in SEED_TABLES:
                cur.execute(f"SELECT COUNT(*) FROM sales.{t}")
                counts[t] = cur.fetchone()[0]
                log.append(f"  {t}: {counts[t]} rows")

        invalidate_cache()
        log.append("Tables are live in Lakebase — check the Catalog UI.")

        return {"ok": True, "log": log, "counts": counts}
    except Exception as e:
        logger.exception("Act 1 create-tables failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


@router.post("/act1/seed")
def act1_seed():
    """Step 1b: seed sample data into the tables (idempotent).

    Requires the tables to exist (run create-tables first). Only inserts when
    empty, so re-running is safe. Returns the final row counts per table.
    """
    log: list[str] = []
    try:
        with get_conn() as conn:
            cur = conn.cursor()

            # Guard: tables must exist first.
            cur.execute("""
                SELECT COUNT(*) FROM information_schema.tables
                WHERE table_schema='sales' AND table_name='accounts'
            """)
            if cur.fetchone()[0] == 0:
                raise HTTPException(400, "Tables not created yet — run 'Create tables' first.")

            # Only seed if empty, so re-running the demo is safe.
            cur.execute("SELECT COUNT(*) FROM sales.accounts")
            existing = cur.fetchone()[0]
            if existing > 0:
                log.append(f"Already seeded ({existing} accounts) — skipping insert.")
            else:
                log.append("Seeding realistic B2B data…")
                cur.execute(_SEED_ACCOUNTS)
                cur.execute(_SEED_OPPORTUNITIES)
                cur.execute(_SEED_ACTIVITIES)

            counts = {}
            for t in SEED_TABLES:
                cur.execute(f"SELECT COUNT(*) FROM sales.{t}")
                counts[t] = cur.fetchone()[0]
                log.append(f"  {t}: {counts[t]} rows")

        invalidate_cache()
        log.append("App cache refreshed. Accounts & Opportunities show live data.")

        return {"ok": True, "log": log, "counts": counts}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Act 1 seed failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


# ══════════════════════════════════════════════════════════════════════════
# Act 2: Branching & Schema Evolution
#
# Develop new features on a zero-copy branch, then promote to production.
# Three steps mirror the notebook:
#   2a create-branch  -> create 'dev-health' branch + its endpoint
#   2b develop        -> add health_score col, renewals & risk_alerts tables
#                        (ON THE BRANCH ONLY — production is untouched)
#   2c promote        -> replay the same DDL on production, delete the branch
#
# Control-plane ops (branch create/delete, endpoint provisioning) run as the
# app service principal via the SDK. Endpoint provisioning can take 30-90s, so
# create-branch is resumable: if the endpoint isn't ready yet it returns a
# "still provisioning" result and the presenter can click again.
# ══════════════════════════════════════════════════════════════════════════

DEV_BRANCH = "dev-health"

_ADD_HEALTH_SCORE = "ALTER TABLE sales.accounts ADD COLUMN IF NOT EXISTS health_score INT"
_FILL_HEALTH_SCORE = "UPDATE sales.accounts SET health_score=(RANDOM()*100)::INT WHERE health_score IS NULL"

_CREATE_RENEWALS = """
CREATE TABLE IF NOT EXISTS sales.renewals (
    id SERIAL PRIMARY KEY, account_id INT NOT NULL REFERENCES sales.accounts(id),
    renewal_type VARCHAR(30) NOT NULL, contract_value_usd NUMERIC(12,2) NOT NULL,
    renewal_date DATE NOT NULL, likelihood INT NOT NULL)
"""
_SEED_RENEWALS = """
INSERT INTO sales.renewals (account_id,renewal_type,contract_value_usd,renewal_date,likelihood)
SELECT id,'Annual Subscription',ROUND((RANDOM()*400+50)::NUMERIC,0)*1000,
       created_date + INTERVAL '1 year',(RANDOM()*40+60)::INT FROM sales.accounts
"""

_CREATE_RISK_ALERTS = """
CREATE TABLE IF NOT EXISTS sales.risk_alerts (
    id SERIAL PRIMARY KEY, account_id INT NOT NULL REFERENCES sales.accounts(id),
    alert_type VARCHAR(30) NOT NULL, severity VARCHAR(10) NOT NULL DEFAULT 'medium',
    message TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())
"""
_SEED_RISK_ALERTS = """
INSERT INTO sales.risk_alerts (account_id,alert_type,severity,message) VALUES
(4,'Usage Decline','high','Product usage dropped sharply over the last 30 days -- recommend an executive check-in before renewal'),
(7,'Exec Sponsor Change','high','Economic buyer left the account -- identify and engage a new champion'),
(12,'Support Escalation','medium','Multiple priority-one tickets opened this month -- loop in customer success'),
(14,'Adoption Risk','medium','Only a quarter of licensed seats are active -- schedule an enablement workshop'),
(20,'Competitive Threat','low','Account mentioned evaluating a competitor during the last business review')
"""


def _branch_exists(w, branch_id):
    branches = list(w.postgres.list_branches(parent=f"projects/{get_project()}"))
    return any(b.name.endswith(f"/branches/{branch_id}") for b in branches)


def _prod_branch_name(w):
    branches = list(w.postgres.list_branches(parent=f"projects/{get_project()}"))
    prod = next((b for b in branches if b.status and b.status.default), branches[0])
    return prod.name


@router.post("/act2/create-branch")
def act2_create_branch():
    """Step 2a: create the 'dev-health' branch (zero-copy) + its endpoint.

    Resumable: if the branch already exists we just wait for its endpoint; if
    the endpoint is still provisioning we return ok=false so the presenter can
    click again in a few seconds.
    """
    log: list[str] = []
    try:
        w, _ = get_client()
        project = get_project()

        # Guard: production must be seeded first.
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""SELECT COUNT(*) FROM information_schema.tables
                           WHERE table_schema='sales' AND table_name='accounts'""")
            if cur.fetchone()[0] == 0:
                raise HTTPException(400, "Seed production first (Act 1) before branching.")

        if _branch_exists(w, DEV_BRANCH):
            log.append(f"Branch '{DEV_BRANCH}' already exists — checking its endpoint…")
        else:
            from databricks.sdk.service.postgres import Branch, BranchSpec, Duration
            t0 = time.time()
            log.append(f"Creating '{DEV_BRANCH}' branch (zero-copy clone)…")
            w.postgres.create_branch(
                parent=f"projects/{project}",
                branch=Branch(spec=BranchSpec(
                    source_branch=_prod_branch_name(w),
                    ttl=Duration(seconds=7200),
                )),
                branch_id=DEV_BRANCH,
            ).wait()
            log.append(f"Branch created in {time.time()-t0:.1f}s.")

        # Provision / wait for the branch endpoint (resumable).
        _, host = ensure_branch_endpoint(DEV_BRANCH, wait_seconds=45)
        if not host:
            log.append("Endpoint still provisioning (can take up to ~90s).")
            log.append("Click again in a few seconds to continue.")
            return {"ok": False, "provisioning": True, "log": log}

        # Confirm the branch is a real clone: same tables as production.
        with get_conn_for_branch(DEV_BRANCH) as bconn:
            bcur = bconn.cursor()
            bcur.execute("""SELECT COUNT(*) FROM information_schema.tables
                            WHERE table_schema='sales'""")
            tbls = bcur.fetchone()[0]
        log.append(f"Branch endpoint ready · {tbls} tables (same as production).")
        return {"ok": True, "log": log}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Act 2 create-branch failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


@router.post("/act2/develop")
def act2_develop():
    """Step 2b: build new features ON THE BRANCH ONLY (production untouched).

    Adds health_score column + renewals & risk_alerts tables to dev-health.
    """
    log: list[str] = []
    try:
        w, _ = get_client()
        if not _branch_exists(w, DEV_BRANCH):
            raise HTTPException(400, "Create the dev-health branch first.")

        with get_conn_for_branch(DEV_BRANCH) as bconn:
            cur = bconn.cursor()
            cur.execute(_ADD_HEALTH_SCORE); cur.execute(_FILL_HEALTH_SCORE)
            log.append("+ health_score column on accounts")
            cur.execute(_CREATE_RENEWALS)
            cur.execute("SELECT COUNT(*) FROM sales.renewals")
            if cur.fetchone()[0] == 0:
                cur.execute(_SEED_RENEWALS)
            cur.execute("SELECT COUNT(*) FROM sales.renewals")
            log.append(f"+ renewals table ({cur.fetchone()[0]} rows)")
            cur.execute(_CREATE_RISK_ALERTS)
            cur.execute("SELECT COUNT(*) FROM sales.risk_alerts")
            if cur.fetchone()[0] == 0:
                cur.execute(_SEED_RISK_ALERTS)
            cur.execute("SELECT COUNT(*) FROM sales.risk_alerts")
            log.append(f"+ risk_alerts table ({cur.fetchone()[0]} rows)")
            cur.execute("""SELECT COUNT(*) FROM information_schema.tables
                           WHERE table_schema='sales'""")
            branch_tbls = cur.fetchone()[0]

        # Show the isolation: production still has only its original tables.
        with get_conn() as pconn:
            pcur = pconn.cursor()
            pcur.execute("""SELECT COUNT(*) FROM information_schema.tables
                            WHERE table_schema='sales'""")
            prod_tbls = pcur.fetchone()[0]
        log.append("=== Branch vs Production (isolated) ===")
        log.append(f"  branch:     {branch_tbls} tables + health_score")
        log.append(f"  production: {prod_tbls} tables (unchanged)")
        return {"ok": True, "log": log}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Act 2 develop failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


@router.post("/act2/promote")
def act2_promote():
    """Step 2c: replay the branch's changes on production, then delete the branch.

    We replay the DDL (rather than a branch "merge") to keep it simple and
    idempotent. After promotion the dev-health branch is deleted.
    """
    log: list[str] = []
    try:
        w, _ = get_client()

        log.append("Replaying schema changes on production…")
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(_ADD_HEALTH_SCORE); cur.execute(_FILL_HEALTH_SCORE)
            cur.execute(_CREATE_RENEWALS)
            cur.execute("SELECT COUNT(*) FROM sales.renewals")
            if cur.fetchone()[0] == 0:
                cur.execute(_SEED_RENEWALS)
            cur.execute(_CREATE_RISK_ALERTS)
            cur.execute("SELECT COUNT(*) FROM sales.risk_alerts")
            if cur.fetchone()[0] == 0:
                cur.execute(_SEED_RISK_ALERTS)
            cur.execute("""SELECT COUNT(*) FROM information_schema.tables
                           WHERE table_schema='sales'""")
            prod_tbls = cur.fetchone()[0]
        log.append(f"Promoted to production! ({prod_tbls} tables)")

        # Delete the branch (best-effort, with retry for reconciling endpoints).
        if _branch_exists(w, DEV_BRANCH):
            branch_full = f"projects/{get_project()}/branches/{DEV_BRANCH}"
            for attempt in range(4):
                try:
                    w.postgres.delete_branch(name=branch_full).wait()
                    log.append(f"Branch '{DEV_BRANCH}' deleted.")
                    break
                except Exception as e:
                    if "reconcil" in str(e).lower() and attempt < 3:
                        time.sleep(10)
                    else:
                        log.append(f"(branch delete deferred: {e})")
                        break

        invalidate_cache()
        log.append("App cache refreshed — Health, Renewals & Risk Alerts are live.")
        return {"ok": True, "log": log}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Act 2 promote failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


# ══════════════════════════════════════════════════════════════════════════
# Act 3: Disaster & Point-in-Time Recovery
#
# Four steps mirror the notebook and let the presenter tell the story:
#   3a record   -> note the pre-disaster timestamp + opportunity count
#   3b drop     -> DROP TABLE opportunities CASCADE (the disaster)
#   3c pitr     -> create a recovery branch from that timestamp; show the data
#                  is intact there (the "phew" beat) — resumable for provisioning
#   3d restore  -> copy the rows back to production, delete the recovery branch
#
# The pre-disaster recovery point is held in module state between 3a and 3d.
# ══════════════════════════════════════════════════════════════════════════

PITR_BRANCH = "pitr-recovery"

# Recovery point recorded in 3a: {"epoch": int, "iso": str, "count": int}.
_recovery_point: dict | None = None

_CREATE_OPPORTUNITIES_RESTORE = _CREATE_OPPORTUNITIES  # same DDL, reused on restore


@router.post("/act3/record")
def act3_record():
    """Step 3a: record the pre-disaster recovery point (timestamp + row count)."""
    global _recovery_point
    log: list[str] = []
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""SELECT COUNT(*) FROM information_schema.tables
                           WHERE table_schema='sales' AND table_name='opportunities'""")
            if cur.fetchone()[0] == 0:
                raise HTTPException(400, "No opportunities table — seed Act 1 first.")
            cur.execute("SELECT NOW()")
            now = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM sales.opportunities")
            count = cur.fetchone()[0]
        _recovery_point = {"epoch": int(now.timestamp()), "iso": str(now), "count": count}
        log.append(f"Recovery point recorded: {now}")
        log.append(f"Opportunities right now: {count} deals — this is what we must not lose.")
        log.append("In a real incident you'd pull this timestamp from your monitoring.")
        return {"ok": True, "log": log, "count": count}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Act 3 record failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


@router.post("/act3/drop")
def act3_drop():
    """Step 3b: the disaster — DROP TABLE opportunities CASCADE."""
    log: list[str] = []
    try:
        # If the presenter skipped 3a, record a recovery point now so restore works.
        global _recovery_point
        if _recovery_point is None:
            with get_conn() as conn:
                cur = conn.cursor()
                cur.execute("SELECT NOW()")
                now = cur.fetchone()[0]
                try:
                    cur.execute("SELECT COUNT(*) FROM sales.opportunities")
                    count = cur.fetchone()[0]
                except Exception:
                    count = 0
            _recovery_point = {"epoch": int(now.timestamp()), "iso": str(now), "count": count}
            log.append("(auto-recorded a recovery point)")

        with get_conn() as conn:
            conn.cursor().execute("DROP TABLE IF EXISTS sales.opportunities CASCADE")
        invalidate_cache()
        log.append("DISASTER: DROP TABLE sales.opportunities CASCADE")
        log.append("The entire pipeline is gone.")
        log.append('App Opportunities tab → "Pipeline Temporarily Unavailable".')
        return {"ok": True, "log": log}
    except Exception as e:
        logger.exception("Act 3 drop failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


@router.post("/act3/pitr")
def act3_pitr():
    """Step 3c: create a Point-in-Time recovery branch and confirm data is safe.

    Resumable: creating the PITR branch's endpoint can take 30-90s. If it's not
    ready yet we return ok:false so the presenter can click again.
    """
    log: list[str] = []
    try:
        if _recovery_point is None:
            raise HTTPException(400, "No recovery point — run 'Record recovery point' first.")
        w, _ = get_client()
        project = get_project()

        if _branch_exists(w, PITR_BRANCH):
            log.append(f"Recovery branch '{PITR_BRANCH}' already exists — checking endpoint…")
        else:
            from databricks.sdk.service.postgres import Branch, BranchSpec, Timestamp, Duration
            # Point-in-time recovery resolves against durable WAL history. If the
            # recovery point was recorded only a moment ago (fast clicking), that
            # timestamp may not be durable yet and the branch would resolve to an
            # empty baseline. Ensure the target time is safely in the past
            # (>= ~20s old); if not, wait the small remainder. The recorded moment
            # is still well before the disaster, so this stays "pre-drop".
            MIN_AGE = 20
            target = _recovery_point["epoch"]
            age = int(time.time()) - target
            if age < MIN_AGE:
                wait = MIN_AGE - age
                log.append(f"Letting the recovery point settle into history ({wait}s)…")
                time.sleep(wait)
            log.append(f"Rewinding to {_recovery_point['iso']} on an isolated branch…")
            w.postgres.create_branch(
                parent=f"projects/{project}",
                branch=Branch(spec=BranchSpec(
                    source_branch=_prod_branch_name(w),
                    source_branch_time=Timestamp(seconds=target),
                    ttl=Duration(seconds=86400),
                )),
                branch_id=PITR_BRANCH,
            ).wait()
            log.append("Recovery branch created from the pre-disaster moment.")

        _, host = ensure_branch_endpoint(PITR_BRANCH, wait_seconds=45)
        if not host:
            log.append("Recovery branch endpoint still provisioning (can take ~90s).")
            log.append("Click again in a few seconds to continue.")
            return {"ok": False, "provisioning": True, "log": log}

        with get_conn_for_branch(PITR_BRANCH) as bconn:
            bcur = bconn.cursor()
            bcur.execute("SELECT COUNT(*) FROM sales.opportunities")
            safe = bcur.fetchone()[0]
        log.append(f"Opportunities on the recovery branch: {safe} — the data is safe!")
        return {"ok": True, "log": log, "count": safe}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Act 3 pitr failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


@router.post("/act3/restore")
def act3_restore():
    """Step 3d: copy the recovered rows back to production, delete the branch."""
    global _recovery_point
    log: list[str] = []
    try:
        w, _ = get_client()
        if not _branch_exists(w, PITR_BRANCH):
            raise HTTPException(400, "No recovery branch — run 'Create recovery branch' first.")

        # Recreate the table on production and copy rows from the recovery branch.
        log.append("Copying recovered rows back to production…")
        with get_conn_for_branch(PITR_BRANCH) as bconn:
            bcur = bconn.cursor()
            bcur.execute("""SELECT account_id,close_date,opp_number,amount_usd,stage,
                                   probability,product_line FROM sales.opportunities""")
            rows = bcur.fetchall()

        with get_conn() as pconn:
            pcur = pconn.cursor()
            pcur.execute(_CREATE_OPPORTUNITIES_RESTORE)
            pcur.execute("TRUNCATE sales.opportunities RESTART IDENTITY CASCADE")
            for r in rows:
                pcur.execute("""INSERT INTO sales.opportunities
                    (account_id,close_date,opp_number,amount_usd,stage,probability,product_line)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)""", r)
            pcur.execute("SELECT COUNT(*) FROM sales.opportunities")
            restored = pcur.fetchone()[0]
        log.append(f"Restored {restored} opportunities to production!")

        # Delete the recovery branch (best-effort, retry for reconciling endpoints).
        branch_full = f"projects/{get_project()}/branches/{PITR_BRANCH}"
        for attempt in range(4):
            try:
                w.postgres.delete_branch(name=branch_full).wait()
                log.append(f"Recovery branch '{PITR_BRANCH}' deleted.")
                break
            except Exception as e:
                if "reconcil" in str(e).lower() and attempt < 3:
                    time.sleep(10)
                else:
                    log.append(f"(recovery branch delete deferred: {e})")
                    break

        _recovery_point = None
        invalidate_cache()
        log.append("Full recovery, zero data loss. Opportunities page is back.")
        return {"ok": True, "log": log, "count": restored}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Act 3 restore failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


# ══════════════════════════════════════════════════════════════════════════
# Act 4: Synced Tables — Lakehouse to App
#
# The ML team's churn model output is a gold Delta table in the lakehouse. We
# sync it into Lakebase as sales.churn_predictions; the Retention Risk page
# lights up. Re-scoring the model (UPDATE the gold table) flows through the
# sync — zero redeploys.
#
# Steps:
#   4a publish  -> build & seed the gold Delta table via the SQL warehouse
#   4b sync     -> SDK create_synced_database_table -> sales.churn_predictions;
#                  poll until rows land (resumable) -> churn_active lights up
#   4c rescore  -> UPDATE the gold table (High -> Low/Med) via warehouse, then
#                  trigger a sync refresh
#
# The SQL warehouse is bound to the app as a resource (CAN_USE); its id is in
# the WAREHOUSE_ID env var. Gold table lives in for_startups_demos_catalog.
# ══════════════════════════════════════════════════════════════════════════

# Act 4 lakehouse location. Per-workspace: set GOLD_CATALOG / GOLD_SCHEMA env
# vars (injected by the deploy script from deploy.env). Defaults match the
# original fevm-startups demo so nothing breaks if the env vars are absent.
GOLD_CATALOG = os.environ.get("GOLD_CATALOG", "for_startups_demos_catalog")
GOLD_SCHEMA = os.environ.get("GOLD_SCHEMA", "sales_ml")
GOLD_TABLE = f"{GOLD_CATALOG}.{GOLD_SCHEMA}.account_churn_predictions"
SYNCED_TABLE = "sales.churn_predictions"    # target table in Lakebase (schema.table)
# The UC 3-part name for the synced table. The catalog is an existing UC catalog;
# schema.table determine where the Postgres table lands in Lakebase (sales.churn_predictions).
SYNCED_UC_SCHEMA = "sales"
SYNCED_TABLE_ID = f"{GOLD_CATALOG}.{SYNCED_UC_SCHEMA}.churn_predictions"

_GOLD_SEED = f"""
INSERT INTO {GOLD_TABLE} VALUES
 (1 ,'Northwind Systems'  ,'Growth'    ,0.950,'High'  ,192000,'Competitor evaluation'   ,'Escalate to renewals team'          ,'v2.3',current_timestamp()),
 (2 ,'Orbit Labs'         ,'Commercial',0.930,'High'  ,221000,'Exec sponsor departed'   ,'Assign customer success manager'    ,'v2.3',current_timestamp()),
 (3 ,'Quantum Dynamics'   ,'Commercial',0.920,'High'  ,141000,'Billing disputes'        ,'Proactive discount / incentive'     ,'v2.3',current_timestamp()),
 (4 ,'Horizon Financial'  ,'Growth'    ,0.910,'High'  ,323000,'Champion left account'   ,'Re-engage economic buyer'           ,'v2.3',current_timestamp()),
 (5 ,'Zenith Health'      ,'Growth'    ,0.890,'High'  ,253000,'Billing disputes'        ,'Assign customer success manager'    ,'v2.3',current_timestamp()),
 (6 ,'Northwind Partners' ,'Growth'    ,0.880,'High'  ,218000,'Competitor evaluation'   ,'Offer adoption workshop'            ,'v2.3',current_timestamp()),
 (7 ,'Pioneer Industries' ,'Enterprise',0.840,'High'  ,301000,'Usage decline'           ,'Schedule executive business review' ,'v2.3',current_timestamp()),
 (8 ,'Cobalt Dynamics'    ,'Commercial',0.810,'High'  ,164000,'Support escalations'     ,'Escalate to renewals team'          ,'v2.3',current_timestamp()),
 (9 ,'Atlas Networks'     ,'Commercial',0.780,'High'  ,132000,'Low feature adoption'    ,'Offer adoption workshop'            ,'v2.3',current_timestamp()),
 (10,'Vertex Dynamics'    ,'Growth'    ,0.720,'High'  ,187000,'Contract renewal overdue','Escalate to renewals team'          ,'v2.3',current_timestamp()),
 (11,'Meridian Holdings'  ,'Enterprise',0.680,'High'  ,276000,'Champion left account'   ,'Re-engage economic buyer'           ,'v2.3',current_timestamp()),
 (12,'Apex Labs'          ,'Commercial',0.660,'High'  ,118000,'Usage decline'           ,'Assign customer success manager'    ,'v2.3',current_timestamp()),
 (13,'Beacon Labs'        ,'Commercial',0.610,'Medium', 92000,'Support escalations'     ,'Proactive discount / incentive'     ,'v2.3',current_timestamp()),
 (14,'Zenith Dynamics'    ,'Commercial',0.560,'Medium', 78000,'Low feature adoption'    ,'Offer adoption workshop'            ,'v2.3',current_timestamp()),
 (15,'Horizon Systems'    ,'Growth'    ,0.520,'Medium', 84000,'Usage decline'           ,'Schedule executive business review' ,'v2.3',current_timestamp()),
 (16,'Catalyst Group'     ,'Enterprise',0.480,'Medium',110000,'Billing disputes'        ,'Re-engage economic buyer'           ,'v2.3',current_timestamp()),
 (17,'Orbit Partners'     ,'Enterprise',0.440,'Medium', 96000,'Competitor evaluation'   ,'Assign customer success manager'    ,'v2.3',current_timestamp()),
 (18,'Cobalt Group'       ,'Commercial',0.400,'Medium', 71000,'Contract renewal overdue','Escalate to renewals team'          ,'v2.3',current_timestamp()),
 (19,'Quantum Systems'    ,'Growth'    ,0.360,'Medium', 63000,'Low feature adoption'    ,'Offer adoption workshop'            ,'v2.3',current_timestamp()),
 (20,'Nimbus Financial'   ,'Enterprise',0.330,'Medium', 88000,'Usage decline'           ,'Schedule executive business review' ,'v2.3',current_timestamp()),
 (21,'Pioneer Networks'   ,'Enterprise',0.300,'Low'   , 22000,'Healthy usage'           ,'Maintain cadence'                   ,'v2.3',current_timestamp()),
 (22,'Meridian Systems'   ,'Commercial',0.270,'Low'   , 18000,'Healthy usage'           ,'Explore expansion'                  ,'v2.3',current_timestamp()),
 (23,'Cobalt Industries'  ,'Growth'    ,0.240,'Low'   , 15000,'Strong adoption'         ,'Explore expansion'                  ,'v2.3',current_timestamp()),
 (24,'Catalyst Partners'  ,'Enterprise',0.210,'Low'   , 24000,'Executive sponsor engaged','Explore expansion'                 ,'v2.3',current_timestamp()),
 (25,'Quantum Financial'  ,'Commercial',0.180,'Low'   , 12000,'Strong adoption'         ,'Maintain cadence'                   ,'v2.3',current_timestamp()),
 (26,'Zenith Holdings'    ,'Growth'    ,0.150,'Low'   ,  9000,'Healthy usage'           ,'Explore expansion'                  ,'v2.3',current_timestamp()),
 (27,'Northwind Group'    ,'Commercial',0.130,'Low'   ,  8000,'Strong adoption'         ,'Maintain cadence'                   ,'v2.3',current_timestamp()),
 (28,'Horizon Holdings'   ,'Enterprise',0.110,'Low'   , 16000,'Executive sponsor engaged','Explore expansion'                 ,'v2.3',current_timestamp()),
 (29,'Zenith Labs'        ,'Growth'    ,0.090,'Low'   ,  6000,'Strong adoption'         ,'Maintain cadence'                   ,'v2.3',current_timestamp()),
 (30,'Vertex Holdings'    ,'Commercial',0.060,'Low'   ,  5000,'Healthy usage'           ,'Explore expansion'                  ,'v2.3',current_timestamp())
"""


@router.post("/act4/publish")
def act4_publish():
    """Step 4a: build & seed the ML churn gold Delta table via the SQL warehouse."""
    log: list[str] = []
    try:
        log.append("Building the ML team's gold table via the SQL warehouse…")
        run_warehouse_sql(f"CREATE SCHEMA IF NOT EXISTS {GOLD_CATALOG}.{GOLD_SCHEMA}")
        run_warehouse_sql(f"""
            CREATE TABLE IF NOT EXISTS {GOLD_TABLE} (
                account_id                INT       NOT NULL,
                account_name              STRING    NOT NULL,
                segment                   STRING,
                churn_risk_score          DECIMAL(4,3),
                risk_band                 STRING,
                predicted_arr_at_risk_usd DECIMAL(12,2),
                top_churn_driver          STRING,
                recommended_action        STRING,
                model_version             STRING,
                scored_at                 TIMESTAMP
            ) USING DELTA
            TBLPROPERTIES (delta.enableChangeDataFeed = true)
        """)
        # Always reset to exactly the 30 seeded rows. TRUNCATE keeps the table
        # (so an existing sync/CDF source stays intact) but clears any prior
        # data, so re-running publish can never produce duplicate account_ids.
        run_warehouse_sql(f"TRUNCATE TABLE {GOLD_TABLE}")
        run_warehouse_sql(_GOLD_SEED)
        log.append("Scored 30 accounts: 12 High, 8 Medium, 10 Low.")
        log.append(f"Published: {GOLD_TABLE}")
        return {"ok": True, "log": log}
    except Exception as e:
        logger.exception("Act 4 publish failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


def _churn_rows_in_lakebase():
    """Return the row count of sales.churn_predictions in Lakebase, or None if
    the table doesn't exist yet."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""SELECT COUNT(*) FROM information_schema.tables
                       WHERE table_schema='sales' AND table_name='churn_predictions'""")
        if cur.fetchone()[0] == 0:
            return None
        cur.execute(f"SELECT COUNT(*) FROM {SYNCED_TABLE}")
        return cur.fetchone()[0]


def _synced_pipeline_id(w):
    """Return the DLT pipeline id backing the synced table, or None."""
    try:
        st = w.postgres.get_synced_table(name=f"synced_tables/{SYNCED_TABLE_ID}")
        return getattr(st.status, "pipeline_id", None) if st.status else None
    except Exception:
        return None


def _grant_pipeline_to_presenters(w):
    """Grant CAN_MANAGE on the sync pipeline to the 'account users' group so a
    presenter can view it in the UI and trigger a manual refresh. The pipeline
    is owned by the app SP (it created it), so the SP can grant this."""
    pid = _synced_pipeline_id(w)
    if not pid:
        return None
    # 'users' is the workspace-level all-users group (the pipeline permissions
    # API uses workspace groups, not the UC 'account users' name).
    try:
        w.api_client.do("PATCH", f"/api/2.0/permissions/pipelines/{pid}", body={
            "access_control_list": [
                {"group_name": "users", "permission_level": "CAN_MANAGE"}
            ]
        })
        return pid
    except Exception as e:
        logger.warning(f"Could not grant pipeline access: {e}")
        return None


@router.post("/act4/sync")
def act4_sync():
    """Step 4b: create the Lakebase synced table from the gold Delta table.

    Uses the autoscaling `postgres.create_synced_table` API (not the older
    database-instance API). The synced table's UC name is
    for_startups_demos_catalog.sales.churn_predictions, which lands as the
    Postgres table sales.churn_predictions in the project's production branch.

    Resumable: sync provisioning + first refresh can take 30-90s. Returns
    ok:false while it's still coming up so the presenter can click again.
    """
    log: list[str] = []
    try:
        w, _ = get_client()
        project = get_project()

        # Already synced? (resumed click / re-run)
        try:
            n = _churn_rows_in_lakebase()
            if n and n > 0:
                invalidate_cache()
                log.append(f"Synced table is live: {n} rows. Retention Risk is on.")
                # Ensure presenters can view/trigger the pipeline (idempotent).
                if _grant_pipeline_to_presenters(w):
                    log.append("Pipeline shared — open it in the UI and 'Sync now' if you like.")
                return {"ok": True, "log": log}
        except Exception:
            pass

        # Create the synced table if it doesn't exist yet.
        try:
            w.postgres.get_synced_table(name=f"synced_tables/{SYNCED_TABLE_ID}")
            log.append("Sync pipeline already exists — waiting for the first refresh…")
        except Exception:
            import databricks.sdk.service.postgres as _pg
            # The UC schema for the synced table's registration must exist.
            try:
                w.schemas.create(name=SYNCED_UC_SCHEMA, catalog_name=GOLD_CATALOG)
            except Exception:
                pass  # already exists
            log.append("Creating the Lakebase synced table from the gold table…")
            w.postgres.create_synced_table(
                synced_table=_pg.SyncedTable(spec=_pg.SyncedTableSyncedTableSpec(
                    source_table_full_name=GOLD_TABLE,
                    primary_key_columns=["account_id"],
                    scheduling_policy=_pg.SyncedTableSyncedTableSpecSyncedTableSchedulingPolicy.TRIGGERED,
                    create_database_objects_if_missing=True,
                    branch=f"projects/{project}/branches/production",
                    postgres_database="databricks_postgres",
                    new_pipeline_spec=_pg.NewPipelineSpec(
                        storage_catalog=GOLD_CATALOG, storage_schema=GOLD_SCHEMA,
                    ),
                )),
                synced_table_id=SYNCED_TABLE_ID,
            )
            log.append("Sync requested. The first sync runs automatically (30-90s).")

        # Poll briefly for rows to appear in Lakebase.
        for _ in range(4):
            try:
                n = _churn_rows_in_lakebase()
                if n and n > 0:
                    with get_conn() as conn:
                        conn.cursor().execute(
                            f'GRANT SELECT ON {SYNCED_TABLE} TO "{_sp_client_id(w)}"')
                    invalidate_cache()
                    log.append(f"churn_predictions synced: {n} rows. Retention Risk is live.")
                    # Let presenters view/trigger the pipeline in the Databricks UI.
                    if _grant_pipeline_to_presenters(w):
                        log.append("Pipeline shared — you can open it in the UI and 'Sync now'.")
                    return {"ok": True, "log": log}
            except Exception:
                pass
            time.sleep(10)

        log.append("Sync still provisioning — click again in a few seconds.")
        return {"ok": False, "provisioning": True, "log": log}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Act 4 sync failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


@router.post("/act4/rescore")
def act4_rescore():
    """Step 4c: re-score the model (UPDATE gold table), then trigger a sync refresh."""
    log: list[str] = []
    try:
        w, _ = get_client()
        log.append("Retention plays worked — re-scoring accounts in the lakehouse…")
        run_warehouse_sql(f"""
            UPDATE {GOLD_TABLE}
            SET risk_band                 = CASE WHEN account_id % 2 = 0 THEN 'Low' ELSE 'Medium' END,
                churn_risk_score          = CASE WHEN account_id % 2 = 0 THEN 0.180 ELSE 0.420 END,
                predicted_arr_at_risk_usd = ROUND(predicted_arr_at_risk_usd * 0.20, 2),
                top_churn_driver          = 'Recovered after retention play',
                recommended_action        = CASE WHEN account_id % 2 = 0 THEN 'Explore expansion' ELSE 'Maintain success plan' END,
                model_version             = 'v2.4',
                scored_at                 = current_timestamp()
            WHERE risk_band = 'High'
        """)
        log.append("Every High-risk account moved to Low/Medium (model v2.4).")

        # Trigger a sync refresh (Triggered mode) so the new scores flow into
        # Lakebase. The synced table is backed by a DLT pipeline; refresh it.
        try:
            st = w.postgres.get_synced_table(name=f"synced_tables/{SYNCED_TABLE_ID}")
            pipeline_id = getattr(st.status, "pipeline_id", None) if st.status else None
            if pipeline_id:
                w.pipelines.start_update(pipeline_id=pipeline_id)
                log.append("Triggered a sync refresh — new scores flowing into Lakebase.")
            else:
                log.append("Re-scored. Trigger 'Sync now' in the UI if the app doesn't update shortly.")
        except Exception as e:
            log.append(f"(sync refresh trigger deferred: {e})")

        invalidate_cache()
        log.append("Retention Risk will show the High band empty, ARR at risk collapsed.")
        return {"ok": True, "log": log}
    except Exception as e:
        logger.exception("Act 4 rescore failed")
        log.append(f"ERROR: {e}")
        raise HTTPException(500, {"log": log, "error": str(e)})


def _sp_client_id(w):
    """The app's own service principal client id (for GRANTs)."""
    return w.current_user.me().user_name


# ══════════════════════════════════════════════════════════════════════════
# Act 5: End-of-Quarter Load Test & Autoscaling
#
# Simulate the whole sales org hammering the database at end-of-quarter. The
# app opens a large pool of real connections that fire heavy, CPU-bound queries
# against Lakebase — which makes the compute genuinely autoscale (light queries
# do NOT scale it; sustained CPU load does).
#
# The test runs in a background thread; the frontend polls /act5/progress ~1s
# for live metrics (active connections, queries/sec, total, errors, elapsed,
# provisioned vCPU). /act5/start kicks it off, /act5/stop ends it early.
# ══════════════════════════════════════════════════════════════════════════

import threading as _threading

# Heavy, CPU-bound query — this is what actually drives autoscaling.
#
# Autoscaling responds to SUSTAINED CPU, not query count. A fast query leaves
# the CPU idle between round-trips, so hundreds of workers still average low
# utilization and the autoscaler never scales up. The fix is to make each query
# a heavy, ~1-2s pure-CPU chunk (deeply nested md5 over a large generate_series)
# so every worker keeps a core pinned the whole time — with enough workers this
# saturates all provisioned CUs and forces scale-up. `count(*)` over the hashed
# rows forces full evaluation (nothing is optimised away). Rows is tunable at
# runtime via the /act5/start `rows` param — crank it if the compute isn't
# climbing.
def _build_load_query(rows: int) -> str:
    return (
        "SELECT count(*) FROM ("
        "SELECT md5(md5(md5(md5(g::text) || md5((g*2)::text)))) "
        f"FROM generate_series(1, {int(rows)}) g) x"
    )

# Default per-query weight: 3M rows x ~5 md5 ops each ≈ 15M hashes (~1-2s of
# pure CPU per query) — heavy enough that a few hundred workers pin all CUs.
_DEFAULT_LOAD_ROWS = 3_000_000
_load_query = _build_load_query(_DEFAULT_LOAD_ROWS)

# Shared load-test state (single test at a time).
_load = {
    "running": False,
    "workers": 0,
    "target_workers": 0,
    "active_connections": 0,
    "total_queries": 0,
    "errors": 0,
    "peak_connections": 0,
    "start_time": None,
    "elapsed": 0.0,
    "vcpus": None,
    "timeline": [],       # [{t, active, qps, vcpus}]
    "phase": "idle",      # idle | ramping | sustaining | done
}
_load_lock = _threading.Lock()
_load_stop = _threading.Event()
_last_qcount_for_qps = {"t": 0.0, "q": 0}
# One shared connection factory for all workers, built once per test. Generating
# an OAuth credential per worker (hundreds at once) rate-limits the control
# plane; instead we mint host/user/token once and reuse the token string.
_load_conn_info = {"host": None, "user": None, "token": None}


def _worker_connection():
    import psycopg2
    ci = _load_conn_info
    conn = psycopg2.connect(
        host=ci["host"], port=5432, dbname="databricks_postgres",
        user=ci["user"], password=ci["token"], sslmode="require", connect_timeout=15,
    )
    conn.autocommit = True
    return conn


def _load_worker(start_delay):
    _load_stop.wait(start_delay)
    if _load_stop.is_set():
        return
    try:
        conn = _worker_connection()
    except Exception as e:
        with _load_lock:
            _load["errors"] += 1
            if not _load.get("last_error"):
                _load["last_error"] = f"{type(e).__name__}: {e}"[:200]
        return
    with _load_lock:
        _load["active_connections"] += 1
        _load["peak_connections"] = max(_load["peak_connections"], _load["active_connections"])
    cur = conn.cursor()
    try:
        while not _load_stop.is_set():
            try:
                cur.execute(_load_query)
                cur.fetchone()
                with _load_lock:
                    _load["total_queries"] += 1
            except Exception:
                with _load_lock:
                    _load["errors"] += 1
                break
    finally:
        with _load_lock:
            _load["active_connections"] -= 1
        try:
            conn.close()
        except Exception:
            pass


def _sample_vcpus():
    """Read the provisioned vCPU (num_cpus) as a coarse compute-size signal."""
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT num_cpus()")
            return float(cur.fetchone()[0])
    except Exception:
        return None


def _spawn_wave(count, ramp_s):
    """Launch `count` load workers over `ramp_s` seconds."""
    for i in range(count):
        delay = (i / max(1, count)) * ramp_s
        _threading.Thread(target=_load_worker, args=(delay,), daemon=True).start()


def _load_orchestrator(num_workers, duration_s, ramp_s, step_at=30, wave1_frac=0.5):
    """Two-wave "step" load test. Wave 1 (wave1_frac of workers) ramps up
    immediately; at `step_at` seconds a second wave steps the load up to the
    full count — producing a visible step in connections/queries (and, we hope,
    a step up in compute). Runs in a bg thread.
    """
    # Mint ONE credential up front and share it across all workers.
    try:
        w, endpoint = get_client()
        ep = w.postgres.get_endpoint(name=endpoint)
        cred = w.postgres.generate_database_credential(endpoint=endpoint)
        _load_conn_info.update(host=ep.status.hosts.host,
                               user=w.current_user.me().user_name,
                               token=cred.token)
    except Exception as e:
        with _load_lock:
            _load.update(running=False, phase="done",
                         last_error=f"setup failed: {type(e).__name__}: {e}"[:200])
        return

    wave1 = max(1, int(num_workers * wave1_frac))
    wave2 = max(0, num_workers - wave1)

    with _load_lock:
        _load.update(running=True, workers=0, target_workers=num_workers,
                     active_connections=0, total_queries=0, errors=0,
                     peak_connections=0, start_time=time.time(), elapsed=0.0,
                     vcpus=None, timeline=[], phase="wave1", last_error=None,
                     step_at=step_at, stepped=False)
    _load_stop.clear()
    _last_qcount_for_qps.update(t=time.time(), q=0)

    # Wave 1 now.
    _spawn_wave(wave1, min(ramp_s, step_at * 0.6))

    start = _load["start_time"]
    stepped = False
    while not _load_stop.is_set() and (time.time() - start) < duration_s:
        time.sleep(3)
        now = time.time()
        elapsed = now - start

        # Fire wave 2 at the step point.
        if not stepped and wave2 > 0 and elapsed >= step_at:
            _spawn_wave(wave2, 8)
            stepped = True
            with _load_lock:
                _load["stepped"] = True

        vcpus = _sample_vcpus()
        with _load_lock:
            _load["elapsed"] = elapsed
            _load["vcpus"] = vcpus
            dt = now - _last_qcount_for_qps["t"]
            dq = _load["total_queries"] - _last_qcount_for_qps["q"]
            qps = (dq / dt) if dt > 0 else 0
            _last_qcount_for_qps.update(t=now, q=_load["total_queries"])
            _load["phase"] = "surge" if stepped else ("wave1" if elapsed < step_at else "wave1")
            _load["timeline"].append({
                "t": round(elapsed, 1),
                "active": _load["active_connections"],
                "qps": round(qps, 1),
                "vcpus": vcpus,
                "step": stepped,
            })

    # Wind down.
    _load_stop.set()
    time.sleep(2)
    with _load_lock:
        _load["running"] = False
        _load["phase"] = "done"
        _load["elapsed"] = time.time() - start


@router.post("/act5/start")
def act5_start(num_workers: int = 500, duration_s: int = 90, ramp_s: int = 15,
               step_at: int = 30, rows: int = _DEFAULT_LOAD_ROWS):
    """Start the two-wave "step" end-of-quarter load test in the background.

    Wave 1 (~half the workers) ramps immediately; at `step_at` seconds a second
    wave steps the load up to the full `num_workers`, producing a visible step.
    250 -> 500 works reliably *because* of the two-wave design: launching 500
    cold hits the low-CU connection-permit throttle (~290) and errors, but
    wave 1 (250) warms the compute first, growing the permit budget so wave 2
    lands the full 500 with no errors (empirically verified).

    `rows` tunes the per-query CPU weight (rows hashed per query). Autoscaling
    responds to SUSTAINED CPU, so heavier queries + enough workers are what push
    the compute up. Bump `rows` if the CU isn't climbing on your workload.
    """
    global _load_query
    with _load_lock:
        if _load["running"]:
            return {"ok": True, "already_running": True,
                    "log": ["Load test already running."]}
    _load_query = _build_load_query(rows)
    t = _threading.Thread(
        target=_load_orchestrator,
        args=(num_workers, duration_s, ramp_s, step_at), daemon=True)
    t.start()
    return {"ok": True, "log": [
        f"End-of-quarter crunch: first wave of ~{num_workers // 2} users arriving…",
        f"A second wave steps up to ~{num_workers} at {step_at}s — watch it climb.",
    ], "num_workers": num_workers, "duration_s": duration_s, "step_at": step_at,
        "rows": rows}


@router.get("/act5/progress")
def act5_progress():
    """Live metrics for the running (or last) load test."""
    with _load_lock:
        qps = 0.0
        if _load["timeline"]:
            qps = _load["timeline"][-1]["qps"]
        return {
            "running": _load["running"],
            "phase": _load["phase"],
            "active_connections": _load["active_connections"],
            "peak_connections": _load["peak_connections"],
            "total_queries": _load["total_queries"],
            "errors": _load["errors"],
            "elapsed": round(_load["elapsed"], 1),
            "qps": qps,
            "vcpus": _load["vcpus"],
            "target_workers": _load["target_workers"],
            "timeline": _load["timeline"][-40:],
            "last_error": _load.get("last_error"),
            "stepped": _load.get("stepped", False),
            "step_at": _load.get("step_at", 30),
        }


@router.post("/act5/stop")
def act5_stop():
    """Stop the load test early."""
    _load_stop.set()
    return {"ok": True, "log": ["Load test stopped. Compute will scale back down when idle."]}
