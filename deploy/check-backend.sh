#!/bin/bash
TOKEN="nf-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1dWlkIjoiYzJiNjNmZjAtNDU5MS00YjI0LWJhYTAtNzc2ODY4MTEzODI4IiwiZW50aXR5SWQiOiI2OTZiYTRhNzJkM2Y3MGEwZTgxYzRiNDMiLCJlbnRpdHlUeXBlIjoidGVhbSIsInRva2VuSWQiOiI2OTZiYjQzZTJkM2Y3MGEwZTgxYzRkMTgiLCJ0b2tlbkludGVybmFsSWQiOiJhZG1pbjIiLCJyb2xlSWQiOiI2OTZiYjNlZDJkM2Y3MGEwZTgxYzRkMTYiLCJyb2xlSW50ZXJuYWxJZCI6ImFkbWluMiIsInR5cGUiOiJ0ZW1wbGF0ZSIsImlhdCI6MTc2ODY2NjE3NH0.TyeC3JLagjhE5H_C-jpwKmFAXMw1PGVYPPwSF1d2Oo0"

echo "=== Backend Deployment Status ==="
curl -s "https://api.northflank.com/v1/projects/polymarketsim/services/backend" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.status'

echo ""
echo "=== Backend Logs ==="
curl -s "https://api.northflank.com/v1/projects/polymarketsim/services/backend/logs?limit=50" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data.logs[]?.message // .data' 2>/dev/null || echo "Could not fetch logs"
