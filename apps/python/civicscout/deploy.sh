#!/usr/bin/env bash
set -e

# Configuration
SERVICE_NAME="civicscout-service"
REGION="us-central1"
PROJECT_ID=${GCP_PROJECT_ID:-$(gcloud config get-value project)}

echo "=========================================================="
echo "Deploying CivicScout to Google Cloud Run"
echo "Project:  ${PROJECT_ID}"
echo "Region:   ${REGION}"
echo "Service:  ${SERVICE_NAME}"
echo "=========================================================="

# Build and Deploy via Cloud Build / Cloud Run
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID},FIRESTORE_USE_MOCK=false,ENVIRONMENT=production"

echo "Deployment complete! Fetching service URL..."
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --platform managed --region "${REGION}" --format="value(status.url)")
echo "CivicScout is live at: ${SERVICE_URL}"
echo "FastMCP endpoint:      ${SERVICE_URL}/mcp"
echo "Webhook endpoint:      ${SERVICE_URL}/api/webhooks/calle"
