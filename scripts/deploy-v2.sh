#!/bin/bash
# Deploy Sales Pipeline Portal **v2** to Databricks Apps.
#
# v2 differences vs deploy.sh:
#   - Targets the sales-db-v2 Lakebase project and the sales-portal-v2 app,
#     leaving the live sales-db / sales-portal demo untouched.
#   - Binds the Lakebase DB as an app resource (CAN_CONNECT_AND_CREATE), which
#     auto-creates the SP's Postgres role + grants CONNECT/CREATE — so the app
#     can create and own the `sales` schema itself (the Demo Control "Setup &
#     Seed" button runs the DDL, rather than the notebook). No manual grant.
#   - Uses the project-local .venv python (has databricks-sdk + psycopg2).
#
# Usage: ./scripts/deploy-v2.sh [--profile fevm-startups] [--skip-build]

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Per-workspace configuration ──────────────────────────────────────────────
# All workspace-specific values live in deploy.env (copy deploy.env.example and
# fill it in). CLI flags override deploy.env; deploy.env overrides these blank
# defaults. To deploy in a new workspace you only edit deploy.env — no code.
APP_NAME=""
LAKEBASE_PROJECT_ID=""
PROFILE=""
WAREHOUSE_ID=""          # SQL warehouse for Act 4 (bound to the app as CAN_USE)
GOLD_CATALOG=""          # UC catalog for the Act 4 gold + synced table
GOLD_SCHEMA=""           # UC schema for the gold Delta table
DEMO_SCHEMA_OWNER=""     # stable human owner for the gold schema (survives SP rotation)
SKIP_BUILD=false
SKIP_LAKEBASE=false

# Load deploy.env if present (before flag parsing so flags can override).
ENV_FILE="${DEPLOY_ENV:-$PROJECT_DIR/deploy.env}"
if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi

usage() {
  echo "Usage: $0 [options]   (most config comes from deploy.env)"
  echo "  --app-name NAME       Databricks App name"
  echo "  --lakebase-id ID      Lakebase project id"
  echo "  --profile PROFILE     Databricks CLI profile"
  echo "  --warehouse-id ID     SQL warehouse id (Act 4)"
  echo "  --gold-catalog NAME   UC catalog for the gold/synced table (Act 4)"
  echo "  --gold-schema NAME    UC schema for the gold table (Act 4)"
  echo "  --skip-build          Skip frontend build"
  echo "  --skip-lakebase       Skip Lakebase role/grants"
  echo "  -h, --help            Show this help"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help) usage; exit 0 ;;
    --app-name) APP_NAME="$2"; shift 2 ;;
    --lakebase-id) LAKEBASE_PROJECT_ID="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --warehouse-id) WAREHOUSE_ID="$2"; shift 2 ;;
    --gold-catalog) GOLD_CATALOG="$2"; shift 2 ;;
    --gold-schema) GOLD_SCHEMA="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --skip-lakebase) SKIP_LAKEBASE=true; shift ;;
    -*) echo -e "${RED}Unknown option $1${NC}"; usage; exit 1 ;;
    *) echo -e "${RED}Unexpected argument $1${NC}"; exit 1 ;;
  esac
done

# ── Validate required config ─────────────────────────────────────────────────
missing=""
[ -z "$APP_NAME" ]            && missing="$missing APP_NAME"
[ -z "$LAKEBASE_PROJECT_ID" ] && missing="$missing LAKEBASE_PROJECT_ID"
[ -z "$WAREHOUSE_ID" ]        && missing="$missing WAREHOUSE_ID"
[ -z "$GOLD_CATALOG" ]        && missing="$missing GOLD_CATALOG"
[ -z "$GOLD_SCHEMA" ]         && missing="$missing GOLD_SCHEMA"
if [ -n "$missing" ]; then
  echo -e "${RED}Missing required config:${NC}${missing}"
  echo -e "${YELLOW}Set these in deploy.env (see deploy.env.example) or pass as flags.${NC}"
  exit 1
fi

CLI_ARGS=""
if [ -n "$PROFILE" ]; then CLI_ARGS="--profile $PROFILE"; fi

LAKEBASE_ENDPOINT="projects/${LAKEBASE_PROJECT_ID}/branches/production/endpoints/primary"
STAGING_DIR="/tmp/${APP_NAME}-deploy"
VENV_PY="$PROJECT_DIR/.venv/bin/python"

echo -e "${BLUE}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Sales Pipeline Portal v2 Deployment           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}"
echo -e "  App:        ${GREEN}${APP_NAME}${NC}"
echo -e "  Lakebase:   ${LAKEBASE_PROJECT_ID}"
echo -e "  Profile:    ${PROFILE}"
echo ""

