# HMS AI Setup — Quick Reference

## One-Time Setup

Copy everything from this folder into your repo root:

```bash
# From inside hms-ai-setup folder:
cp CLAUDE.md ../your-repo/
cp -r .ai ../your-repo/
cp -r .vscode ../your-repo/
cp -r prompts ../your-repo/
cp -r scripts ../your-repo/
chmod +x ../your-repo/scripts/*.sh
```

Then add keyboard shortcuts — open VS Code:
Ctrl+Shift+P → "Open Keyboard Shortcuts (JSON)"
Copy contents of .vscode/keybindings-to-add.json into it.

---

## Daily Workflow (3 steps only)

### Step 1 — Check where you are
```bash
bash scripts/check-progress.sh
```
OR press `Ctrl+Shift+H` in VS Code

### Step 2 — Run next prompt
```bash
bash scripts/run-prompt.sh p04a-invoice-detail-backend
```
This copies the full prompt (with session starter) to your clipboard.
Paste it into Claude Code and wait for it to finish.

OR in VS Code: `Ctrl+Shift+P` → `Tasks: Run Task` → pick the prompt

### Step 3 — After Claude finishes
```bash
bash scripts/update-claude-md.sh
```
OR press `Ctrl+Shift+U` in VS Code

This auto-scans your repo and updates CLAUDE.md with all new files.
Next Claude Code session will know exactly what exists.

---

## Keyboard Shortcuts (after setup)

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+H` | Check progress |
| `Ctrl+Shift+U` | Update CLAUDE.md |
| `Ctrl+Shift+S` | Copy session starter to clipboard |
| `Ctrl+Shift+F` | Copy fix-only template to clipboard |

---

## When Claude Hits a Limit Mid-Session

Type `/compact` in Claude Code — it frees up context.
Then continue with the same prompt.

If session ends completely before prompt is done:
```bash
bash scripts/run-prompt.sh <same-prompt-name>
```
Claude will read CLAUDE.md again and pick up from current codebase state.

---

## File Map

```
CLAUDE.md                    Auto-loaded context — update after every prompt
.ai/rules.md                 Behavior rules — no TODOs, no explanations
.ai/checklists/backend.md    Verify backend completeness
.ai/checklists/frontend.md   Verify frontend completeness
.ai/templates/               Reusable prompt starters for new features
prompts/p04a → p13           One file per prompt — lean and focused
scripts/run-prompt.sh        Copies prompt to clipboard + shows next step
scripts/update-claude-md.sh  Auto-updates CLAUDE.md with new files
scripts/check-progress.sh    Shows what's done vs remaining
.vscode/tasks.json           VS Code task runner integration
```

---

## Prompt Execution Order

```
p04a → p04b → p05a → p05b → p06a → p06b →
p07 → p08 → p09 → p10 → p11 → p12 → p13
```

Always backend (a) before frontend (b).
One prompt per Claude Code session.
