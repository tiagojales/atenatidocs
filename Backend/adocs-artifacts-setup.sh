#!/bin/bash

# ======================================================================================
# Lambda Artifacts Setup Script
#
# This script prepares and uploads the Python Lambda function and its dependencies.
# It creates a zip file for the function code and another for the dependencies layer.
# ======================================================================================

# --- Configuration ---
set -e # Exit immediately if a command exits with a non-zero status.

# --- Input Validation ---
if [ -z "$1" ]; then
    echo "Error: Artifacts S3 bucket name must be provided as the first argument."
    exit 1
fi

# --- Variables ---
ARTIFACTS_BUCKET_NAME=$1
LAMBDA_CODE_DIR="./lambda"
BUILD_DIR="./lambda_build"
LAYER_ZIP_FILE="layer.zip"
LAMBDA_ZIP_FILE="lambda_function.zip"

# --- Helper Functions ---
function print_color() {
    COLOR=$1
    TEXT=$2
    echo -e "\033[${COLOR}m${TEXT}\033[0m"
}


# --- Main Execution ---
print_color "96" "-> Iniciando o processo de preparação para o ambiente: '$ARTIFACTS_BUCKET_NAME'..." # Cyan

# Cleanup previous build artifacts
rm -rf $BUILD_DIR $LAYER_ZIP_FILE $LAMBDA_ZIP_FILE
mkdir -p $BUILD_DIR

# --- Step 1: Create Layer from requirements.txt ---
print_color "93" "\n-> Passo 1 de 4: Preparando a camada (layer) a partir do 'requirements.txt'..." # Yellow

# Create a directory structure required by Lambda layers
mkdir -p "${BUILD_DIR}/python"

# Install dependencies into the build directory
pip install -r "${LAMBDA_CODE_DIR}/requirements.txt" -t "${BUILD_DIR}/python"

# Zip the dependencies
(cd $BUILD_DIR && zip -r "../${LAYER_ZIP_FILE}" .)
print_color "32" "   - Dependências Python instaladas."
print_color "32" "   - Camada '${LAYER_ZIP_FILE}' criada com sucesso."


# --- Step 2: Package Lambda Function Code ---
print_color "93" "\n-> Passo 2 de 4: Empacotando o código da função Lambda..." # Yellow

# Zip the function code
(cd $LAMBDA_CODE_DIR && zip -r "../${LAMBDA_ZIP_FILE}" .)
print_color "32" "   - Código da função '${LAMBDA_ZIP_FILE}' criado com sucesso."


# --- Step 3: Upload Artifacts to S3 ---
print_color "93" "\n-> Passo 3 de 4: Fazendo upload dos artefatos para o S3..." # Yellow
print_color "94" "   - Nome do Bucket de Artefatos: $ARTIFACTS_BUCKET_NAME"

aws s3 cp ./${LAYER_ZIP_FILE} s3://${ARTIFACTS_BUCKET_NAME}/${LAYER_ZIP_FILE}
aws s3 cp ./${LAMBDA_ZIP_FILE} s3://${ARTIFACTS_BUCKET_NAME}/${LAMBDA_ZIP_FILE}

print_color "32" "   - Upload da camada '${LAYER_ZIP_FILE}' concluído."
print_color "32" "   - Upload da função '${LAMBDA_ZIP_FILE}' concluído."

# --- Step 4: Cleanup Local Artifacts ---
print_color "93" "\n-> Passo 4 de 4: Limpando artefatos locais..." # Yellow
rm -rf $BUILD_DIR
rm $LAYER_ZIP_FILE
rm $LAMBDA_ZIP_FILE
print_color "32" "   - Limpeza concluída."

print_color "96" "
✅ Processo de empacotamento e upload finalizado."
