# Sales Pipeline Portal — Lakebase Demo

A presenter-driven Databricks App that tells the **Lakebase** story end-to-end. A
non-technical presenter runs the whole demo from a single **Demo Control** tab —
each act is a button that performs a real operation against a live Lakebase
(Postgres 17, Autoscaling) project, so the audience sees genuine branching,
point-in-time recovery, lakehouse→app syncing, and autoscaling — not slides.

The app is a **FastAPI** backend + **React/Vite** frontend, deployed as a
Databricks App with its service principal wired to Lakebase and a SQL warehouse.

## Quickstart — deploy with DABs

The app ships as a **Databricks Asset Bundle** (`databricks.yml`). One deploy
provisions *everything* declaratively — the Lakebase project (sized 0.5–12 CU),
all grants, the app, and both resource bindings.

**Mental model:** `deploy` creates/updates the cloud resources; `run` starts the
app. You always act *on a target* (a named workspace) with `-t <target>`.

### 1. Prerequisites

- Databricks CLI installed and authenticated to your workspace:
  ```bash
  databricks auth login --profile <your-profile>
  databricks auth profiles            # confirm your profile is listed + valid
  ```
- A **SQL warehouse** id (`databricks warehouses list`) and a **Unity Catalog
  catalog** the app's service principal can create a schema in.
- The workspace must be **Lakebase-enabled** (Autoscaling / serverless).

### 2. Point a target at your workspace

Targets live at the bottom of [`databricks.yml`](databricks.yml). The `fevm`
target is pre-filled for the original demo workspace; for anywhere else, edit the
`other` target (or copy it) and fill in these five values:

```yaml
  other:                                 # use with: -t other
    mode: development
    workspace:
      profile: <your-cli-profile>        # from `databricks auth profiles`
    variables:
      app_name: sales-portal-v2          # any app name (bundle creates it)
      lakebase_project: sales-db-demo    # any NEW Lakebase project id (bundle creates it)
      warehouse_id: "<your-warehouse-id>"  # from `databricks warehouses list`
      gold_catalog: <a-uc-catalog>       # catalog the app SP can create a schema in
      gold_schema: sales_ml              # any schema name
```

| Variable | What it is |
|----------|------------|
| `workspace.profile` | Your Databricks CLI profile (the workspace to deploy to). |
| `app_name` | Name for the Databricks App (bundle creates it). |
| `lakebase_project` | Name for the Lakebase project — **must not already exist**; the bundle creates it. |
| `warehouse_id` | SQL warehouse for Act 4's gold Delta table. |
| `gold_catalog` / `gold_schema` | UC location for the Act 4 gold + synced table. |

### 3. Deploy and start

```bash
cd sales-portal

databricks bundle validate -t other      # (optional) check the config parses
databricks bundle deploy   -t other      # create Lakebase project + app + bindings + grants
databricks bundle run sales_portal -t other   # start the app — prints the URL
```

Open the printed URL → **Demo Control** tab → run the acts.

