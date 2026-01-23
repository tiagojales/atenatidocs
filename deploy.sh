#!/bin/bash

# ======================================================================================
# Deploy Script for the AtenaDocs Full-Stack Application
#
# This script orchestrates the deployment of the entire application infrastructure,
# including artifacts, backend, and frontend, for a specified environment.
# ======================================================================================

# --- Configuration ---
set -e # Exit immediately if a command exits with a non-zero status.

# --- Helper Functions ---
function print_usage() {
  echo "Usage: ./deploy.sh -e <environment> -r <repository_url> [-d <domain>] [-z <hosted_zone_name>]"
  echo "  -e <environment>      : The environment to deploy (dev, stg, prod)."
  echo "  -r <repository_url>   : The full HTTPS URL of the frontend's GitHub repository."
  echo "  -d <domain>           : The root domain name (e.g., atenadocs.com). Required for stg and prod."
  echo "  -z <hosted_zone_name> : The Route 53 Hosted Zone Name (e.g., atenadocs.com.). Required for stg and prod to enable auto DNS creation."
  echo "  -h                    : Display this help message."
}

function print_color() {
  COLOR=$1
  TEXT=$2
  echo -e "\033[${COLOR}m${TEXT}\033[0m"
}

# --- Argument Parsing ---
ENVIRONMENT=""
DOMAIN=""
REPO_URL=""
HOSTED_ZONE_NAME=""

while getopts "e:d:r:z:h" opt; do
  case ${opt} in
    e) ENVIRONMENT=$OPTARG ;; 
    d) DOMAIN=$OPTARG ;;      
    r) REPO_URL=$OPTARG ;;    
    z) HOSTED_ZONE_NAME=$OPTARG ;; 
    h) print_usage; exit 0 ;;   
    \?) print_usage; exit 1 ;; 
  esac
done

# --- Input Validation ---
if [[ -z "$ENVIRONMENT" ]] || [[ -z "$REPO_URL" ]]; then
  print_color "91" "Error: Environment (-e) and Repository URL (-r) are mandatory." # Red
  print_usage
  exit 1
fi

if [[ "$ENVIRONMENT" == "stg" || "$ENVIRONMENT" == "prod" ]]; then
  if [[ -z "$DOMAIN" ]] || [[ -z "$HOSTED_ZONE_NAME" ]]; then
    print_color "91" "Error: Domain Name (-d) and Hosted Zone Name (-z) are required for 'stg' and 'prod' environments." # Red
    print_usage
    exit 1
  fi
fi

# Securely prompt for GitHub Token
read -sp 'Enter your GitHub OAuth Token (will not be displayed): ' GITHUB_TOKEN
echo "" # Newline after prompt

if [[ -z "$GITHUB_TOKEN" ]]; then
    print_color "91" "Error: GitHub Token is required." # Red
    exit 1
fi

# --- Deployment Execution ---
print_color "96" "🚀 Starting AtenaDocs deployment for environment: $ENVIRONMENT..." # Cyan

# --- Pre-flight Check: Verify Route 53 Hosted Zone ---
if [[ "$ENVIRONMENT" == "stg" || "$ENVIRONMENT" == "prod" ]]; then
    print_color "93" "\nVerifying Route 53 Hosted Zone '${HOSTED_ZONE_NAME}'..." # Yellow
    HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "${HOSTED_ZONE_NAME}" --query "HostedZones[?Name=='${HOSTED_ZONE_NAME}.'].Id" --output text)
    if [[ -z "$HOSTED_ZONE_ID" ]]; then
        print_color "91" "Error: Hosted Zone '${HOSTED_ZONE_NAME}' not found in Route 53 in this AWS account."
        exit 1
    fi
    print_color "32" "✅ Hosted Zone found: ${HOSTED_ZONE_ID}" # Green
fi