# ── Step 1: Prerequisites ────────────────────────────────────────────────────
echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"
command -v databricks &>/dev/null || { echo -e "${RED}Databricks CLI not found${NC}"; exit 1; }
command -v node &>/dev/null || { echo -e "${RED}Node.js not found${NC}"; exit 1; }
[ -x "$VENV_PY" ] || { echo -e "${RED}.venv python not found. Run: uv venv .venv && uv pip install --python .venv/bin/python databricks-sdk psycopg2-binary${NC}"; exit 1; }
databricks auth describe $CLI_ARGS &>/dev/null || { echo -e "${RED}Not authenticated${NC}"; exit 1; }

CURRENT_USER=$(databricks current-user me $CLI_ARGS --output json 2>/dev/null | "$VENV_PY" -c "import sys,json; print(json.load(sys.stdin).get('userName',''))")
WORKSPACE_PATH="/Workspace/Users/${CURRENT_USER}/apps/${APP_NAME}"
echo -e "  ${GREEN}✓${NC} User: ${CURRENT_USER}"
echo ""

# ── Preflight: verify workspace prerequisites before we change anything ───────
# Fails early with actionable guidance instead of a confusing mid-deploy error.
# Checks what the deploying user can see; SP-level grants are configured later.
echo -e "${YELLOW}Preflight checks...${NC}"
PREFLIGHT_FAIL=0

# 1. Lakebase project exists (with a production endpoint the app connects to).
if databricks postgres get-project "projects/${LAKEBASE_PROJECT_ID}" $CLI_ARGS &>/dev/null; then
  if databricks postgres get-endpoint "${LAKEBASE_ENDPOINT}" $CLI_ARGS &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Lakebase project '${LAKEBASE_PROJECT_ID}' + production endpoint"
  else
    echo -e "  ${RED}✗${NC} Lakebase project exists but no 'primary' endpoint on production branch"
    echo -e "     Create the production endpoint (or run the demo notebook's setup)."
    PREFLIGHT_FAIL=1
  fi
else
  echo -e "  ${RED}✗${NC} Lakebase project '${LAKEBASE_PROJECT_ID}' not found (or no access)"
  echo -e "     Create it first, e.g.: databricks postgres create-project ${LAKEBASE_PROJECT_ID} ..."
  PREFLIGHT_FAIL=1
fi

# 2. SQL warehouse exists and is reachable (Act 4 gold table).
if databricks warehouses get "$WAREHOUSE_ID" $CLI_ARGS &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} SQL warehouse '${WAREHOUSE_ID}' reachable"
else
  echo -e "  ${RED}✗${NC} SQL warehouse '${WAREHOUSE_ID}' not found (or no access)"
  echo -e "     Find one with: databricks warehouses list ${CLI_ARGS}"
  PREFLIGHT_FAIL=1
fi

# 3. Gold catalog exists (Act 4 gold + synced table live here).
if databricks catalogs get "$GOLD_CATALOG" $CLI_ARGS &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Catalog '${GOLD_CATALOG}' exists"
else
  echo -e "  ${RED}✗${NC} Catalog '${GOLD_CATALOG}' not found (or no access)"
  echo -e "     Pick an existing catalog the app SP can create a schema in."
  PREFLIGHT_FAIL=1
fi

# 4. Workspace 'users' group exists (Act 4 grants pipeline access to it). Warn only.
if databricks groups list $CLI_ARGS --output json 2>/dev/null | "$VENV_PY" -c "import sys,json; g=json.load(sys.stdin); import sys as s; s.exit(0 if any(x.get('displayName')=='users' for x in (g if isinstance(g,list) else g.get('Resources',[]))) else 1)" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Workspace 'users' group present"
else
  echo -e "  ${YELLOW}!${NC} Could not confirm a 'users' group — Act 4 pipeline sharing may need a manual grant"
fi

if [ "$PREFLIGHT_FAIL" = "1" ]; then
  echo -e "${RED}Preflight failed. Fix the ✗ items above, then re-run.${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Preflight passed"
echo ""

# ── Step 2: Build frontend ───────────────────────────────────────────────────
echo -e "${YELLOW}[2/5] Building frontend...${NC}"
if [ "$SKIP_BUILD" = true ]; then
  [ -d "$PROJECT_DIR/client/out" ] || { echo -e "${RED}No build found${NC}"; exit 1; }
  echo -e "  ${GREEN}✓${NC} Using existing build"
