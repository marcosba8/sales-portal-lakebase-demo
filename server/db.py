"""Lakebase connection helper with auto-refreshing OAuth tokens."""
import os
import re
import time
import logging
import psycopg2
from contextlib import contextmanager
from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)

_w = None
_endpoint = None
_host = None
_user = None
_project = None  # e.g. "sales-db-v2", parsed from LAKEBASE_ENDPOINT

def _init():
    """One-time init: resolve endpoint host and user."""
    global _w, _endpoint, _host, _user, _project
    if _w is not None:
        return

    _w = WorkspaceClient()
    _endpoint = os.environ.get("LAKEBASE_ENDPOINT", "")
    db_name = os.environ.get("LAKEBASE_DATABASE_NAME", "databricks_postgres")

    m = re.match(r"projects/([^/]+)/", _endpoint or "")
    _project = m.group(1) if m else None

    # Prefer the values injected by the `postgres` app-resource binding
    # (CAN_CONNECT_AND_CREATE): PGHOST is the production endpoint host and
    # PGUSER is the exact Postgres role the binding auto-created and granted
    # CONNECT/CREATE. Falling back to the SDK keeps local dev working.
    _host = os.environ.get("PGHOST")
    _user = os.environ.get("PGUSER")
    if not _host:
        ep = _w.postgres.get_endpoint(name=_endpoint)
        _host = ep.status.hosts.host
    if not _user:
        _user = _w.current_user.me().user_name

    logger.info(f"Lakebase init: {_host} as {_user} (project={_project})")


def get_client():
    """Return the initialized WorkspaceClient (and the LAKEBASE_ENDPOINT path)."""
    _init()
    return _w, _endpoint


def get_project():
    """Return the Lakebase project id (e.g. 'sales-db-v2')."""
    _init()
    return _project


def new_raw_connection():
    """Open a fresh psycopg2 connection to the production endpoint with a new
    OAuth token. Used by the Act 5 load test to open many connections."""
    _init()
    cred = _w.postgres.generate_database_credential(endpoint=_endpoint)
    conn = psycopg2.connect(
        host=_host, port=5432, dbname=_db_name(),
        user=_user, password=cred.token, sslmode="require", connect_timeout=15,
    )
    conn.autocommit = True
    return conn


def run_warehouse_sql(statement: str, catalog: str | None = None, schema: str | None = None):
    """Execute a SQL statement on the bound SQL warehouse (Act 4 gold table).

    Uses the Statement Execution API as the app service principal. The warehouse
    is bound to the app as a resource (CAN_USE), and its id comes from the
    WAREHOUSE_ID env var. Returns the SDK response; raises on non-success.
    """
    import os as _os
    from databricks.sdk.service.sql import StatementState
    _init()
    wh_id = _os.environ.get("WAREHOUSE_ID", "")
    if not wh_id:
        raise RuntimeError("WAREHOUSE_ID not configured on the app.")
    resp = _w.statement_execution.execute_statement(
        statement=statement, warehouse_id=wh_id,
        catalog=catalog, schema=schema, wait_timeout="50s",
    )
    state = resp.status.state if resp.status else None
    # If it's still running past the sync wait window, poll to completion.
    while state in (StatementState.PENDING, StatementState.RUNNING):
        resp = _w.statement_execution.get_statement(resp.statement_id)
        state = resp.status.state if resp.status else None
    if state != StatementState.SUCCEEDED:
        msg = resp.status.error.message if (resp.status and resp.status.error) else str(state)
        raise RuntimeError(f"Warehouse SQL failed: {msg}")
    return resp


def _db_name():
    return os.environ.get("LAKEBASE_DATABASE_NAME", "databricks_postgres")


def ensure_branch_endpoint(branch_id, wait_seconds=45):
    """Ensure a branch has a ready READ_WRITE endpoint. Returns (endpoint_name,
    host) if ready, or (endpoint_name, None) if still provisioning.

    Idempotent & resumable: safe to call repeatedly. Creates the endpoint if
    none exists, then polls up to wait_seconds for the host to come up.
    """
    from databricks.sdk.service.postgres import (
        Endpoint, EndpointSpec, EndpointType, Duration as Dur,
    )
    _init()
    branch_full = f"projects/{_project}/branches/{branch_id}"
    endpoints = list(_w.postgres.list_endpoints(parent=branch_full))

    if not endpoints:
        logger.info(f"Creating endpoint for branch '{branch_id}'...")
        _w.postgres.create_endpoint(
            parent=branch_full,
            endpoint=Endpoint(spec=EndpointSpec(
                endpoint_type=EndpointType.ENDPOINT_TYPE_READ_WRITE,
                autoscaling_limit_min_cu=0.5,
                autoscaling_limit_max_cu=2.0,
                suspend_timeout_duration=Dur(seconds=300),
            )),
            endpoint_id=f"ep-{branch_id}",
        )
        endpoints = list(_w.postgres.list_endpoints(parent=branch_full))

    ep = endpoints[0]
    deadline = time.time() + wait_seconds
    while (not ep.status or not ep.status.hosts or not ep.status.hosts.host) \
            and time.time() < deadline:
        time.sleep(5)
        endpoints = list(_w.postgres.list_endpoints(parent=branch_full))
        ep = endpoints[0]

    host = ep.status.hosts.host if (ep.status and ep.status.hosts) else None
    return ep.name, host


@contextmanager
def get_conn_for_branch(branch_id):
    """Connect to a specific branch's endpoint (must already be provisioned).

    Raises RuntimeError if the branch endpoint isn't ready yet.
    """
    _init()
    ep_name, host = ensure_branch_endpoint(branch_id, wait_seconds=45)
    if not host:
        raise RuntimeError(f"Branch '{branch_id}' endpoint is still provisioning")
    cred = _w.postgres.generate_database_credential(endpoint=ep_name)
    conn = psycopg2.connect(
        host=host, port=5432, dbname=_db_name(),
        user=_user, password=cred.token, sslmode="require", connect_timeout=15,
    )
    conn.autocommit = True
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def get_conn():
    """Get a fresh connection with a new OAuth token every time.

    Usage:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1")
    """
    _init()
    cred = _w.postgres.generate_database_credential(endpoint=_endpoint)
    conn = psycopg2.connect(
        host=_host,
        port=5432,
        dbname=os.environ.get("LAKEBASE_DATABASE_NAME", "databricks_postgres"),
        user=_user,
        password=cred.token,
        sslmode="require",
        connect_timeout=15,
    )
    conn.autocommit = True
    try:
        yield conn
    finally:
        conn.close()
