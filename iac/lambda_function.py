# -*- coding: utf-8 -*-

"""
Função AWS Lambda principal para o serviço de merge de PDF do AtenaDocs.

# ... (descrição omitida)
"""

import json
import os
import uuid
import boto3
import traceback
import re
from io import BytesIO
from pypdf import PdfWriter
from botocore.config import Config

# =============================================================================
# Constantes e Configuração Inicial
# =============================================================================

# Lê as variáveis de ambiente injetadas pelo CloudFormation.
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')
ENVIRONMENT_NAME = os.environ.get('ENVIRONMENT_NAME', 'dev')
AWS_REGION_NAME = os.environ.get('AWS_REGION_NAME') # Região da AWS.

# CORREÇÃO: Inicializa o cliente Boto3 para o S3 especificando a região.
# Isso garante que as URLs pré-assinadas sejam geradas para o endpoint regional
# do bucket (ex: s3.sa-east-1.amazonaws.com), o que é essencial para que
# a política de CORS seja aplicada corretamente pelo navegador.
s3_client = boto3.client(
    's3',
    region_name=AWS_REGION_NAME,
    config=Config(signature_version='s3v4') # Força o uso da versão 4 de assinaturas.
)


S3_UPLOADS_PREFIX = "uploads/"
S3_MERGED_PREFIX = "merged/"

MAX_FILES_FOR_UPLOAD = 50
MAX_FILE_SIZE_MB = 100
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

# Cabeçalhos CORS para todas as respostas. Como o API Gateway agora lida com OPTIONS,
# só precisamos destes para as respostas de POST.
CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*', # Em produção, restrinja para o seu domínio.
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

# =============================================================================
# Funções Auxiliares
# =============================================================================

def sanitize_filename(filename):
    """
    Remove caracteres potencialmente perigosos de um nome de arquivo.
    """
    return re.sub(r'[^a-zA-Z0-9_.-]', '', filename)

# =============================================================================
# Endpoint: /upload
# =============================================================================

def generate_presigned_urls(event):
    """
    Gera URLs S3 pré-assinadas para upload de arquivos.
    """
    body = json.loads(event.get('body', '{}'))
    file_names = body.get('fileNames', [])

    if not 1 <= len(file_names) <= MAX_FILES_FOR_UPLOAD:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f"O campo 'fileNames' deve ser uma lista contendo de 1 a {MAX_FILES_FOR_UPLOAD} nomes de arquivo."})
        }

    response_parts = []
    for file_name in file_names:
        sanitized_filename = sanitize_filename(file_name)
        key = f"{S3_UPLOADS_PREFIX}{uuid.uuid4()}/{sanitized_filename}"

        presigned_post = s3_client.generate_presigned_post(
            Bucket=S3_BUCKET_NAME,
            Key=key,
            Fields={"Content-Type": "application/pdf"},
            Conditions=[
                {"Content-Type": "application/pdf"},
                ["content-length-range", 1, MAX_FILE_SIZE_BYTES]
            ],
            ExpiresIn=3600
        )
        response_parts.append({
            'originalFileName': file_name,
            'post_details': presigned_post
        })

    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': json.dumps({'uploads': response_parts})
    }

# =============================================================================
# Endpoint: /merge
# =============================================================================

def merge_pdfs(event):
    """
    Junta múltiplos arquivos PDF em um só.
    """
    body = json.loads(event.get('body', '{}'))
    file_keys = body.get('fileKeys', [])

    if len(file_keys) < 2:
        return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'São necessários pelo menos dois arquivos para a junção.'})}

    for key in file_keys:
        if not key.startswith(S3_UPLOADS_PREFIX):
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Acesso negado: Chave de arquivo inválida.'})}

    merger = PdfWriter()
    merged_temp_path = f"/tmp/merged-{uuid.uuid4()}.pdf"

    try:
        for key in file_keys:
            s3_object = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=key)
            pdf_stream = BytesIO(s3_object['Body'].read())
            merger.append(pdf_stream)

        merger.write(merged_temp_path)

        merged_key = f"{S3_MERGED_PREFIX}{uuid.uuid4()}.pdf"
        s3_client.upload_file(merged_temp_path, S3_BUCKET_NAME, merged_key)

        download_filename = f"atenadocs-merged-{uuid.uuid4().hex[:8]}.pdf"
        download_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': S3_BUCKET_NAME,
                'Key': merged_key,
                'ResponseContentDisposition': f'attachment; filename="{download_filename}"'
            },
            ExpiresIn=3600
        )

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'message': 'PDFs juntados com sucesso!', 'downloadUrl': download_url})
        }

    finally:
        if os.path.exists(merged_temp_path):
            os.remove(merged_temp_path)
        if file_keys:
            s3_client.delete_objects(
                Bucket=S3_BUCKET_NAME,
                Delete={'Objects': [{'Key': key} for key in file_keys]}
            )
        merger.close()

# =============================================================================
# Handler Principal (Ponto de Entrada da Lambda)
# =============================================================================

def lambda_handler(event, context):
    """
    Ponto de entrada principal para todas as invocações da API Gateway.
    """
    # Validação de configuração crítica.
    if not all([S3_BUCKET_NAME, AWS_REGION_NAME]):
        error_msg = 'Configuração do servidor incompleta: S3_BUCKET_NAME ou AWS_REGION_NAME não definidos.'
        print(f"CRITICAL ERROR: {error_msg}")
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': error_msg})}

    api_path = event.get('path', '')
    try:
        if api_path.endswith('/upload'):
            return generate_presigned_urls(event)
        elif api_path.endswith('/merge'):
            return merge_pdfs(event)
        else:
            return {
                'statusCode': 404,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': 'Endpoint não encontrado.'})
            }
    except Exception as e:
        print(f"ERROR: Exceção inesperada ao processar requisição para o path '{api_path}'.")
        traceback.print_exc()

        is_production = (ENVIRONMENT_NAME.lower() == 'production')
        error_message = 'Ocorreu um erro interno no servidor.' if is_production else str(e)

        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': error_message})
        }