else
  cd "$PROJECT_DIR/client"
  [ -d node_modules ] || npm install --silent
  npm run build
  cd "$PROJECT_DIR"
  echo -e "  ${GREEN}✓${NC} Frontend built"
fi
echo ""

# ── Step 3: Stage deployment package ─────────────────────────────────────────
echo -e "${YELLOW}[3/5] Staging deployment...${NC}"
rm -rf "$STAGING_DIR"; mkdir -p "$STAGING_DIR/client"
cp app.py requirements.txt "$STAGING_DIR/"
cp -r server "$STAGING_DIR/"
cp -r client/out "$STAGING_DIR/client/"

cat > "$STAGING_DIR/app.yaml" << YAML
command:
  - "uvicorn"
  - "app:app"
  - "--host"
  - "0.0.0.0"
  - "--port"
  - "\$DATABRICKS_APP_PORT"

env:
  - name: LAKEBASE_ENDPOINT
    value: "${LAKEBASE_ENDPOINT}"
  - name: LAKEBASE_DATABASE_NAME
    value: "databricks_postgres"
  - name: WAREHOUSE_ID
    value: "${WAREHOUSE_ID}"
  - name: GOLD_CATALOG
    value: "${GOLD_CATALOG}"
  - name: GOLD_SCHEMA
    value: "${GOLD_SCHEMA}"
  - name: DEMO_SCHEMA_OWNER
    value: "${DEMO_SCHEMA_OWNER}"
YAML

find "$STAGING_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} Staged at ${STAGING_DIR}"
echo ""

# ── Step 4: Create app + configure permissions ───────────────────────────────
echo -e "${YELLOW}[4/5] Creating app & configuring permissions...${NC}"
if databricks apps get "$APP_NAME" $CLI_ARGS &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} App '${APP_NAME}' already exists"
else
  databricks apps create "$APP_NAME" $CLI_ARGS 2>&1
  echo -e "  ${GREEN}✓${NC} App '${APP_NAME}' created"
fi

SP_CLIENT_ID=$(databricks apps get "$APP_NAME" $CLI_ARGS --output json 2>/dev/null | "$VENV_PY" -c "import sys,json; print(json.load(sys.stdin).get('service_principal_client_id',''))")
[ -n "$SP_CLIENT_ID" ] || { echo -e "${RED}Could not get SP client ID${NC}"; exit 1; }
echo -e "  SP: ${SP_CLIENT_ID}"

if [ "$SKIP_LAKEBASE" != true ]; then
  BRANCH_PATH="projects/${LAKEBASE_PROJECT_ID}/branches/production"

  # Raise the production endpoint autoscaling ceiling to 0.5 -> 12 CU so the
  # Act 5 load test can visibly scale compute (the project default of max 2 CU
  # is too low to show meaningful autoscaling).
  databricks postgres update-endpoint \
    "${BRANCH_PATH}/endpoints/primary" \
    spec.autoscaling_limit_min_cu,spec.autoscaling_limit_max_cu \
    --json '{"spec":{"autoscaling_limit_min_cu":0.5,"autoscaling_limit_max_cu":12}}' $CLI_ARGS >/dev/null 2>&1 \
    && echo -e "  ${GREEN}✓${NC} Production endpoint set to 0.5-12 CU (Act 5 autoscaling)" \
    || echo -e "  ${YELLOW}!${NC} Could not raise CU ceiling (set manually if Act 5 doesn't scale)"

  # NOTE: the app SP's Postgres role + CONNECT + CREATE ON DATABASE are NOT
  # granted here anymore — they come for free from the `postgres` app-resource
  # binding below (permission CAN_CONNECT_AND_CREATE), which auto-creates the
  # role and grants CONNECT/CREATE on first deploy. The SP still creates & OWNS
  # the `sales` schema itself (via the Demo Control 'Create tables' button), so
  # the deploy never runs CREATE SCHEMA as the deploy user (which would flip
  # ownership and break the SP's reset).

  # Grant the app SP CAN_MANAGE on the Lakebase project (control-plane), so it
  # can create/promote/delete branches for Act 2 (Branching). Without this,
  # branch ops fail with "not authorized ... assign 'Can Manage'". This is
  # control-plane and can't be expressed via an app-resource binding.
  databricks api patch "/api/2.0/permissions/database-projects/${LAKEBASE_PROJECT_ID}" \
    --json "{\"access_control_list\": [{\"service_principal_name\": \"${SP_CLIENT_ID}\", \"permission_level\": \"CAN_MANAGE\"}]}" $CLI_ARGS >/dev/null 2>&1 \
    && echo -e "  ${GREEN}✓${NC} App SP granted CAN_MANAGE on project (branch ops enabled)" \
    || echo -e "  ${YELLOW}!${NC} Could not set CAN_MANAGE on project (grant manually if Act 2 fails)"
