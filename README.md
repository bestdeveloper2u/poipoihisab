# Poi Poi Hisab (পই পই হিসাব)

[![CI](https://img.shields.io/badge/CI-passing-brightgreen.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()
[![PWA](https://img.shields.io/badge/PWA-ready-orange.svg)]()
[![React](https://img.shields.io/badge/React-19-61dafb.svg)]()
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)]()
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8.svg)]()

> **পই পই হিসাব** — Modern, voice-first bilingual (Bengali / English) personal expense tracker, debt manager, and financial planning Progressive Web Application (PWA).

Poi Poi Hisab is built for everyday life in Bangladesh and beyond. Record daily expenses with Bengali voice dictation, track debts, manage monthly budgets, analyze financial reports, and synchronize with Google Sheets — with zero latency and full offline support.

---

## Table of Contents

- [Features](#-features)
- [Monorepo Architecture](#-monorepo-architecture)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Local Development Setup](#-local-development-setup)
  - [1. Clone and Install Dependencies](#1-clone-and-install-dependencies)
  - [2. Backend Setup (FastAPI)](#2-backend-setup-fastapi)
  - [3. Frontend Web Setup (React + Vite)](#3-frontend-web-setup-react--vite)
  - [4. Mobile App Setup (Expo / React Native)](#4-mobile-app-setup-expo--react-native)
- [Environment Variables](#-environment-variables)
- [Google Sheets Integration](#-google-sheets-integration)
- [Complete Deployment Guide](#-complete-deployment-guide)
  - [Deploying to Vercel (Recommended)](#1-deploying-to-vercel-recommended)
  - [Database Setup (PostgreSQL)](#2-database-setup-postgresql)
  - [Running Production Database Migrations](#3-running-production-database-migrations)
  - [Self-Hosted / VPS Deployment](#4-self-hosted--vps-deployment)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [Available Monorepo Scripts](#-available-monorepo-scripts)
- [License](#-license)

---

## 🚀 Features

- **🎙️ Bengali Voice-First Input**: Speak naturally in Bengali (e.g., *"মাছ ৮৯০ টাকা"*, *"রিকশা ভাড়া ৪০"*) — instant on-device/browser speech parsing and one-tap saving.
- **⚡ Offline-First Architecture**: Powered by a PWA Service Worker and local outbox queue. Add expenses anywhere without an internet connection; transactions automatically sync when back online.
- **💰 Expense & Budget Management**:
  - Daily & monthly expense breakdowns with categorized analytics.
  - Category budget tracking with visual progress and warning nudges.
  - Recurring expenses engine for monthly bills, rent, and subscriptions.
- **🤝 Debt & Loan Tracker (ধার)**:
  - Track receivables (*পাবো*) and payables (*দেবো*).
  - Partial repayment history, settlement status, and contact tagging.
- **📈 Rich Financial Reports**:
  - Interactive monthly and yearly spending matrices.
  - Expense category distribution and comparative trends.
- **📊 Google Sheets Integration**:
  - Writes each expense into the month tab of a দৈনিক খরচের হিসাব workbook, in that
    sheet's own column order, with the amount as a number and the group column left to
    the sheet's own lookup. A sync replaces the month it covers, so running it twice
    changes nothing and an expense edited in the app is corrected in the sheet.
  - Carries the rest of the ledger too: debts, the budget and the recurring rules go
    into three whole-state tabs, rewritten in full on every sync, so a copy of the
    workbook holds everything the app holds rather than only what was spent. The
    sheet keeps its own computed columns; the sync writes only the facts.
- **🛡️ Comprehensive Superadmin Dashboard**:
  - Registered user management with instant search and inspection.
  - Bulk actions: bulk suspend/unsuspend, bulk permanent delete with cascade.
  - Full CSV Import & Export with RFC-4180 parsing and formula injection protection.
  - Active session monitoring and one-click token revocation.
- **🔐 Enterprise-Grade Security**:
  - Argon2id password hashing.
  - JWT access tokens with Secure, HttpOnly refresh cookies.
  - PostgreSQL / Redis distributed session storage and brute-force rate-limiting.
- **🌐 Bengali-First with Full English Parity**:
  - Toggle effortlessly between Bengali (বাংলা) and English (EN) across all screens.
  - Dark, Light, and System themes.

---

## 🏗️ Monorepo Architecture

```
poipoihisab/
├── api/                       # Vercel Serverless entrypoint (@vercel/python ASGI bridge)
│   ├── index.py               # Shim loading apps/api/app into sys.path
│   └── requirements.txt       # Production dependencies for Vercel
├── apps/
│   ├── api/                   # FastAPI backend service
│   │   ├── alembic/           # Database migration scripts (PostgreSQL & SQLite)
│   │   ├── app/
│   │   │   ├── core/          # Settings (pydantic-settings), security (Argon2, JWT), KV store
│   │   │   ├── db/            # Database engine, base model, async sessions
│   │   │   ├── models/        # SQLAlchemy models (User, Expense, Debt, Budget, etc.)
│   │   │   ├── routers/       # API endpoints (/auth, /expenses, /debts, /admin, /sheets)
│   │   │   ├── schemas/       # Pydantic request/response schemas
│   │   │   └── main.py        # FastAPI application factory
│   │   ├── pyproject.toml     # Python dependencies managed with uv
│   │   └── openapi.json       # Auto-generated OpenAPI 3.1 specification
│   ├── web/                   # Progressive Web App (PWA) frontend
│   │   ├── public/            # Icons, PWA manifest assets, offline fonts
│   │   ├── src/
│   │   │   ├── components/    # Reusable UI components, modals, toasts, forms
│   │   │   ├── lib/           # Helpers (web-i18n, speech recognition, CSV import/export)
│   │   │   ├── screens/       # Routed pages (Dashboard, Expenses, Debts, Admin, etc.)
│   │   │   └── store/         # Zustand stores (Auth, Theme, Lang)
│   │   └── vite.config.ts     # Vite 6 + Tailwind v4 + VitePWA configuration
│   └── mobile/                # Mobile application
│       ├── app/               # Expo Router screen definitions
│       └── lib/               # Mobile themes, offline storage, haptics
├── packages/
│   ├── core/                  # Shared business logic, i18n dictionaries, brand tokens
│   └── api-client/            # Type-safe API client generated from OpenAPI
├── pnpm-workspace.yaml        # Workspace configuration
├── vercel.json                # Vercel unified deployment config (Web + Python API)
└── package.json               # Root monorepo script runner
```

---

## 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| **Web Frontend** | React 19, Vite 6, Tailwind CSS v4, TypeScript, Zustand, TanStack Query, VitePWA (Workbox) |
| **Backend API** | FastAPI, Python 3.13, SQLAlchemy 2 (Async), asyncpg, Alembic, Pydantic v2, uv |
| **Mobile** | React Native, Expo ~54, Expo Router, Expo Speech Recognition |
| **Database & Cache** | PostgreSQL 16+ (Production), SQLite/aiosqlite (Local Dev), Redis / Postgres KV |
| **Authentication** | Custom Argon2id + HS256 JWT + HttpOnly SameSite Refresh Cookies |
| **Tooling** | pnpm 10 workspaces, Vitest, ESLint, TypeScript, Ruff, Mypy |

---

## 📋 Prerequisites

Before running the project locally, ensure you have the following installed:

- **Node.js**: `v22.0.0` or higher
- **pnpm**: `v10.34.0` or higher (`npm install -g pnpm@10.34.5`)
- **Python**: `3.12` or `3.13` (with [uv](https://docs.astral.sh/uv/) installed: `curl -LsSf https://astral.sh/uv/install.sh | sh` or `winget install astral-sh.uv`)
- **Git**

---

## 💻 Local Development Setup

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/bestdeveloper2u/poipoihisab.git
cd poipoihisab

# Install Node monorepo dependencies across all packages
pnpm install
```

### 2. Backend Setup (FastAPI)

```bash
cd apps/api

# Install virtualenv and Python dependencies using uv
uv sync

# Run database migrations (defaults to local SQLite database poipoihisab.db)
uv run alembic upgrade head

# Start the FastAPI development server with auto-reload
uv run uvicorn app.main:app --reload --port 8000
```

> **API Documentation**: Once started, visit the interactive Swagger UI at [http://127.0.0.1:8000/api/docs](http://127.0.0.1:8000/api/docs).

### 3. Frontend Web Setup (React + Vite)

From the root directory:

```bash
# Start the web app on http://localhost:5173
pnpm dev:web
```

The web dev server automatically proxies `/api/*` requests to your local FastAPI backend running on port 8000.

### 4. Mobile App Setup (Expo / React Native)

```bash
# Start the Expo development server
pnpm --filter @poipoihisab/mobile start

# Or run directly on an Android emulator / device
pnpm --filter @poipoihisab/mobile android
```

---

## ⚙️ Environment Variables

All API environment variables are prefixed with `poipoihisab_` (enforced by `pydantic-settings`).

| Variable | Description | Default | Production Requirement |
|---|---|---|---|
| `poipoihisab_ENV` | Environment name (`local`, `prod`, `production`) | `local` | Set to `prod` |
| `poipoihisab_DATABASE_URL` | PostgreSQL async connection URL (`postgresql+asyncpg://...`) | `sqlite+aiosqlite:///./poipoihisab.db` | **Required** in prod |
| `poipoihisab_JWT_SECRET` | 64+ char random secret string for HS256 JWT signing | Ephemeral in dev | **Required** in prod |
| `poipoihisab_KV_URL` | Redis URL or PostgreSQL URL for sessions & rate limiting | `""` (In-memory) | Recommended (`poipoihisab_DATABASE_URL`) |
| `poipoihisab_CORS_ORIGINS` | JSON array or comma-separated list of allowed origins | `["http://localhost:5173", ...]` | Set to your live web domain |
| `poipoihisab_SUPERADMIN_EMAILS` | Comma-separated list of emails with Superadmin privileges | `["iforuimran@gmail.com"]` | Set your admin email |
| `poipoihisab_REFRESH_COOKIE_SECURE` | Set `0` only for non-HTTPS local dev; `1` for production | `1` (True) | Keep `1` (Secure cookie) |
| `poipoihisab_GOOGLE_SHEETS_SA_FILE` | Absolute path to Google Service Account JSON for Sheets sync | `""` | Optional |

---

## 📊 Google Sheets Integration

The web app can replace monthly expense rows in the signed-in user's Google
spreadsheet, and rewrite the workbook's `ধার-দেনা`, `বাজেট` and
`পুনরাবৃত্ত খরচ` tabs, through a deployment-wide service account. Setup requires
enabling the Google Sheets API, configuring the service-account JSON, and sharing
each target spreadsheet with the service-account email as an Editor. Build the
three ledger tabs into a workbook copy with
`apps/api/scripts/add_ledger_sheets.py`.

See the [complete Google Sheets integration guide](docs/GOOGLE_SHEETS_INTEGRATION.md)
for local and Vercel setup, end-user instructions, the API contract, output
columns, security guidance, testing, limitations, and troubleshooting.

---

## 🚀 Complete Deployment Guide

### 1. Deploying to Vercel (Recommended)

This repository includes a native, pre-configured `vercel.json` that deploys both the **Vite React PWA** and the **FastAPI Python serverless functions** simultaneously in a single deployment.

#### Step 1: Import Repository
1. Log in to [Vercel](https://vercel.com).
2. Click **"Add New..."** → **"Project"**.
3. Import your `bestdeveloper2u/poipoihisab` GitHub repository.

#### Step 2: Configure Project Settings
- **Framework Preset**: Vite (or Other)
- **Root Directory**: `./` (leave as root)
- **Build Command**: `pnpm --filter @poipoihisab/web build`
- **Output Directory**: `apps/web/dist`
- **Install Command**: `npx -y pnpm@10.34.5 install --frozen-lockfile`

*(All of these are already declared in `vercel.json`, so Vercel picks them up automatically!)*

#### Step 3: Add Environment Variables in Vercel
In the Vercel project settings, under **Settings** → **Environment Variables**, configure:

```ini
poipoihisab_ENV=prod
poipoihisab_DATABASE_URL=postgresql+asyncpg://<username>:<password>@<host>:5432/<database>?ssl=require
poipoihisab_JWT_SECRET=generate_a_long_random_secret_with_openssl_rand_hex_32
poipoihisab_KV_URL=postgresql+asyncpg://<username>:<password>@<host>:5432/<database>?ssl=require
poipoihisab_SUPERADMIN_EMAILS=your-email@example.com
```

> 💡 *Tip to generate a secure secret*: Run `openssl rand -hex 32` in your terminal.

---

### 2. Database Setup (PostgreSQL)

For production, you can use any managed PostgreSQL 16+ provider:
- [Supabase](https://supabase.com) (Free tier available)
- [Neon Database](https://neon.tech) (Serverless Postgres)
- [Railway](https://railway.app)
- [Aiven](https://aiven.io)

When creating your database, copy the **Transaction Pooler** or **Direct Connection URL**. Remember to ensure the protocol is `postgresql+asyncpg://`:

```
postgresql+asyncpg://USER:PASSWORD@HOST:5432/DATABASE?ssl=require
```

---

### 3. Running Production Database Migrations

Before launching, apply the Alembic database migrations to your production PostgreSQL database:

```bash
cd apps/api

# Run migrations against production PostgreSQL
poipoihisab_DATABASE_URL="postgresql+asyncpg://USER:PASSWORD@HOST:5432/DATABASE?ssl=require" \
  uv run alembic upgrade head
```

---

### 4. Self-Hosted / VPS Deployment

If deploying to a self-hosted Ubuntu/Debian server using Nginx and systemd:

#### 1. Build Web Assets
```bash
pnpm install
pnpm build:web
# Built static files are in apps/web/dist/
```

#### 2. Run FastAPI with Gunicorn / Uvicorn
Create a systemd unit `/etc/systemd/system/poipoihisab-api.service`:
```ini
[Unit]
Description=Poi Poi Hisab FastAPI Backend
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/poipoihisab/apps/api
EnvironmentFile=/etc/poipoihisab/api.env
ExecStart=/root/.local/bin/uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4
Restart=always

[Install]
WantedBy=multi-user.target
```

#### 3. Nginx Reverse Proxy Configuration
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    root /var/www/poipoihisab/apps/web/dist;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA Router fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 🧪 Testing & Quality Assurance

### Release labels

`apps/web/package.json` is the committed release-version reference (currently
`0.28.0`). Bump the workspace package versions, `packages/core/src/brand.ts`,
`apps/mobile/app.json`, `apps/api/pyproject.toml`, the API settings default and
`.env.example` together, then run `uv --directory apps/api lock`, `pnpm openapi`
and `pnpm generate:client` to refresh derived metadata. `pnpm run audit` checks
all eleven surfaces; `pnpm test:audits` tests the guard itself.

Web labels use the shared build version; mobile prefers Expo's packaged version
and falls back to the shared value when Expo metadata is absent. An explicit
`POIPOIHISAB_VERSION` remains a valid API-only runtime override, reported by
health/system endpoints; it does not relabel an already-built frontend. Real
environment files are not read by this audit. Release labels are not native
build numbers, and aligning them does not publish an app-store release.

### Verification gates

The codebase includes strict automated test gates:

[GitHub Actions: Verify](https://github.com/bestdeveloper2u/poipoihisab/actions/workflows/verify.yml)
runs on every push and pull request, and can be started manually. Fresh Ubuntu
and Windows jobs install locked dependencies, reject generated API contract drift,
run `pnpm verify`, and build the production web bundle. The workflow uses read-only
repository permissions and no production secrets; it does not deploy the app.

The optional real-Postgres tests and openpyxl template tests still skip when their
prerequisites are absent. Google Sheets calls remain mocked: green CI does not
close the live-workbook checks in `BACKLOG.md`. Branch protection is separate;
an owner can require both `Verify (ubuntu-24.04)` and `Verify (windows-2022)` checks
before merging. This change does not alter repository policy or Vercel's deployment
trigger. For workflow failures, inspect the failed step's log and fix the underlying
error; do not bypass a gate with `continue-on-error`. A faulty workflow can be
reverted with a normal reviewed revert commit without changing application data.

```bash
# Run the complete local gate from the repository root
pnpm verify

# Run all web frontend unit & integration tests (Vitest)
pnpm test:web

# Run core shared library tests
pnpm test:core

# Run TypeScript typechecks
pnpm typecheck:web
pnpm typecheck:mobile

# Run ESLint across web code
pnpm lint:web

# Run Python API tests (from apps/api)
cd apps/api && uv run pytest
```

---

## 📜 Available Monorepo Scripts

| Command | Description |
|---|---|
| `pnpm dev:web` | Starts the Vite web development server |
| `pnpm build:web` | Typechecks and compiles production web assets into `apps/web/dist` |
| `pnpm test:web` | Executes Vitest unit tests for the web application (530+ tests) |
| `pnpm lint:web` | Runs ESLint 9 checks across web application code |
| `pnpm typecheck:web` | Runs TypeScript `tsc --noEmit` on the web application |
| `pnpm typecheck:mobile` | Runs TypeScript `tsc --noEmit` on the mobile application |
| `pnpm test:core` | Executes unit tests for shared core helpers and i18n dictionaries |
| `pnpm test:audits` | Tests the release-version audit with passing and failing fixtures |
| `pnpm generate:client` | Re-generates typed OpenAPI client from `apps/api/openapi.json` |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
