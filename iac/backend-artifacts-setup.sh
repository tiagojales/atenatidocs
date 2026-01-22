#!/bin/bash

# ======================================================================================
# Script de Preparação e Upload dos Artefatos para o Serviço de Merge de PDF
# ======================================================================================
#
# Este script automatiza o processo de empacotamento do código da Lambda e de suas
# dependências Python, e faz o upload dos arquivos resultantes para o S3.
# Ele deve ser executado antes de fazer o deploy do `backend-dev-template.yaml`.
#
# Pré-requisitos:
# - AWS CLI configurada com credenciais válidas.
# - `pip` e `zip` instalados no ambiente de execução.
#
# Passos Executados:
# 1. Instala a biblioteca `pypdf` em uma estrutura de diretório específica para Layers.
# 2. Compacta a estrutura de dependências no arquivo `layer.zip`.
# 3. Compacta o código da função no arquivo `lambda_function.zip`.
# 4. Determina o nome do bucket de artefatos com base no ID da conta e região.
# 5. Faz o upload dos dois arquivos `.zip` para o bucket S3, substituindo os anteriores.
# 6. Limpa os arquivos temporários criados localmente.
# --------------------------------------------------------------------------------------

# `set -e` garante que o script irá parar imediatamente se um comando falhar.
set -e

# --- Configuração de Variáveis ---
LAMBDA_FUNCTION_FILE="lambda_function.py"
LAYER_ZIP_FILE="layer.zip"
LAMBDA_ZIP_FILE="lambda_function.zip"
LAYER_BUILD_DIR="layer_build"

echo "-> Iniciando o processo de preparação e upload dos artefatos..."

# --- Passo 1: Preparação da Camada (Layer) ---
echo "\n-> Passo 1 de 4: Preparando a camada (layer) com a biblioteca pypdf..."

# Limpa o diretório de build anterior para garantir uma instalação limpa.
rm -rf $LAYER_BUILD_DIR
mkdir -p $LAYER_BUILD_DIR/python

# Instala a dependência no diretório preparado. A estrutura `python/` é
# exigida pelo AWS Lambda para que ele encontre as bibliotecas.

# NOTA SOBRE VERSÕES: Fixar a versão da dependência é uma
# boa prática para garantir builds reproduzíveis. Omitir a versão instalará a mais recente.
pip install --no-cache-dir "pypdf" -t $LAYER_BUILD_DIR/python > /dev/null

echo "   - Dependências Python instaladas."

# Compacta o conteúdo do diretório da camada.
(cd $LAYER_BUILD_DIR && zip -r ../$LAYER_ZIP_FILE .) > /dev/null
echo "   - Camada '$LAYER_ZIP_FILE' criada com sucesso."

# --- Passo 2: Preparação do Código da Função Lambda ---
echo "\n-> Passo 2 de 4: Empacotando o código da função Lambda..."

zip $LAMBDA_ZIP_FILE $LAMBDA_FUNCTION_FILE > /dev/null
echo "   - Código da função '$LAMBDA_ZIP_FILE' criado com sucesso."

# --- Passo 3: Upload para o S3 ---
echo "\n-> Passo 3 de 4: Fazendo upload dos artefatos para o S3..."

# Determina dinamicamente o nome do bucket de artefatos.
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region)
ARTIFACTS_BUCKET_NAME="adocs-pdf-merge-artifacts-$AWS_ACCOUNT_ID-$AWS_REGION"

echo "   - Nome do Bucket de Artefatos: $ARTIFACTS_BUCKET_NAME"

# Faz o upload dos arquivos para o S3, sobrescrevendo os existentes.
aws s3 cp $LAYER_ZIP_FILE s3://$ARTIFACTS_BUCKET_NAME/
aws s3 cp $LAMBDA_ZIP_FILE s3://$ARTIFACTS_BUCKET_NAME/
echo "   - Upload de '$LAYER_ZIP_FILE' e '$LAMBDA_ZIP_FILE' concluído."

# --- Passo 4: Limpeza ---
echo "\n-> Passo 4 de 4: Limpando arquivos e diretórios temporários..."
rm -rf $LAYER_BUILD_DIR
rm $LAYER_ZIP_FILE
rm $LAMBDA_ZIP_FILE
echo "   - Limpeza concluída."

echo "\n✅ Processo finalizado! Os artefatos estão no S3 e prontos para o deploy do backend."
