# Deploying the Sales Pipeline Portal (Lakebase demo)

A presenter-driven Lakebase demo app. The "Demo Control" tab orchestrates all 5
acts (setup/seed, branching, PITR, synced tables, load test) with buttons.

## Prerequisites in the target workspace

- **Lakebase enabled** (Autoscaling / serverless workspace) and a **project created**
  (the app connects to its `production` branch `primary` endpoint).
- A **SQL warehouse** you can use (Act 4 builds a gold Delta table through it).
- A **Unity Catalog catalog** for the Act 4 gold + synced table. **After the app
  exists, grant its service principal `USE CATALOG` + `CREATE SCHEMA` on that
  catalog** — the app SP is created without UC grants, so Act 4 fails with
  `PERMISSION_DENIED: User does not have USE CATALOG` until you run this (as the
  catalog owner). Additive and safe on shared catalogs:
  ```
  # SP = the app's service_principal_client_id (databricks apps get <app>)
  databricks grants update catalog <GOLD_CATALOG> \
    --json '{"changes":[{"principal":"<APP_SP_CLIENT_ID>","add":["USE_CATALOG","CREATE_SCHEMA"]}]}'
  ```
  The app then creates and owns its `sales_ml` (gold) and `sales` (synced) schemas.
- Databricks CLI authenticated to the workspace (`databricks auth login`).
- Local tooling: `node`, `uv`, and a project venv with the SDK:
  ```
  uv venv .venv
  uv pip install --python .venv/bin/python databricks-sdk psycopg2-binary
  ```

## Configure

Copy the template and fill in your workspace values:
```
cp deploy.env.example deploy.env
```
`deploy.env` (git-ignored) keys:
- `PROFILE` – Databricks CLI profile for the workspace
- `APP_NAME` – Databricks App name (created if missing)
- `LAKEBASE_PROJECT_ID` – Lakebase project id
- `WAREHOUSE_ID` – SQL warehouse id (`databricks warehouses list`)
- `GOLD_CATALOG` / `GOLD_SCHEMA` – UC location for the Act 4 gold/synced table

CLI flags (`--app-name`, `--warehouse-id`, `--gold-catalog`, …) override `deploy.env`.

## Deploy — Option A: shell script (self-contained)

```
./scripts/deploy-v2.sh
```

The script:
1. **Preflight** – verifies the project/endpoint, warehouse, catalog, and `users`
   group exist; fails early with guidance if not.
2. Builds the frontend, stages the package, generates `app.yaml` (injecting the
   env vars the backend reads).
3. Creates the app if needed and configures the service principal:
   - binds the **SQL warehouse** (`CAN_USE`, Act 4) and the **Lakebase DB**
     (`CAN_CONNECT_AND_CREATE`) as app resources. The Postgres binding
     auto-creates the SP's Postgres role and grants CONNECT + `CREATE ON
     DATABASE` (so the app owns the `sales` schema) — no manual role/grant.
   - `CAN_MANAGE` on the Lakebase project (Act 2 branching — control-plane,
     can't be expressed as a resource binding)
   - raises the production endpoint to 0.5–12 CU (Act 5 autoscaling)
4. Uploads + deploys.

## Deploy — Option B: Databricks Asset Bundle (DABs)

Native "clone repo + deploy" path — fully declarative, **two commands, no
post-deploy script**. Per-workspace values are bundle variables (edit the
target in `databricks.yml`, or pass `--var`):

```
databricks bundle deploy -t fevm              # project + CU + grants + app + bindings
databricks bundle run   sales_portal -t fevm  # start the app
```

The bundle declares everything:
- **`resources/lakebase.yml`** — the Lakebase Autoscaling project, sized
  **0.5–12 CU** via the project's `default_endpoint_settings` (Act 5), **and**
  `CAN_MANAGE` on the project for the app's SP (Act 2 branching / Act 3 PITR)
  via the project's `permissions` referencing
  `${resources.apps.sales_portal.service_principal_client_id}`.
- **`resources/app.yml`** — the app, its command/env, and **both resource
  bindings**: the SQL warehouse *and* the Lakebase DB
  (`CAN_CONNECT_AND_CREATE`, which auto-creates the SP's Postgres role and
  grants CONNECT + CREATE). The binding paths reference the project resource so
  it's created first. (App-binds-project + project-grants-app-SP is **not** a
  dependency cycle — the SP exists as soon as the app object is created.)
- For a new workspace, add/edit a target in `databricks.yml` (profile +
  variables) and use `-t <target>`.

> ⚠️ **CU sizing applies only on project *create*.** The `default_endpoint_settings`
> resize the auto-created production/primary endpoint when the bundle first
> creates the project. Adopting a *pre-existing* project won't resize it — for
> that case, set CU once with
> `databricks postgres update-endpoint projects/<proj>/branches/production/endpoints/primary spec.autoscaling_limit_min_cu,spec.autoscaling_limit_max_cu --json '{"spec":{"autoscaling_limit_min_cu":0.5,"autoscaling_limit_max_cu":12}}'`.
> Also note `bundle destroy` deletes the project **and its data** (the demo
> rebuilds data on demand via Act 1).

Both options produce the same running app; use whichever fits your workflow.

## What's auto-resolved (no config needed)

- Workspace host and all Lakebase Catalog/Monitoring deep-links are computed at
  runtime by the app (`/api/demo/config`).
- `databricks_postgres` is the standard Lakebase database name in every workspace.

## Running the demo

Open the app → **Demo Control** tab → run acts top to bottom. **↺ Reset demo**
returns everything to a clean slate (drops demo tables, branches, synced table,
gold table). Each act card in the UI carries its own presenter guidance.
