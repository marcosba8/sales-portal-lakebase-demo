# Sales Pipeline Portal — Lakebase Demo

A presenter-driven Databricks App that tells the **Lakebase** story end-to-end. A
non-technical presenter runs the whole demo from a single **Demo Control** tab —
each act is a button that performs a real operation against a live Lakebase
(Postgres 17, Autoscaling) project, so the audience sees genuine branching,
point-in-time recovery, lakehouse→app syncing, and autoscaling — not slides.

The app is a **FastAPI** backend + **React/Vite** frontend, deployed as a
Databricks App with its service principal wired to Lakebase and a SQL warehouse.

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
