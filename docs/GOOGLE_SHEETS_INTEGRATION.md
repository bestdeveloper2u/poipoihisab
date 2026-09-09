# Google Sheets integration

This guide explains how to configure, use, verify, operate, and troubleshoot the
Google Sheets export in Poi Poi Hisab — the expenses that go into the workbook's
month tabs, and the debts, budget and recurring rules that go into its three
ledger tabs.

## What this integration does

Poi Poi Hisab exports the signed-in user's records to a Google spreadsheet: the
expenses, and — since R3.2 — the debts, the budget and the recurring rules, so a
copy of the workbook holds the whole ledger rather than only what was spent. The
backend authenticates to Google with one deployment-wide service account, and
each spreadsheet owner grants that service account access to only the sheet they
want to use.

The integration is:

- **One-way:** Poi Poi Hisab writes expenses to Google Sheets. It does not read
  changes back from the spreadsheet.
- **Monthly replacement:** each targeted month replaces rows 4–203 in columns
  A:C and E:F of the Bengali expense-workbook template. Formulas in D and
  manual comments in G are not written.
- **Whole-state ledger tabs:** every sync also rewrites `ধার-দেনা`, `বাজেট` and
  `পুনরাবৃত্ত খরচ` in full, whichever month range was requested. Those records
  are current state, not history, so `month` does not narrow them. A workbook
  without those tabs is an older copy of the template: the tabs are skipped and
  named in the response, and its months still sync.
- **Manual:** a user starts either a current-month or all-time sync from the web
  app's Settings page.
- **Owner-scoped:** the API exports only the expenses owned by the authenticated
  user making the request.
- **Service-account based:** end users do not connect their personal Google
  account through OAuth.

> **Important:** use a dedicated copy of the দৈনিক খরচের হিসাব workbook, and one
> whose ledger tabs exist — build them with
> `uv --directory apps/api run --with openpyxl python scripts/add_ledger_sheets.py in.xlsx out.xlsx`.
> The output must be a new file. Existing ledger tabs are refused by default;
> `--replace-ledger` explicitly rebuilds those tabs **without their records** in
> the new copy. Never use this option as a migration of a populated ledger.
> Sync replaces existing entries in each targeted month and rewrites the three
> ledger tabs entirely; it is not a merge. Hand edits to those three tabs are
> lost on the next sync, so make the change in the app.
> Repeating an unchanged sync does not duplicate rows. Manual comments stay in
> their cells, not attached to expense IDs, so review them if expense ordering changes.
> After a timeout, check whether the replacement completed before retrying.

## Five-minute setup summary

1. Create or select a Google Cloud project.
2. Enable the Google Sheets API.
3. Create a service account and download a JSON key.
4. Set `POIPOIHISAB_GOOGLE_SHEETS_SA_FILE`:
   - to the key file's absolute path for local or self-hosted deployments; or
   - to the complete JSON document for Vercel.
5. Restart or redeploy the API.
6. Sign in to Poi Poi Hisab as a normal ledger user and open **Settings**.
7. Copy the service-account email shown in the Google Sheets card.
8. Share the target Google spreadsheet with that email as an **Editor**.
9. Paste the spreadsheet URL or ID into Settings and select **Sync this month**
   or **Sync all**.

The remaining sections explain every step and the operational details.

## Architecture and data flow

```mermaid
sequenceDiagram
    actor User
    participant Web as Web Settings
    participant API as FastAPI
    participant DB as Expense database
    participant Google as Google Sheets API

    User->>Web: Paste spreadsheet URL and choose Sync
    Web->>API: POST /api/v1/export/sheets<br/>Bearer token + sheet + month
    API->>Google: Refresh service-account access token
    API->>Google: Read spreadsheet tab metadata
    API->>DB: Read current user's expenses in 500-row pages
    API->>API: Group by month; check template and all row limits
    API->>Google: Read template category list if present
    API->>Google: Replace A:C and E:F in one values:batchUpdate
    API-->>Web: {rows, months, unmapped}
    Web-->>User: Show localized result toast
```

The browser never receives the service-account private key. It receives only
the service account's `client_email`, which users need in order to share their
spreadsheet. The spreadsheet reference is stored in that browser's
`localStorage` under `dh.sheets.sheet`; it is not stored in the Poi Poi Hisab
database.

## Prerequisites

