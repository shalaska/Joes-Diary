#!/usr/bin/env bash
# Run once in Cloud Shell, as the project owner, to let the gateway send traces to Cloud Trace.
#
# 1. Turns on the Telemetry API (Cloud Trace's OTLP endpoint) and Cloud Trace itself.
# 2. Lets the service account the gateway functions run as write traces, and nothing more:
#    roles/telemetry.tracesWriter. It cannot read traces or change anything else.
#
# Safe to run twice. Undo: remove the role binding, or set GATEWAY_TRACING=off.
set -euo pipefail

PROJECT=joesdiary-d8211
REGION=europe-west1

gcloud services enable telemetry.googleapis.com cloudtrace.googleapis.com --project "$PROJECT"

for FN in llm mcp; do
  SA=$(gcloud functions describe "$FN" --region "$REGION" --project "$PROJECT" --format='value(serviceConfig.serviceAccountEmail)')
  echo "Function $FN runs as $SA"
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role=roles/telemetry.tracesWriter --condition=None --quiet >/dev/null
  echo "  granted roles/telemetry.tracesWriter"
done

echo "Done. Traces show up at https://console.cloud.google.com/traces/explorer?project=$PROJECT"
