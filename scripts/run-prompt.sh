#!/bin/bash
# Usage: bash scripts/run-prompt.sh p04a-invoice-detail-backend

PROMPT_NAME=$1
PROMPT_FILE="prompts/${PROMPT_NAME}.md"

if [ -z "$PROMPT_NAME" ]; then
  echo "❌ No prompt name given. Usage: bash scripts/run-prompt.sh p04a-invoice-detail-backend"
  exit 1
fi

if [ ! -f "$PROMPT_FILE" ]; then
  echo "❌ Prompt file not found: $PROMPT_FILE"
  exit 1
fi

echo ""
echo "================================================"
echo "  HMS — Running Prompt: $PROMPT_NAME"
echo "================================================"
echo ""

# Build the full message: session starter + prompt content
SESSION_STARTER="Read CLAUDE.md and .ai/rules.md before starting.

---

"
PROMPT_CONTENT=$(cat "$PROMPT_FILE")
FULL_MESSAGE="${SESSION_STARTER}${PROMPT_CONTENT}"

# Copy to clipboard (macOS: pbcopy, Linux: xclip)
if command -v pbcopy &> /dev/null; then
  echo "$FULL_MESSAGE" | pbcopy
  echo "✅ Prompt copied to clipboard (macOS)"
elif command -v xclip &> /dev/null; then
  echo "$FULL_MESSAGE" | xclip -selection clipboard
  echo "✅ Prompt copied to clipboard (Linux/xclip)"
elif command -v xdotool &> /dev/null; then
  echo "$FULL_MESSAGE" | xdotool type --clearmodifiers --file -
  echo "✅ Prompt typed via xdotool"
else
  echo "⚠️  No clipboard tool found. Printing prompt below — copy manually:"
  echo ""
  echo "$FULL_MESSAGE"
fi

echo ""
echo "📋 Paste this into Claude Code to execute."
echo ""
echo "After Claude finishes:"
echo "  1. Test the feature manually"
echo "  2. Run: bash scripts/update-claude-md.sh"
echo "  3. Run the next prompt"
echo ""
echo "Next prompt after this one:"

# Auto-suggest next prompt
PROMPTS=(
  "p04a-invoice-detail-backend"
  "p04b-invoice-detail-frontend"
  "p05a-edit-invoice-backend"
  "p05b-edit-invoice-frontend"
  "p06a-review-backend"
  "p06b-review-frontend"
  "p07-user-dept-management"
  "p08-grn-sync"
  "p09-reconciliation"
  "p10-payments"
  "p11-ledger-dashboard-reports"
  "p12-notifications-layout"
  "p13-polish-deploy"
)

FOUND=0
for i in "${!PROMPTS[@]}"; do
  if [ "${PROMPTS[$i]}" == "$PROMPT_NAME" ]; then
    NEXT_INDEX=$((i + 1))
    if [ $NEXT_INDEX -lt ${#PROMPTS[@]} ]; then
      echo "  ➡️  bash scripts/run-prompt.sh ${PROMPTS[$NEXT_INDEX]}"
    else
      echo "  🎉 All prompts complete! Run: bash scripts/check-progress.sh"
    fi
    FOUND=1
    break
  fi
done

if [ $FOUND -eq 0 ]; then
  echo "  (prompt not in sequence list)"
fi
