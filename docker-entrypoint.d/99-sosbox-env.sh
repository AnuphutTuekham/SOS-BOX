#!/bin/sh
set -eu

API_BASE_VALUE="${API_BASE:-}"
API_BASE_ESC=$(printf '%s' "$API_BASE_VALUE" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > /usr/share/nginx/html/config.js <<EOF
window.API_BASE = "${API_BASE_ESC}";
EOF
