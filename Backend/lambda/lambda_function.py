# -*- coding: utf-8 -*-
"""
Função AWS Lambda principal para o serviço de merge de PDF do AtenaDocs.
"""

import json
import os
import uuid
import boto3
import traceback
import re
from io import BytesIO
from pypdf import PdfWriter, PdfReader
from botocore.config import Config

# =============================================================================
# Constantes e Configuração Inicial
# =============================================================================

S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')
ENVIRONMENT_NAME = os.environ.get('ENVIRONMENT_NAME', 'dev')
AWS_REGION_NAME = os.environ.get('AWS_REGION_NAME')

s3_client = boto3.client(
    's3',
    region_name=AWS_REGION_NAME,
    config=Config(signature_version='s3v4')
)

S3_UPLOADS_PREFIX = "uploads/"
S3_MERGED_PREFIX = "merged/"

MAX_FILES_FOR_UPLOAD = 50
MAX_SINGLE_FILE_SIZE_MB = 100
MAX_SINGLE_FILE_SIZE_BYTES = MAX_SINGLE_FILE_SIZE_MB * 1024 * 1024

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

# =============================================================================
# Funções Auxiliares
# =============================================================================

def sanitize_filename(filename):
    """
    Sanitiza um nome de arquivo usando uma abordagem de "lista branca" com expressões regulares.
    """
    if not filename:
        return ""
    safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', filename)
    safe_name = safe_name.lstrip('.')
    if not safe_name:
        _root, extension = os.path.splitext(filename)
        safe_extension = re.sub(r'[^a-zA-Z0-9.]', '_', extension)
        return f"{uuid.uuid4()}{safe_extension}"
    return safe_name

# =============================================================================
# Endpoint: /upload
# =============================================================================

def generate_presigned_urls(event):
    """
    Gera URLs de POST pré-assinadas para um lote de arquivos.
    """
    body = json.loads(event.get('body', '{}'))
    file_names = body.get('fileNames', [])

    if not 1 <= len(file_names) <= MAX_FILES_FOR_UPLOAD:
        return {
            'statusCode': 400,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f"O campo 'fileNames' deve ser uma lista contendo de 1 a {MAX_FILES_FOR_UPLOAD} nomes de arquivo."})
        }

    transaction_id = str(uuid.uuid4())
    response_parts = []

    for file_name in file_names:
        sanitized_filename = sanitize_filename(file_name)
        key = f"{S3_UPLOADS_PREFIX}{transaction_id}/{sanitized_filename}"

        fields = {"Content-Type": "application/pdf"}
        conditions = [
            fields,
            ["content-length-range", 1, MAX_SINGLE_FILE_SIZE_BYTES]
        ]

        presigned_post = s3_client.generate_presigned_post(
            Bucket=S3_BUCKET_NAME,
            Key=key,
            Fields=fields,
            Conditions=conditions,
            ExpiresIn=3600
        )
        response_parts.append({
            'originalFileName': file_name,
            'key': key,
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
    Junta os arquivos PDF especificados e retorna uma URL de download.
    """
    body = json.loads(event.get('body', '{}'))
    file_keys = body.get('fileKeys', [])

    if len(file_keys) < 1:
        return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Pelo menos um arquivo é necessário.'})}

    for key in file_keys:
        if not key.startswith(S3_UPLOADS_PREFIX):
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Acesso negado: Chave de arquivo inválida.'})}

    merger = PdfWriter()
    
    try:
        # Passo 1: Juntar todos os PDFs em memória
        for key in file_keys:
            s3_object = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=key)
            pdf_stream = BytesIO(s3_object['Body'].read())
            reader = PdfReader(pdf_stream)
            merger.append(reader) # Método mais robusto para juntar PDFs

        # Passo 2: Escrever o resultado mesclado para um stream em memória
        merged_stream = BytesIO()
        merger.write(merged_stream)
        merged_stream.seek(0)

        # Passo 3: Fazer o upload do PDF mesclado para o S3
        merged_key = f"{S3_MERGED_PREFIX}{uuid.uuid4()}.pdf"
        
        s3_client.put_object(
            Body=merged_stream,
            Bucket=S3_BUCKET_NAME,
            Key=merged_key,
            ContentType='application/pdf'
        )

        # Passo 4: Gerar a URL de download pré-assinada
        download_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': S3_BUCKET_NAME, 'Key': merged_key},
            ExpiresIn=3600
        )

        # Passo 5: Excluir os arquivos originais APENAS APÓS o sucesso
        s3_client.delete_objects(
            Bucket=S3_BUCKET_NAME,
            Delete={'Objects': [{'Key': key} for key in file_keys]}
        )

        # Passo 6: Retornar a resposta de sucesso
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'message': 'PDFs juntados com sucesso!', 'downloadUrl': download_url})
        }

    finally:
        # O bloco 'finally' garante que o escritor de PDF seja fechado para liberar recursos,
        # independentemente de ter ocorrido um erro ou não.
        merger.close()

# =============================================================================
# Handler Principal
# =============================================================================

def lambda_handler(event, context):
    """Ponto de entrada principal e roteador."""
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }

    if not all([S3_BUCKET_NAME, AWS_REGION_NAME]):
        error_msg = 'Configuração do servidor incompleta: Variáveis de ambiente não definidas.'
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
