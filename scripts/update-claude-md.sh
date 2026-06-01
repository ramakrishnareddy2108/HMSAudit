#!/bin/bash
# Scans apps/api and apps/web for new files and updates the
# "Files Created So Far" section in CLAUDE.md automatically.

CLAUDE_FILE="CLAUDE.md"

if [ ! -f "$CLAUDE_FILE" ]; then
  echo "❌ CLAUDE.md not found in current directory. Run from repo root."
  exit 1
fi

echo ""
echo "================================================"
echo "  HMS — Updating CLAUDE.md with new files"
echo "================================================"
echo ""

# Collect all relevant source files
API_FILES=$(find apps/api/src -type f -name "*.ts" 2>/dev/null | sort)
WEB_FILES=$(find apps/web/src -type f \( -name "*.tsx" -o -name "*.ts" \) 2>/dev/null | sort)
SHARED_FILES=$(find packages/shared/src -type f -name "*.ts" 2>/dev/null | sort)

# Build new file list block
NEW_BLOCK="## Files Created So Far
\`\`\`"

if [ -n "$API_FILES" ]; then
  NEW_BLOCK="${NEW_BLOCK}
# API Routes & Services"
  while IFS= read -r f; do
    NEW_BLOCK="${NEW_BLOCK}
${f}"
  done <<< "$API_FILES"
fi

if [ -n "$WEB_FILES" ]; then
  NEW_BLOCK="${NEW_BLOCK}

# Web Pages & Components"
  while IFS= read -r f; do
    NEW_BLOCK="${NEW_BLOCK}
${f}"
  done <<< "$WEB_FILES"
fi

if [ -n "$SHARED_FILES" ]; then
  NEW_BLOCK="${NEW_BLOCK}

# Shared Types"
  while IFS= read -r f; do
    NEW_BLOCK="${NEW_BLOCK}
${f}"
  done <<< "$SHARED_FILES"
fi

NEW_BLOCK="${NEW_BLOCK}
\`\`\`"

# Replace the existing "Files Created So Far" section in CLAUDE.md
# Uses Python for reliable multi-line replacement
python3 - <<PYEOF
import re

with open('$CLAUDE_FILE', 'r') as f:
    content = f.read()

new_section = """$NEW_BLOCK"""

# Replace section between "## Files Created So Far" and the next "##" heading
pattern = r'## Files Created So Far.*?(?=\n## |\Z)'
replacement = new_section

updated = re.sub(pattern, replacement, content, flags=re.DOTALL)

if updated == content:
    # Section doesn't exist yet — append it before the last line
    updated = content.rstrip() + '\n\n' + new_section + '\n'

with open('$CLAUDE_FILE', 'w') as f:
    f.write(updated)

print('✅ CLAUDE.md updated with current file list.')
PYEOF

echo ""
echo "Files now tracked in CLAUDE.md:"
echo ""
echo "$API_FILES" | head -20
echo ""
if [ $(echo "$API_FILES" | wc -l) -gt 20 ]; then
  echo "  ... and more. See CLAUDE.md for full list."
fi
