#!/usr/bin/env python3

"""
Script de Teste de Integração para o serviço de merge de PDF do AtenaDocs.

Este script simula o workflow completo de um cliente (frontend) interagindo
com a API, executando as seguintes etapas em ordem:

1.  Criação de Arquivos de Teste: Gera dois pequenos arquivos PDF válidos localmente.
1.5.Simulação de CORS: Envia uma requisição OPTIONS para simular a verificação
    de "pre-flight" que um navegador executa antes da chamada real à API.
2.  Solicitação de Upload: Chama o endpoint `/upload` da API para obter URLs
    S3 pré-assinadas (Presigned POST URLs).
3.  Upload para o S3: Usa as URLs recebidas para fazer o upload dos arquivos PDF
    diretamente para o S3, sem passar pela Lambda.
4.  Solicitação de Merge: Chama o endpoint `/merge` com as chaves dos arquivos
    que acabaram de ser enviados para o S3.
5.  Download do Resultado: Pega a URL de download pré-assinada (Presigned GET URL)
    retornada pela API e baixa o arquivo PDF final.
6.  Limpeza: Remove todos os arquivos PDF criados localmente durante o teste.
"""

import requests
import os
import json

# ===================================================================
# Configuração
# ===================================================================
# ATENÇÃO: Cole aqui a URL de saída do seu deploy do CloudFormation.
# Exemplo: "https://xxxxxxxxx.execute-api.sa-east-1.amazonaws.com/dev"
API_GATEWAY_BASE_URL = "https://8qy654gonb.execute-api.sa-east-1.amazonaws.com/dev"
# ===================================================================

# Conteúdo binário de um PDF de uma página em branco. Este é um PDF válido
# e minimalista, perfeito para testes, pois é pequeno e rápido de processar.
PDF_CONTENT = b'''
%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
trailer
<< /Size 4 /Root 1 0 R >>
startxref
150
%%EOF
'''


def main():
    """Função principal que orquestra o fluxo de teste."""
    print_header("Script de Teste do Backend AtenaDocs")
    file_names = ["documento_A.pdf", "documento_B.pdf"]

    if not API_GATEWAY_BASE_URL or "amazonaws.com" not in API_GATEWAY_BASE_URL:
        print_error("A variável API_GATEWAY_BASE_URL no topo do script está vazia ou é inválida. Cole a URL de saída do seu deploy.")
        return

    try:
        # Etapa 1: Criar arquivos PDF de teste
        print_step(1, "Criando arquivos PDF locais para o teste...")
        create_test_files(file_names)

        # Etapa 1.5: Simular a verificação CORS (pre-flight) do navegador
        print_step("1.5", "Simulando verificação CORS (pre-flight) do navegador para o endpoint /upload...")
        simulate_cors_preflight(API_GATEWAY_BASE_URL, "/upload")
        print_success("Verificação CORS (pre-flight) para /upload bem-sucedida.")

        # Etapa 2: Obter URLs pré-assinadas da API
        print_step(2, "Solicitando URLs pré-assinadas para upload direto ao S3...")
        presigned_data = get_presigned_urls(file_names)
        print_success("Detalhes de upload recebidos da API com sucesso.")

        # Etapa 3: Fazer upload dos arquivos para o S3
        print_step(3, "Fazendo upload dos arquivos diretamente para o S3...")
        s3_keys = upload_files_to_s3(presigned_data, file_names)
        print_success(f"Chaves S3 dos arquivos enviados: {s3_keys}")

        # Etapa 4: Solicitar a junção dos PDFs
        print_step(4, "Solicitando a junção dos PDFs à API...")
        download_url = request_pdf_merge(s3_keys)
        print_success("PDFs juntados com sucesso! URL para download:")
        print(download_url)

        # Etapa 5: Fazer o download do arquivo final
        print_step(5, "Fazendo o download do arquivo final...")
        download_merged_file(download_url)

        print("\n✅ Workflow de integração concluído com sucesso!")

    except APIError as e:
        print_error(f"A comunicação com a API falhou. Causa: {e}")
        if e.details:
            print(f"Detalhes do erro da API: {e.details}")
    except Exception as e:
        print_error(f"Um erro inesperado ocorreu: {e}")
    finally:
        # Etapa 6: Limpar arquivos de teste
        print_step(6, "Limpando arquivos locais...")
        cleanup_files(file_names)


def create_test_files(file_names):
    """Cria arquivos PDF locais com o conteúdo de teste."""
    for name in file_names:
        with open(name, "wb") as f: # Abre em modo de escrita de bytes
            f.write(PDF_CONTENT)
        print_success(f"Criado '{name}'", _sub=True)


