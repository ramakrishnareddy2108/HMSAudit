# HMS Invoice Tracker — Claude Code Execution Guide

## One-Time Setup (Do This First — 10 minutes)

Copy these files into your repo root before running any prompt:

```
your-repo/
├── CLAUDE.md                          ← copy from hms-ai-setup/CLAUDE.md
├── .ai/
│   ├── rules.md                       ← copy from hms-ai-setup/.ai/rules.md
│   ├── templates/
│   │   ├── backend-feature.md
│   │   ├── frontend-feature.md
│   │   └── fix-only.md
│   └── checklists/
│       ├── backend.md
│       └── frontend.md
└── prompts/
    ├── p04a-invoice-detail-backend.md
    ├── p04b-invoice-detail-frontend.md
    ├── p05a-edit-invoice-backend.md
    ├── p05b-edit-invoice-frontend.md
    ├── p06a-review-backend.md
    ├── p06b-review-frontend.md
    ├── p07-user-dept-management.md
    ├── p08-grn-sync.md
    ├── p09-reconciliation.md
    ├── p10-payments.md
    ├── p11-ledger-dashboard-reports.md
    ├── p12-notifications-layout.md
    └── p13-polish-deploy.md
```

---

## How to Start Every Claude Code Session

**Step 1 — Open Claude Code in your repo root**
```bash
cd your-project-root
claude
```

**Step 2 — First message in every new session:**
```
Read CLAUDE.md and .ai/rules.md before starting.
```
Wait for acknowledgment. This loads all context in ~50 tokens instead of you re-explaining everything.

**Step 3 — Use /compact proactively**
When your session feels long or you're getting repetitive responses, type:
```
/compact
```
Then continue. This preserves context while freeing window space.

---

## Execution Order (Remaining Work)

You completed Prompts 1–3. Run remaining prompts in this exact order:

| Step | Prompt File | Est. Time | Notes |
|---|---|---|---|
| 1 | p04a | 20 min | Backend only — fast |
| 2 | p04b | 30 min | Frontend detail page |
| 3 | p05a | 20 min | Backend only — fast |
| 4 | p05b | 25 min | Frontend edit page |
| 5 | p06a | 15 min | Backend only — verify endpoints |
| 6 | p06b | 40 min | Review queue + detail — complex UI |
| 7 | p07 | 45 min | User + dept management |
| 8 | p08 | 50 min | GRN sync — complex backend |
| 9 | p09 | 60 min | Reconciliation — most complex |
| 10 | p10 | 50 min | Payments + email |
| 11 | p11 | 60 min | Ledger + dashboard + reports (combined) |
| 12 | p12 | 40 min | Notifications + layout |
| 13 | p13 | 30 min | Polish + deploy |

**Total: ~8–9 hours of focused work**

---

## How to Run Each Prompt

### Method 1 — Paste file content (recommended)
```bash
cat prompts/p04a-invoice-detail-backend.md | pbcopy
```
Then paste into Claude Code chat.

### Method 2 — Reference the file
In Claude Code chat, type:
```
Implement the task in prompts/p04a-invoice-detail-backend.md
```

---

## Rules for Each Session

### DO
- Run ONE prompt file per session
- Wait for Claude to finish completely before running the next
- After each prompt: test the feature manually before moving on
- Use `/compact` when the session grows long
- If Claude makes an error: paste the error + say "fix only this, no explanation"

### DO NOT
- Do not paste multiple prompt files at once
- Do not ask Claude to explain what it just built (wastes tokens)
- Do not let Claude rewrite files that aren't related to the current task
- Do not skip testing between prompts — bugs compound fast

---

## Session Starter Templates

### Starting a fresh session mid-project:
```
Read CLAUDE.md and .ai/rules.md.
Completed so far: p04a, p04b, p05a, p05b, p06a.
Now implement: [paste content of next prompt file]
```

### Fixing a bug:
```
Fix only:
[paste error message or describe bug]
Minimal change. No explanation needed.
```

### Asking Claude to verify its own work:
```
Check this file against .ai/checklists/backend.md and fix anything missing.
File: apps/api/src/routes/invoices.ts
```

---

## Token-Saving Habits

| Instead of... | Say... |
|---|---|
| "Can you explain what you just built?" | (don't ask — read the code) |
| "Please implement X and also fix Y and also add Z" | One thing at a time |
| "Rewrite the whole vendors page" | "Fix only the search filter in VendorManagementPage" |
| Long back-and-forth debugging | Paste error + "fix this only" |
| Re-explaining the whole project | "Read CLAUDE.md" |

---

## After All Prompts Are Done

1. Run `pnpm typecheck` — fix all errors
2. Run `pnpm --filter api build` — fix all errors  
3. Run `pnpm --filter web build` — fix all errors
4. Push to Railway (API) and Vercel (web)
5. Test with admin@hospital.com on production URL

---

## Update CLAUDE.md As You Go

After each prompt completes, add the new files to the "Files Created So Far" section in CLAUDE.md.
This keeps future sessions aware of what exists without re-reading the codebase.

Example update after p04:
```
apps/web/src/pages/invoices/InvoiceDetailPage.tsx
```