fi
echo ""

# Bind app resources: the SQL warehouse (Act 4) and the Lakebase Postgres DB
# (Acts 1-5). The platform grants the SP on-behalf: CAN_USE on the warehouse,
# and — via CAN_CONNECT_AND_CREATE — auto-creates the SP's Postgres role and
# grants CONNECT + CREATE ON DATABASE, plus injects PGHOST/PGPORT/PGDATABASE/
# PGUSER/PGSSLMODE. No manual create-role / GRANT needed. (The database resource
# id uses a HYPHEN — databricks-postgres — even though the DB name has an
# underscore.)
databricks apps update "$APP_NAME" --json "{
  \"resources\": [
    {\"name\": \"sql-warehouse\", \"description\": \"Act 4 gold churn table\",
     \"sql_warehouse\": {\"id\": \"${WAREHOUSE_ID}\", \"permission\": \"CAN_USE\"}},
    {\"name\": \"postgres\", \"description\": \"Lakebase production branch (Acts 1-5)\",
     \"postgres\": {\"branch\": \"projects/${LAKEBASE_PROJECT_ID}/branches/production\",
                    \"database\": \"projects/${LAKEBASE_PROJECT_ID}/branches/production/databases/databricks-postgres\",
                    \"permission\": \"CAN_CONNECT_AND_CREATE\"}}
  ]
}" $CLI_ARGS >/dev/null 2>&1 \
  && echo -e "  ${GREEN}✓${NC} SQL warehouse + Lakebase DB bound to app (Acts 1-5 enabled)" \
  || echo -e "  ${YELLOW}!${NC} Could not bind app resources (bind manually if acts fail)"
echo ""

# Grant the app SP the ability to land Lakebase CDF history tables
# (lb_<table>_history) into the gold schema. Act 4's Change Data Feed writes
# these Delta tables into GOLD_CATALOG.GOLD_SCHEMA, but that schema is owned by
# DEMO_SCHEMA_OWNER (a stable human, so it survives SP rotation) — so the SP has
# no CREATE there by default. This grant runs as the deploying user (the schema
# owner), the only identity that can grant it. Best-effort: the schema must
# already exist (Act 4 'Publish' creates it; on a fresh workspace run Publish
# once, then re-deploy, or grant manually).
if [ -n "$SP_CLIENT_ID" ]; then
  databricks grants update catalog "$GOLD_CATALOG" \
    --json "{\"changes\":[{\"principal\":\"${SP_CLIENT_ID}\",\"add\":[\"USE_CATALOG\"]}]}" $CLI_ARGS >/dev/null 2>&1 || true
  databricks grants update schema "${GOLD_CATALOG}.${GOLD_SCHEMA}" \
    --json "{\"changes\":[{\"principal\":\"${SP_CLIENT_ID}\",\"add\":[\"USE_SCHEMA\",\"CREATE_TABLE\"]}]}" $CLI_ARGS >/dev/null 2>&1 \
    && echo -e "  ${GREEN}✓${NC} App SP granted CREATE on ${GOLD_CATALOG}.${GOLD_SCHEMA} (CDF history tables)" \
    || echo -e "  ${YELLOW}!${NC} Could not grant SP CREATE on ${GOLD_SCHEMA} (run Act 4 'Publish' first, then re-deploy, or grant manually)"
  echo ""
fi

# ── Step 5: Upload & deploy ──────────────────────────────────────────────────
echo -e "${YELLOW}[5/5] Deploying...${NC}"
databricks workspace import-dir "$STAGING_DIR" "$WORKSPACE_PATH" --overwrite $CLI_ARGS 2>&1 | tail -3
databricks apps deploy "$APP_NAME" --source-code-path "$WORKSPACE_PATH" $CLI_ARGS 2>&1

APP_URL=$(databricks apps get "$APP_NAME" $CLI_ARGS --output json 2>/dev/null | "$VENV_PY" -c "import sys,json; print(json.load(sys.stdin).get('url','N/A'))")
echo ""
echo -e "${GREEN}Deployment complete!${NC}"
echo -e "  App URL:   ${GREEN}${APP_URL}${NC}"
echo -e "  Lakebase:  ${LAKEBASE_PROJECT_ID}"
echo -e "  SP:        ${SP_CLIENT_ID}"