def simulate_cors_preflight(base_url, endpoint):
    """
    Simula a requisição OPTIONS (pre-flight) que um navegador faria para
    verificar as permissões de CORS antes de enviar a requisição principal.
    """
    url = f"{base_url}{endpoint}"
    # Cabeçalhos que um navegador normalmente envia para uma requisição pre-flight
    headers = {
        'Origin': 'http://localhost:3000', # Simula a origem do frontend de desenvolvimento
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
    }
    print(f"   - Enviando OPTIONS para: {url}")
    print(f"   - Com cabeçalhos: {headers}")
    response = requests.options(url, headers=headers)

    print(f"   - Resposta da verificação CORS: Status={response.status_code}")
    print(f"   - Cabeçalhos da resposta: {response.headers}")

    # Verifica se a resposta foi bem-sucedida e contém os cabeçalhos CORS esperados
    if response.status_code != 200:
        raise APIError(f"Falha na verificação CORS (pre-flight). Status: {response.status_code}", details=response.text)

    if 'Access-Control-Allow-Origin' not in response.headers:
        raise APIError("Falha na verificação CORS (pre-flight): O cabeçalho 'Access-Control-Allow-Origin' está ausente na resposta.")


def get_presigned_urls(file_names):
    """Chama o endpoint /upload para obter URLs pré-assinadas."""
    url = f"{API_GATEWAY_BASE_URL}/upload"
    # O frontend envia um cabeçalho de Origin, então vamos simulá-lo aqui também.
    headers = {'Origin': 'http://localhost:3000'}
    response = requests.post(url, json={"fileNames": file_names}, headers=headers)
    return handle_api_response(response)['uploads']


def upload_files_to_s3(presigned_data, file_names):
    """Usa as URLs pré-assinadas para enviar os arquivos ao S3."""
    s3_keys = []
    for i, data in enumerate(presigned_data):
        file_path = file_names[i]
        post_details = data['post_details']
        with open(file_path, 'rb') as f:
            files = {'file': (file_path, f, 'application/pdf')}
            # O POST para o S3 usa os campos retornados pela API
            response = requests.post(post_details['url'], data=post_details['fields'], files=files)
            if response.status_code != 204: # S3 retorna 204 No Content em sucesso de upload
                raise Exception(f"Falha no upload de '{file_path}'. Status: {response.status_code}. Detalhes: {response.text}")
            print_success(f"Upload de '{file_path}' para o S3 bem-sucedido.", _sub=True)
            s3_keys.append(post_details['fields']['key'])
    return s3_keys


def request_pdf_merge(s3_keys):
    """Chama o endpoint /merge para solicitar a junção dos PDFs."""
    url = f"{API_GATEWAY_BASE_URL}/merge"
    headers = {'Origin': 'http://localhost:3000'}
    response = requests.post(url, json={"fileKeys": s3_keys}, headers=headers)
    return handle_api_response(response)['downloadUrl']


def download_merged_file(url, filename="resultado_final.pdf"):
    """Baixa o arquivo final a partir da URL de download."""
    response = requests.get(url)
    response.raise_for_status() # Lança exceção para status de erro (4xx ou 5xx)
    with open(filename, 'wb') as f:
        f.write(response.content)
    print_success(f"Arquivo final salvo como '{filename}'")


def cleanup_files(file_names):
    """Remove os arquivos PDF locais criados durante o teste."""
    files_to_clean = file_names + ["resultado_final.pdf"]
    for name in files_to_clean:
        if os.path.exists(name):
            os.remove(name)
            print_success(f"Removido '{name}'", _sub=True)


# --- Funções Utilitárias ---

class APIError(Exception):
    """Exceção customizada para erros de API."""
    def __init__(self, message, details=None):
        super().__init__(message)
        self.details = details


def handle_api_response(response):
    """Centraliza o tratamento de respostas HTTP da nossa API."""
    try:
        response.raise_for_status() # Lança HTTPError para respostas 4xx/5xx
        return response.json()
    except requests.exceptions.HTTPError as e:
        # Tenta extrair uma mensagem de erro JSON da API, senão usa o texto puro.
        try:
            details = response.json()
        except json.JSONDecodeError:
            details = response.text
        raise APIError(str(e), details)
    except json.JSONDecodeError:
        raise APIError(f"A resposta da API não é um JSON válido. Conteúdo: {response.text}")


def print_header(title):
    bar = "=" * (len(title) + 2)
    print(f"\n{bar}\n {title} \n{bar}\n")

def print_step(step, message):
    print(f"\n-> Passo {step}: {message}")


def print_success(message, _sub=False):
    prefix = "   - " if _sub else ""
    print(f"{prefix}✅ {message}")

def print_error(message):
    print(f"\n❌ ERRO: {message}")


if __name__ == "__main__":
    main()