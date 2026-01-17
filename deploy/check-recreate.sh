#!/bin/bash
TOKEN="nf-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1dWlkIjoiYzJiNjNmZjAtNDU5MS00YjI0LWJhYTAtNzc2ODY4MTEzODI4IiwiZW50aXR5SWQiOiI2OTZiYTRhNzJkM2Y3MGEwZTgxYzRiNDMiLCJlbnRpdHlUeXBlIjoidGVhbSIsInRva2VuSWQiOiI2OTZiYjQzZTJkM2Y3MGEwZTgxYzRkMTgiLCJ0b2tlbkludGVybmFsSWQiOiJhZG1pbjIiLCJyb2xlSWQiOiI2OTZiYjNlZDJkM2Y3MGEwZTgxYzRkMTYiLCJyb2xlSW50ZXJuYWxJZCI6ImFkbWluMiIsInR5cGUiOiJ0ZW1wbGF0ZSIsImlhdCI6MTc2ODY2NjE3NH0.TyeC3JLagjhE5H_C-jpwKmFAXMw1PGVYPPwSF1d2Oo0"

# Recreate frontend
echo "Creating frontend..."
curl -s -X POST "https://api.northflank.com/v1/projects/polymarketsim/services/combined" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "frontend",
    "billing": {"deploymentPlan": "nf-compute-10"},
    "deployment": {"instances": 1},
    "ports": [{"name": "p01", "internalPort": 3000, "public": true, "protocol": "HTTP"}],
    "vcsData": {
      "projectUrl": "https://github.com/harrys1000rr/polymarket-tracker",
      "projectType": "github",
      "projectBranch": "main"
    },
    "buildSettings": {
      "dockerfile": {
        "buildEngine": "kaniko",
        "dockerFilePath": "/frontend/Dockerfile",
        "dockerWorkDir": "/frontend",
        "buildArguments": {
          "NEXT_PUBLIC_API_URL": "https://p01--backend--h769bkzvfdpf.code.run"
        }
      }
    }
  }'
