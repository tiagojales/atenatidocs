#!/bin/bash

# ==============================================================================
# Script para copiar os pacotes ZIP do backend para o S3.
# Este script assume que os arquivos `layer.zip` e `backend.zip`
# já existem no diretório `lambda`.
#
# USO:
#   Execute este script a partir do diretório raiz do projeto:
#   ./pre-deploy-backend.sh
# ==============================================================================

set -e # Sai imediatamente se um comando falhar.

echo "--- AtenaDocs Backend Deployment ---"

# --- Passo 1: Determinar detalhes do ambiente AWS ---
echo "Buscando AWS Account ID e Region..."
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
AWS_REGION=$(aws configure get region)

if [ -z "$AWS_ACCOUNT_ID" ] || [ -z "$AWS_REGION" ]; then
    echo "Não foi possível determinar o AWS Account ID ou a Região. Por favor, configure seu perfil da AWS CLI."
    exit 1
fi

# --- Passo 2: Construir o nome do bucket de artefatos ---
# Este nome DEVE corresponder ao criado pelo pre-deploy-template.yaml
ARTIFACTS_BUCKET_NAME="atenadocs-artifacts-pdf-merge-${AWS_ACCOUNT_ID}-${AWS_REGION}"
echo "Bucket de Artefatos Alvo: ${ARTIFACTS_BUCKET_NAME}"

# --- Passo 3: Caminhos para os arquivos ZIP pré-empacotados ---
LAYER_ZIP_PATH="lambda/layer.zip"
LAMBDA_FUNCTION="lambda/lambda_function.zip"

# --- Passo 4: Fazer o upload dos artefatos para o S3 ---
echo "Fazendo upload dos artefatos para o S3..."
aws s3 cp "${LAYER_ZIP_PATH}" "s3://${ARTIFACTS_BUCKET_NAME}/layer.zip"
aws s3 cp "${LAMBDA_FUNCTION}" "s3://${ARTIFACTS_BUCKET_NAME}/lambda_function.zip"

echo ""
echo "✅ Pré-deploy do backend bem-sucedido!"
echo "Artefatos enviados para s3://${ARTIFACTS_BUCKET_NAME}/"
echo "Agora você pode prosseguir com o deploy da stack do CloudFormation (deploy-template.yaml)."
echo "------------------------------------"