> To deploy to the pre-configured demo workspace instead, just use `-t fevm`
> (it's the default target, so `-t fevm` can even be omitted).

### Gotchas

- **Don't reuse a just-deleted Lakebase project name.** Deleting a project
  reserves its slug for a while ([databricks/cli#5783](https://github.com/databricks/cli/issues/5783));
  a redeploy then fails with *"project slug already exists."* Free it with
  `databricks api delete "/api/2.0/postgres/projects/<id>?purge=true"`, or use a
  new name.
- **CU sizing (0.5–12) only applies when the bundle first *creates* the project.**
  Adopting a pre-existing project won't resize it (set it manually — see
  [DEPLOY.md](DEPLOY.md)).
- **`bundle destroy` deletes the project AND its data.** To reset between demos,
  use the app's **↺ Reset demo** button — never `destroy`.

## The demo — 5 acts

Run top to bottom in the **Demo Control** tab. Each card carries its own
presenter talk-track ("SAY" line) and step buttons.

| Act | What it shows |
|-----|---------------|
| **1 · Setup & Seed Data** | Create the schema + tables (empty), then seed realistic sales data. Lakebase = managed Postgres 17 that scales to zero when idle. |
| **2 · Branching & Schema Evolution** | Create a **zero-copy branch** in seconds, evolve it, and promote — instead of developing on prod or waiting on a replica. |
| **3 · Disaster & PITR Recovery** | Someone drops the `opportunities` table; **point-in-time recovery** restores it with zero data loss (with a fun SOS/😢 terminal moment). |
| **4 · Synced Tables — Lakehouse to App** | Publish an ML **gold table** in Unity Catalog, sync it into Lakebase (no ETL glue), watch the Retention Risk page light up, then re-score. |
| **5 · End-of-Quarter Load Test & Autoscaling** | Two waves of load (250 → 500 concurrent connections firing heavy CPU-bound queries) drive the compute to **autoscale** live, then scale back to zero. |

**↺ Reset demo** returns everything to a clean slate (drops demo tables,
branches, synced table, and gold table) so it's ready for the next run.

## Architecture

```
sales-portal/
├── databricks.yml          # DABs bundle — variables + targets (deploy entry point)
├── resources/
│   ├── lakebase.yml        # Lakebase project: 0.5–12 CU + CAN_MANAGE grant (declarative)
│   └── app.yml             # the app + SQL warehouse binding + Lakebase postgres binding
├── app.py                  # FastAPI entry point (also serves the built frontend)
├── app.yaml                # app runtime config (used by the Option A script path)
├── requirements.txt
├── server/                 # backend
│   ├── db.py               # Lakebase connection (auto-refreshing OAuth token)
│   ├── schema_detector.py
│   └── routes/
│       ├── demo.py         # Demo Control orchestration — all 5 acts
│       └── {accounts,opportunities,churn,features}.py   # dashboard APIs
├── client/                 # React/Vite frontend
│   ├── src/{App.tsx, main.tsx}, index.html, configs
│   └── out/                # built frontend (committed so it deploys as-is)
├── scripts/deploy-v2.sh    # Option A: imperative deploy (fallback to DABs)
├── DEPLOY.md               # full deploy reference
├── deploy.env.example      # per-workspace config template (copy to deploy.env)
└── .gitignore
```

### How the permissions fit together

- The app's **`postgres` resource binding** (`CAN_CONNECT_AND_CREATE`) auto-creates
  the service principal's Postgres role and grants CONNECT + CREATE — this covers
  Acts 1, 4, 5 (running SQL inside the DB).
- **`CAN_MANAGE` on the Lakebase project** (granted declaratively via the project's
  `permissions`) is a *control-plane* right the binding can't give — it's what lets
  the app create/promote/delete **branches** for Acts 2 & 3.
- The **SQL warehouse binding** (`CAN_USE`) lets Act 4 build the gold Delta table.

## Prerequisites

- A **Lakebase-enabled** (Autoscaling / serverless) Databricks workspace.
- A **SQL warehouse** you can use (Act 4).
- A **Unity Catalog catalog** the app's service principal can create a schema in
  (holds the Act 4 gold + synced table).
- **Databricks CLI** authenticated to the workspace (`databricks auth login`).
- For local dev / the Option A script: `node`, `uv`.

## Deploy

### Option B — Databricks Asset Bundle (recommended, fully declarative)

Two commands provision **everything** — the Lakebase project (sized 0.5–12 CU),
all grants, the app, and both resource bindings — no post-deploy script:

```bash
databricks bundle deploy -t fevm              # project + CU + grants + app + bindings
databricks bundle run   sales_portal -t fevm  # start the app
```

For a new workspace, add or edit a target in `databricks.yml` (profile +
variables: `app_name`, `lakebase_project`, `warehouse_id`, `gold_catalog`,
`gold_schema`) and deploy with `-t <target>`.

> ⚠️ **CU sizing applies only when the bundle first *creates* the project.**
> Adopting a pre-existing project won't resize it. Also, `bundle destroy` deletes
> the project **and its data** (the demo rebuilds data on demand via Act 1).
> `purge_on_delete: true` is set on the project to avoid the slug-reservation bug
> ([databricks/cli#5783](https://github.com/databricks/cli/issues/5783)) — it's
> honored by newer CLI versions.

### Option A — shell script (self-contained, targets existing resources)

```bash
cp deploy.env.example deploy.env     # fill in your workspace values
./scripts/deploy-v2.sh
```

The script runs preflight checks, builds the frontend, configures the service
principal (both bindings + `CAN_MANAGE` + the CU bump), then uploads and deploys.

See **[DEPLOY.md](DEPLOY.md)** for the full reference, including what's
auto-resolved (workspace host and all Lakebase deep-links are computed at runtime
by the app via `/api/demo/config`).

## Local development

```bash
# backend deps (for scripts / local SDK use)
uv venv .venv
uv pip install --python .venv/bin/python databricks-sdk psycopg2-binary

# frontend
cd client && npm install && npm run build   # outputs to client/out/
```

## Configuration & secrets

Per-workspace config lives in `deploy.env` (**git-ignored** — copy
`deploy.env.example` and fill it in). No secrets are committed; the app
authenticates as its Databricks App service principal at runtime.
