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

# Configuração do cliente S3 para usar a versão de assinatura v4, essencial para URLs pré-assinadas.
s3_client = boto3.client(
    's3',
    region_name=AWS_REGION_NAME,
    config=Config(signature_version='s3v4')
)

S3_UPLOADS_PREFIX = "uploads/"
S3_MERGED_PREFIX = "merged/"

MAX_FILES_FOR_UPLOAD = 50
# O frontend valida o tamanho TOTAL. O backend impõe um limite POR ARQUIVO como uma salvaguarda.
# Vamos definir um limite generoso por arquivo, por ex. 50MB. O limite total do frontend atuará primeiro.
MAX_SINGLE_FILE_SIZE_MB = 50
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
    """Remove caracteres potencialmente problemáticos dos nomes de arquivo."""
    return re.sub(r'[^a-zA-Z0-9_.-]', '', filename)

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

    # CORREÇÃO 1: Gera um único ID de transação para todo o lote de arquivos.
    # Isso garante que todos os arquivos de uma mesma operação de merge fiquem na mesma "pasta" do S3.
    transaction_id = str(uuid.uuid4())
    response_parts = []

    for file_name in file_names:
        sanitized_filename = sanitize_filename(file_name)
        # O caminho no S3 agora usa o transaction_id compartilhado.
        key = f"{S3_UPLOADS_PREFIX}{transaction_id}/{sanitized_filename}"

        # A política do S3 agora inclui o campo 'Content-Type' explicitamente.
        # O frontend DEVE fornecer este campo no FormData para que o upload seja aceito.
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
            ExpiresIn=3600  # 1 hora
        )
        response_parts.append({
            'originalFileName': file_name,
            # CORREÇÃO 2: Retornamos a chave (key) do objeto explicitamente.
            # O frontend usará isso para rastrear os arquivos e solicitar o merge final.
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

    if len(file_keys) < 1: # Permitir "merge" de um único arquivo (efetivamente, uma cópia)
        return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Pelo menos um arquivo é necessário.'})}

    # Validação de segurança: Garante que estamos acessando apenas a pasta de uploads.
    for key in file_keys:
        if not key.startswith(S3_UPLOADS_PREFIX):
            return {'statusCode': 403, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'Acesso negado: Chave de arquivo inválida.'})}

    merger = PdfWriter()
    
    try:
        # Itera sobre as chaves na ordem exata fornecida pelo cliente.
        for key in file_keys:
            s3_object = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=key)
            pdf_stream = BytesIO(s3_object['Body'].read())
            
            # Usar PdfReader para maior compatibilidade
            reader = PdfReader(pdf_stream)
            for page in reader.pages:
                merger.add_page(page)

        # Salva o resultado em um buffer na memória.
        merged_stream = BytesIO()
        merger.write(merged_stream)
        merged_stream.seek(0) # Retorna ao início do buffer para o upload.

        merged_key = f"{S3_MERGED_PREFIX}{uuid.uuid4()}.pdf"
        
        s3_client.put_object(
            Body=merged_stream,
            Bucket=S3_BUCKET_NAME,
            Key=merged_key,
            ContentType='application/pdf'
        )

        # Gera a URL de download para o arquivo final.
        download_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': S3_BUCKET_NAME, 'Key': merged_key},
            ExpiresIn=3600
        )

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'message': 'PDFs juntados com sucesso!', 'downloadUrl': download_url})
        }

    finally:
        merger.close()
        # Limpeza: Deleta os arquivos originais da pasta de uploads após o merge.
        if file_keys:
            s3_client.delete_objects(
                Bucket=S3_BUCKET_NAME,
                Delete={'Objects': [{'Key': key} for key in file_keys]}
            )

# =============================================================================
# Handler Principal
# =============================================================================

def lambda_handler(event, context):
    """Ponto de entrada principal e roteador."""
    # Tratamento da requisição pre-flight (CORS)
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }

    # Validação da configuração do ambiente
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