- A Google account allowed to create or use a Google Cloud project.
- Permission to create a service account and a user-managed key. An organization
  policy can disable service-account key creation; a Google Cloud administrator
  must change the policy or provide an approved credential in that case.
- Owner or Editor access to the target Google spreadsheet.
- A running Poi Poi Hisab API with its normal database and authentication
  configuration.
- The production Python dependency `google-auth[requests]`. It is already
  declared in both `apps/api/pyproject.toml` and `api/requirements.txt`.

This implementation needs the **Google Sheets API** only. It does not require
the Google Drive API, an OAuth consent screen, or a browser OAuth client.

## 1. Create the Google Cloud service account

### Console method

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project or select the project that will own this integration.
3. Open **APIs & Services** → **Library**.
4. Find **Google Sheets API** and select **Enable**.
5. Open **IAM & Admin** → **Service Accounts**.
6. Select **Create service account**.
7. Use a clear name such as `poipoihisab-sheets-export` and finish creation.
8. No project-level IAM role is needed for access to an individually shared
   spreadsheet. Access to the file is granted later through the spreadsheet's
   Share dialog.
9. Open the new service account, select **Keys** → **Add key** → **Create new
   key**, choose **JSON**, and download it.

Google documents these operations in [Enable Google Workspace
APIs](https://developers.google.com/workspace/guides/enable-apis) and [Create and
delete service account keys](https://cloud.google.com/iam/docs/keys-create-delete).

### `gcloud` method

Replace `YOUR_PROJECT_ID` before running these commands:

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable sheets.googleapis.com
gcloud iam service-accounts create poipoihisab-sheets-export \
  --display-name="Poi Poi Hisab Sheets export"
gcloud iam service-accounts keys create poipoihisab-sheets-export.json \
  --iam-account="poipoihisab-sheets-export@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

Move the downloaded key outside the repository immediately. For example, use a
dedicated local secrets directory or your hosting platform's secret store.

## 2. Configure Poi Poi Hisab

The API reads one setting:

```text
POIPOIHISAB_GOOGLE_SHEETS_SA_FILE
```

Despite the `_FILE` suffix, it accepts either:

- a filesystem path to a JSON service-account key; or
- the JSON key itself, when the value begins with `{`.

Environment-variable names are case-insensitive through the application
settings, but uppercase is the documented form and should be used consistently.

### Local development on Windows PowerShell

Keep the key outside the repository, then set the variable in the terminal that
will start the API:

```powershell
$env:POIPOIHISAB_GOOGLE_SHEETS_SA_FILE = 'C:\secrets\poipoihisab-sheets-export.json'
uv --directory apps/api run uvicorn app.main:app --reload --port 8000
```

For persistent local configuration, add the following line to
`apps/api/.env` (create it if needed):

```dotenv
POIPOIHISAB_GOOGLE_SHEETS_SA_FILE=C:\secrets\poipoihisab-sheets-export.json
```

Use an absolute path so starting the API from another working directory cannot
change which file is loaded.

### Local development on Linux or macOS

```bash
export POIPOIHISAB_GOOGLE_SHEETS_SA_FILE=/secure/path/poipoihisab-sheets-export.json
uv --directory apps/api run uvicorn app.main:app --reload --port 8000
```

Or put the same absolute path in `apps/api/.env`.

### Vercel

Vercel functions do not use a persistent secret file, so configure the complete
JSON document as the variable value:

1. Open the Vercel project.
2. Go to **Settings** → **Environment Variables**.
3. Add `POIPOIHISAB_GOOGLE_SHEETS_SA_FILE`.
4. Paste the entire contents of the downloaded JSON key as the value. Do not add
   another pair of quotes around the document. The `private_key` field's `\n`
   escape sequences must remain valid JSON escapes.
5. Select the environments that need Sheets export, normally Production and
   Preview.
6. Save the variable and redeploy. Existing deployments do not automatically
   receive newly added environment variables.

The API detects the leading `{`, parses the value as inline JSON, and never
writes it to the serverless filesystem.

### Self-hosted server or container

Mount the JSON key as a read-only secret and point the environment variable at
the mounted file:

```dotenv
POIPOIHISAB_GOOGLE_SHEETS_SA_FILE=/run/secrets/poipoihisab-sheets-export.json
```

The OS account running the API needs read permission on that file. Other users
should not. Restart the API after changing the setting.

## 3. Verify the deployment configuration

### From the web app

Sign in as a normal user and open **Settings**. A configured deployment shows:

- the Google Sheets URL or ID field;
- **Sync this month** and **Sync all** buttons; and
- an instruction containing the service-account email.

If the server says the integration is not configured, both sync buttons remain
disabled.

A superadmin does not see the personal-ledger Sheets card. Superadmins can check
deployment-wide configuration at **Admin** → **Integrations**, including the
loaded credential source and service-account email. The private key is never
returned by the admin API.

### From the API

The status endpoint requires a valid Poi Poi Hisab access token:

```bash
curl -sS http://127.0.0.1:8000/api/v1/export/sheets/status \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Successful configured response:

```json
{
  "configured": true,
  "sa_email": "poipoihisab-sheets-export@YOUR_PROJECT_ID.iam.gserviceaccount.com"
}
```

An unconfigured or unreadable credential produces:

```json
{
  "configured": false,
  "sa_email": null
}
```

This status check validates that the configured value can be read and parsed as
a JSON object. It does not contact Google or prove that the private key can mint
an access token; the first export performs that verification.

## 4. Share a target spreadsheet

Every spreadsheet must be shared separately unless it inherits access from a
shared folder.

1. Open a dedicated copy of the দৈনিক খরচের হিসাব workbook, with its Bengali
   month tabs (for example, `সেপ্টেম্বর ২০২৬`). Blank spreadsheets are not supported.
2. Select **Share**.
3. Paste the exact `sa_email` shown by Poi Poi Hisab.
4. Set access to **Editor**.
5. Select **Send** or **Share**.

Viewer or Commenter access is insufficient because the integration replaces
expense cells. The spreadsheet does not need to be public; restricted
sharing with the service account is preferred. See Google's [spreadsheet
sharing instructions](https://support.google.com/docs/answer/9331169?hl=en).

If a Google Workspace policy prevents sharing to the service-account address,
ask the Workspace administrator to allow it or use a service account permitted
by that organization.

## 5. Export expenses from the web app

1. Sign in as a normal ledger user.
2. Open **Settings**.
3. Paste one of these values into **Google Sheets URL or ID**:
   - the complete URL, such as
     `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`; or
   - the bare `SPREADSHEET_ID` from that URL.
4. Move focus out of the field. The browser saves the reference locally.
5. Choose one action:
   - **Sync this month** exports the calendar month currently reported by the
     user's browser as `YYYY-MM`.
   - **Sync all** exports every expense owned by that user.
6. Wait for the localized success toast showing the number of expense rows
   exported.

Only HTTPS URLs on the exact `docs.google.com` host are accepted. Google Sheets
`edit`, `view`, `preview`, and `copy` URL forms are supported. URLs containing
credentials, a non-standard host/port, control characters, or another Google
document type are rejected.

## Spreadsheet output contract

The API uses the template's Bengali month tabs. R3.3 can prepare a wholly absent
year from an intact 2026 template; see below. For each synced month it replaces
rows 4–203 in A:C and E:F using `USER_ENTERED`. Unused trailing cells receive
empty strings in the same request, avoiding a separate destructive clear.

| Column | Header | Source | Format |
|---|---|---|---|
| A | `তারিখ` | Expense date | ISO `YYYY-MM-DD` |
| B | `বিবরণ` | Description | Text; empty when no description exists |
| C | `খাত` | Category | User-entered text |
| D | `গ্রুপ` | Template formula | Untouched |
| E | `পরিমাণ (৳)` | Amount | ASCII decimal string, parsed by Sheets |
| F | `পেমেন্ট` | Payment method | Bengali template dropdown label |
| G | `মন্তব্য` | Manual comments | Untouched |

Rows are ordered by expense date and then expense ID. The backend reads the
database in pages of 500 rows, then collects the target months for one write.
No headers are added. A selected empty month is cleared; Sync all targets only
months still containing app expenses. To clear a formerly exported month whose
last expense was deleted, explicitly request that month. More than 200 entries
in any target month refuses the entire export; use CSV for larger months.

### New years (R3.3)

Keep all twelve 2026 month tabs, `বার্ষিক সারসংক্ষেপ`, and `সেটিংস` as the source
template. A sync for a wholly absent year prepares twelve empty months and a
separate summary such as `বার্ষিক সারসংক্ষেপ ২০২৭`. The original summary is not
renamed or overwritten. Existing month tabs continue to sync as before; partially
missing years are not reconstructed automatically.

New month tabs retain the template's formulas, dropdowns and conditional formats,
but inherited expense inputs and manual-comment cells start empty. Date validation
is updated for each new month, including February 29 in leap years. The new summary
copies the source grid, dimensions and charts, with references retargeted to the
new year. The budget's MonthTabs list and dropdown expand; its selected month stays
unchanged. Notes occupying the required settings-column-I space cause a refusal,
not an overwrite. Customized monthly charts, missing template components or an
altered registry also require manual attention. Automatic rollover supports
1900–9999 and at most ten new years per sync; use month-filtered calls for larger
historical imports.

All month and ledger capacity limits are checked before writing. New-year
preparation uses one structural batch, then the existing `USER_ENTERED` values
batch. Google documents atomic application within a
[spreadsheet batch](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate),
not across those two calls. If the second call fails or times out, newly prepared
tabs can remain while the data-write outcome is unconfirmed. Inspect before retrying;
the retry reuses those tabs and never copies source expenses again. Do not delete
the new tabs as an automatic rollback. `created_tabs` names tabs created by a
successful request. This behavior is mock-tested, not yet verified against a live
Google workbook; use an approved disposable copy for the first rollover.

The response reports categories absent from `'সেটিংস'!B2:B` without changing
them, and the Settings toast now names them alongside the ledger counts and any
skipped tabs. Live date and amount parsing in the owner's spreadsheet locale
still needs verification.

Text columns are protected against spreadsheet formula injection. Values whose
first meaningful character is `=`, `+`, `-`, or `@`, or which begin with a tab,
carriage return, or newline, receive a leading apostrophe before being sent with
`USER_ENTERED` semantics.

## Ledger output contract

Three tabs hold what the month tabs cannot. Each is rewritten in full on every
sync, including the trailing empty rows, so a record deleted in the app clears
its row instead of being left behind. Every computed column is written *around*,
the same division of labour as column `D` on the month sheets: the sheet owns
its own arithmetic, and the sync owns only the facts.

`apps/api/scripts/add_ledger_sheets.py` builds all three, and names the same tab
titles and row bounds as `apps/api/app/routers/sheets.py`. Changing one without
the other is the failure both files' comments warn about.

### `ধার-দেনা` — rows 4–103, written in `A:E` and `G`

| Column | Header | Source | Notes |
|---|---|---|---|
| A | `তারিখ` | `debts.iso` | ISO `YYYY-MM-DD` |
| B | `কার সাথে` | `debts.party` | User-entered text |
| C | `ধরন` | `debts.dir` | `ধার দিয়েছি` (lend) / `ধার নিয়েছি` (borrow) |
| D | `বাকি (৳)` | `debts.amt` | **Outstanding**, not the original loan: a partial payment shrinks it in place |
| E | `নোট` | `debts.note` | Empty when absent |
| F | `অবস্থা` | Sheet formula | Untouched — derived from G, so the column and the summary panel cannot disagree |
| G | `পরিশোধের তারিখ` | `debts.settled_at` | Date part only; empty while open |

The panel in `I4:J9` totals receivable, payable, net position, settled, and the
open and total entry counts, all from the settle date being empty or not.

### `বাজেট` — rows 4–53 in `A:B`, plus the total in `D2`

| Cell / column | Header | Source | Notes |
|---|---|---|---|
| `B2` | month picker | — | Untouched. Names the month tab every actual-spend formula reads |
| `D2` | `মোট মাসিক বাজেট (৳)` | `budgets.total` | Written |
| A | `খাত` | `budgets.cats` keys | Ordered by `'সেটিংস'!B2:B`; a category the workbook does not list sorts last |
| B | `মাসিক সীমা (৳)` | `budgets.cats` values | A value that will not parse as a decimal is dropped, not written |
| C–F | actual, remaining, usage, state | Sheet formulas | Untouched |

Row 55 carries the reconciliation the budget screen has no room for: the month's
own total minus everything the budget rows absorbed, which is spend in categories
with no limit set.

### `পুনরাবৃত্ত খরচ` — rows 4–103, written in `A` and `C:I`

| Column | Header | Source | Notes |
|---|---|---|---|
| A | `খাত` | `recurring_expenses.cat` | Written |
| B | `গ্রুপ` | Sheet formula | Untouched — the same `INDEX/MATCH` the month tabs use, so a rule and an expense in one category cannot land in different groups |
| C | `পরিমাণ (৳)` | `recurring_expenses.amt` | ASCII decimal string |
| D | `পেমেন্ট মাধ্যম` | `recurring_expenses.pay` | Bengali dropdown label |
| E | `বিবরণ` | `recurring_expenses.desc` | Empty when absent |
| F | `কত দিন পর পর` | `recurring_expenses.freq` | `প্রতিদিন` / `প্রতি সপ্তাহে` / `প্রতি মাসে` / `প্রতি বছরে` |
| G | `শুরুর তারিখ` | `recurring_expenses.start_date` | ISO |
| H | `পরবর্তী` | `recurring_expenses.next_run` | ISO |
| I | `চালু?` | `recurring_expenses.active` | `চালু` / `বন্ধ` |
| J | `মাসিক সমমান (৳)` | Sheet formula | Untouched — daily ×30, weekly ×4.33, yearly ÷12 |

The panel in `L4:M8` counts active and paused rules, totals the monthly and
yearly commitment, and counts active rules whose next date has passed — the one
thing about a recurring rule that otherwise goes wrong in silence.

These are rules, not expenses: an occurrence materialized by
`POST /recurring/run` becomes a real expense and appears on its month tab.

## HTTP API reference

Both endpoints require the normal Poi Poi Hisab bearer access token. They are
also available in the local Swagger UI at
`http://127.0.0.1:8000/api/docs`.

### `GET /api/v1/export/sheets/status`

Reports whether the credential JSON is present and readable, and returns the
service-account email needed for spreadsheet sharing.

Response body:

```json
{
  "configured": true,
  "sa_email": "service-account@example.iam.gserviceaccount.com"
}
```

### `POST /api/v1/export/sheets`

Canonical request body:

```json
{
  "sheet": "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit",
  "month": "2026-09"
}
```

Use `null` for `month` to export all time:

```json
{
  "sheet": "SPREADSHEET_ID",
  "month": null
}
```

Successful response:

```json
{
  "rows": 42,
  "months": ["সেপ্টেম্বর ২০২৬"],
  "unmapped": [],
  "debts": 6,
  "budget_categories": 9,
  "recurring": 3,
  "skipped_tabs": [],
  "created_tabs": []
}
```

`rows` counts expenses. `debts`, `budget_categories` and `recurring` are the
whole of what those tabs now hold, not a delta — zero means the app holds none
and the tab was emptied to match. `skipped_tabs` names ledger tabs this workbook
does not have, which is how a zero count is told apart from an absent tab.

Example:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/export/sheets \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"sheet":"SPREADSHEET_ID","month":"2026-09"}'
```

The backend currently accepts the legacy input aliases `sheet_id` and
`sheet_url`, but new clients should use the OpenAPI field `sheet`.

### Error responses

Integration errors use a localized detail object:

```json
{
  "detail": {
    "code": "sheets_permission_denied",
    "message_bn": "সার্ভিস অ্যাকাউন্টকে শিটের সম্পাদনার অনুমতি দিন",
    "message_en": "Share the spreadsheet with the service account as an editor"
  }
}
```

| HTTP | Code | Meaning | Action |
|---|---|---|---|
| 401 | Authentication error | The Poi Poi Hisab access token is missing, invalid, or expired | Sign in or refresh the session |
| 403 | `sheets_permission_denied` | Google denied one of the spreadsheet operations | Share the exact spreadsheet with `sa_email` as Editor |
| 409 | `sheets_missing_month_tab` | A required Bengali month tab is absent | Use a template copy with matching year/month tabs |
| 409 | `sheets_year_template_invalid` | A new year cannot safely be prepared | Restore the intact 2026 template, resolve the named registry/layout issue, or use CSV; nothing was written |
| 409 | `sheets_month_full` | A target month exceeds the fixed 200-entry template limit | Use CSV export; inserting spreadsheet rows does not raise this limit |
| 409 | `sheets_ledger_full` | A ledger tab has more records than its fixed row count (100 debts, 50 budget categories, 100 recurring rules) | Nothing was written. Use `GET /export/backup.json` for the complete set |
| 422 | `sheets_invalid_sheet` | The spreadsheet ID or URL failed validation | Use a bare ID or an HTTPS `docs.google.com/spreadsheets/d/...` URL |
| 422 | `sheets_invalid_month` | `month` is not a valid non-zero `YYYY-MM` | Correct the request month or use `null` |
| 502 | `sheets_upstream_error` | Token refresh, network, Google response, or metadata parsing failed | Check Google API status/configuration and inspect the sheet before retrying |
| 503 | `sheets_unconfigured` | The credential is absent, unreadable, malformed, or unusable | Correct the environment value and restart/redeploy |

Private-key contents, local filenames, and upstream exception text are not
included in user-facing errors.

## Security and secret management

- Never commit the JSON key to this repository. The current `.gitignore` does
  not ignore arbitrary JSON files, so keeping the key outside the checkout is
  essential.
- Never put the credential in `VITE_*`, `EXPO_PUBLIC_*`, browser storage,
  frontend code, logs, screenshots, tickets, or chat messages. Those locations
  are not secret.
- Grant the service account access only to the spreadsheets it needs. It does
  not need a broad Google Cloud project role for this export flow.
- Keep target spreadsheets restricted instead of using "Anyone with the link."
- Limit who can read or change the production environment variable.
- Use separate service accounts for development and production.
- Rotate keys periodically and immediately after suspected exposure. Create a
  new key, update the environment variable, redeploy/restart, verify an export,
  and then delete the old key in Google Cloud.
- Removing the service account from a spreadsheet's Share dialog immediately
  removes this integration's access to that file.

Google recommends storing user-managed service-account keys securely; see
[Service account credentials](https://cloud.google.com/iam/docs/service-account-creds).

## Reliability, quotas, and current limitations

The integration makes one metadata read, an optional category-list read, and
one replacement write for all target months. Token refresh may make an additional
Google authentication request.

Each Google call has a 5-second connection timeout and a 30-second response
timeout, and redirects are rejected. On Vercel, the function itself is limited
to 25 seconds by `vercel.json`. Large histories may therefore need smaller
date-scoped product support in the future even though database reads are paged.

Google applies per-minute Sheets API quotas. Consult the current [Google Sheets
API usage limits](https://developers.google.com/workspace/sheets/api/limits)
before increasing export frequency.

Current product limitations:

- Web Settings exposes the export; the Expo mobile app does not currently
  expose a Sheets sync screen.
- Only expenses are exported. Budgets, debts, recurring rules, and reports are
  not exported.
- Bengali month names and the 200-row template layout are fixed.
- Export is not placed in the offline outbox; it requires live API and Google
  connectivity.
- There is no export ledger or two-way sync. An all-time sync cannot identify
  a previously exported month that now has zero expenses; select it explicitly.
- Concurrent syncs or manual spreadsheet edits are not reconciled.

## Troubleshooting

### Settings says the integration is not configured

1. Confirm `POIPOIHISAB_GOOGLE_SHEETS_SA_FILE` exists in the API process, not
   only in a frontend environment file.
2. For a file-based deployment, confirm the path exists and the API OS user can
   read it.
3. For Vercel, confirm the value is the complete JSON object rather than a local
   path, and that it is assigned to the environment being deployed.
4. Validate the JSON locally without printing its private key:

   ```powershell
   $info = Get-Content -Raw 'C:\secrets\poipoihisab-sheets-export.json' | ConvertFrom-Json
   $info.type
   $info.client_email
   ```

5. Restart or redeploy after correcting the value.

### Status is configured, but the first export returns 503

The status endpoint proves only that the JSON can be parsed. A missing or
invalid private key can still fail when credentials are constructed. Download
or create a new valid JSON service-account key, replace the configured value,
and restart/redeploy.

### Export returns 403

- Compare the spreadsheet's Editor address with the exact `sa_email` returned
  by the status endpoint.
- Confirm access is Editor, not Viewer or Commenter.
- Confirm the URL/ID belongs to the same spreadsheet that was shared.
- Check whether Google Workspace sharing policy blocks the service account.
- If the sheet or a relevant range is protected, make sure the service account
  can edit the destination.

### Export returns 502

- Confirm the Google Sheets API is enabled in the service account's project.
- Check for a revoked/disabled key and rotate it if necessary.
- Check outbound access to `oauth2.googleapis.com` and
  `sheets.googleapis.com`.
- Check Google service health and quota usage.
- Inspect the spreadsheet before retrying: a timeout can leave the outcome of
  the single replacement request unknown.
- For a large Vercel export, check function logs for a duration limit.

### The spreadsheet contains duplicates or repeated headers

The old exporter appended to a flat `Poi Poi Hisab` tab. The monthly exporter
does not use or remove that legacy tab. Keep a backup of old exports and use a
template copy for the new integration; repeated monthly syncs do not append.

### The buttons are disabled

The buttons remain disabled while status is loading, when the server reports
unconfigured credentials, while another sync is in progress, or when the input
is not a valid spreadsheet URL/ID. Superadmins intentionally do not receive the
personal-ledger card.

### A new key does not work immediately

Google notes that a newly created service-account key can take about a minute
to become usable. Wait briefly, then perform one careful retry after verifying
the sheet does not already contain the expected rows.

## Verification and tests

Run the focused backend contract suite:

```powershell
uv --directory apps/api run pytest tests/test_sheets_export.py tests/test_sheets_years.py -q
```

Run the focused web client and Settings suites:

```powershell
pnpm --filter @poipoihisab/web exec vitest run tests/sheets.test.ts tests/sheets-settings.test.tsx
```

Before merging any implementation change, run the repository's full gate:

```powershell
pnpm verify
```

The automated tests mock Google and do not write to a real spreadsheet. A safe
production smoke test should use a dedicated test user, a dedicated spreadsheet,
and a copy of the template. Sync the same month twice and compare row counts,
numeric monthly totals, dates, formulas in D, and manual comments in G; then
check the debt panel's receivable and payable totals against the app's ধার-দেনা
screen, and that the recurring sheet's monthly commitment matches the rules on
`/recurring`. This live round trip remains open in BACKLOG.md; mocked tests do
not prove it.

For R3.3, add a 2027 expense and a February 29, 2028 expense to a dedicated test
account and sync to an approved disposable template copy. Confirm twelve months
and one summary per new year; numeric new-year totals and charts; date and budget
dropdowns; no inherited input/comment rows; and unchanged 2026 totals. Sync again
and confirm no additional tabs or duplicate rows. R3.3 remains open until this
native-Google check is recorded.

The ledger sheets' formulas are verified separately and by a different means:
`add_ledger_sheets.py` writes them, sample rows are filled in, and the workbook
is recalculated in LibreOffice so every computed cell is read back as a number
rather than trusted as a string. That proves the arithmetic and says nothing
about Google.

## Implementation map

| Area | File | Responsibility |
|---|---|---|
| API configuration | `apps/api/app/core/config.py` | Declares the service-account setting |
| API lifecycle | `apps/api/app/main.py` | Bridges settings into the Sheets router environment |
| Sheets backend | `apps/api/app/routers/sheets.py` | Credential loading, validation, token refresh, monthly replacement, and errors |
| Year rollover planner | `apps/api/app/routers/sheets_years.py` | Atomic structural request plan: empty month copies, new-year summary/charts, date validation and picker expansion |
| Shared export query | `apps/api/app/routers/export.py` | Owner filter, date bounds, ordering, CSV columns, money serialization, and paging |
| Workbook template migration | `apps/api/scripts/add_ledger_sheets.py` | Builds the three ledger sheets — headers, formulas, dropdowns, conditional formats — and names the geometry the router writes into |
| Web client | `apps/web/src/lib/sheets.ts` | Status/export requests, URL validation, and browser persistence |
| Web UI | `apps/web/src/screens/Settings.tsx` | Sharing instructions and sync actions |
| Admin UI | `apps/web/src/screens/admin/AdminIntegrations.tsx` | Deployment-wide configuration visibility |
| API contract tests | `apps/api/tests/test_sheets_export.py` | Auth, validation, permissions, paging, failure, and formula-safety behavior |
| Web tests | `apps/web/tests/sheets.test.ts` and `apps/web/tests/sheets-settings.test.tsx` | Client contract, validation, storage, and UI states |

## Checklist

### Deployment owner

- [ ] Google Sheets API is enabled.
- [ ] A dedicated service account exists.
- [ ] Its JSON key is stored outside the repository.
- [ ] `POIPOIHISAB_GOOGLE_SHEETS_SA_FILE` contains a path locally/self-hosted or
      inline JSON on Vercel.
- [ ] The API was restarted or redeployed.
- [ ] The status endpoint returns `configured: true` and the expected email.
- [ ] A dedicated smoke-test spreadsheet exported successfully.

### End user

- [ ] The target spreadsheet is shared with the displayed service-account email
      as Editor.
- [ ] The Settings field contains the correct spreadsheet URL or ID.
- [ ] The chosen sync range is correct.
- [ ] The sheet was checked before any retry.
- [ ] The returned row count matches the expected expense count.