# 1. Deploy Artifacts Stack
STACK_NAME_ARTIFACTS="adocs-artifacts-stack-${ENVIRONMENT}"
print_color "93" "\n[Step 1/4] Deploying artifacts bucket..." # Yellow
aws cloudformation deploy \
    --template-file Backend/adocs-artifacts.yaml \
    --stack-name "$STACK_NAME_ARTIFACTS" \
    --parameter-overrides EnvironmentName="$ENVIRONMENT" \
    --no-fail-on-empty-changeset

print_color "32" "✅ Artifacts bucket stack deployed." # Green

# 2. Package and Upload Lambda Code
print_color "93" "\n[Step 2/4] Packaging and uploading Lambda artifacts..." # Yellow

# Dynamically get the bucket name from the just-deployed stack
ARTIFACTS_BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME_ARTIFACTS" --query "Stacks[0].Outputs[?OutputKey=='ArtifactsBucketName'].OutputValue" --output text)
if [[ -z "$ARTIFACTS_BUCKET_NAME" ]]; then
    print_color "91" "Error: Could not retrieve the artifacts bucket name from the CloudFormation stack outputs."
    exit 1
fi

(cd Backend && ./adocs-artifacts-setup.sh "$ARTIFACTS_BUCKET_NAME")
print_color "32" "✅ Lambda artifacts packaged and uploaded." # Green

# 3. Deploy Backend Stack
STACK_NAME_BACKEND="adocs-backend-stack-${ENVIRONMENT}"
print_color "93" "\n[Step 3/4] Deploying backend application stack..." # Yellow

# Base parameters for all environments
BACKEND_PARAMS="EnvironmentName=$ENVIRONMENT ArtifactsBucket=$ARTIFACTS_BUCKET_NAME"

# Add domain-specific parameters for stg and prod
if [[ "$ENVIRONMENT" == "stg" || "$ENVIRONMENT" == "prod" ]]; then
  BACKEND_PARAMS="$BACKEND_PARAMS FrontendDomain=$DOMAIN"
fi

aws cloudformation deploy \
    --template-file Backend/adocs-backend.yaml \
    --stack-name "$STACK_NAME_BACKEND" \
    --parameter-overrides $BACKEND_PARAMS \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset

print_color "32" "✅ Backend stack deployed." # Green

# 4. Deploy Frontend Stack
STACK_NAME_FRONTEND="adocs-frontend-stack-${ENVIRONMENT}"
print_color "93" "\n[Step 4/4] Deploying frontend application stack (AWS Amplify)..." # Yellow

# Get the API URL from the backend stack's outputs
API_URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME_BACKEND" --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
if [[ -z "$API_URL" ]]; then
    print_color "91" "Error: Could not retrieve the API URL from the backend stack outputs."
    exit 1
fi

# Base parameters for all environments
FRONTEND_PARAMS="EnvironmentName=$ENVIRONMENT RepositoryUrl=$REPO_URL GitHubOAuthToken=$GITHUB_TOKEN ApiUrl=$API_URL"

# Add domain-specific parameters for stg and prod
if [[ "$ENVIRONMENT" == "stg" || "$ENVIRONMENT" == "prod" ]]; then
  FRONTEND_PARAMS="$FRONTEND_PARAMS FrontendDomain=$DOMAIN HostedZoneName=$HOSTED_ZONE_NAME"
fi

aws cloudformation deploy \
    --template-file Backend/adocs-frontend.yaml \
    --stack-name "$STACK_NAME_FRONTEND" \
    --parameter-overrides $FRONTEND_PARAMS \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset

print_color "32" "✅ Frontend stack deployment initiated. Amplify will now build, deploy, and configure DNS records." # Green

# --- Retrieve and Display Final URL ---
print_color "93" "\nRetrieving the final application URL..." # Yellow

FINAL_URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME_FRONTEND" --query "Stacks[0].Outputs[?OutputKey=='FinalAppURL'].OutputValue" --output text)

print_color "96" "\n🎉 Deployment process complete! 🎉" # Cyan
print_color "32" "\nYour application URL is: $FINAL_URL"

# Note: The first Amplify build and DNS propagation can take 5-15 minutes.
# You can monitor the progress in the AWS Amplify and Route 53 consoles.
