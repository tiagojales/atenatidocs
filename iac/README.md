# Serviço de Merge de PDF do AtenaDocs

Este projeto implementa um serviço de backend serverless na AWS para juntar múltiplos arquivos PDF em um único documento. A arquitetura é construída para ser escalável, segura e de baixo custo, utilizando o modelo de "pagamento por uso".

## Arquitetura

O serviço utiliza uma arquitetura serverless orientada a eventos, composta pelos seguintes serviços da AWS:

- **Amazon API Gateway:** Atua como o ponto de entrada (HTTP) para todas as requisições dos clientes. Ele expõe dois endpoints (`/upload` e `/merge`) e os roteia para a função Lambda.

- **AWS Lambda:** É o cérebro da aplicação. O código Python (`lambda_function.py`) executa a lógica de negócio, que inclui a geração de URLs para upload, a junção dos PDFs e a geração da URL de download.

- **Amazon S3 (Simple Storage Service):** É usado para armazenamento. Ele possui duas funções principais:
  1.  **Bucket de Armazenamento:** Recebe os uploads dos PDFs originais e armazena o PDF final resultante da junção. Os arquivos são acessados de forma segura através de URLs pré-assinadas.
  2.  **Bucket de Artefatos:** Armazena o código-fonte empacotado (`.zip`) da aplicação, que o CloudFormation usa durante o processo de deploy.

- **AWS CloudFormation:** Utilizado para provisionar e gerenciar toda a infraestrutura como código (IaC). Os templates `.yaml` descrevem todos os recursos da AWS necessários, garantindo deploys consistentes e reproduzíveis.

- **AWS IAM (Identity and Access Management):** Gerencia as permissões de forma segura, garantindo que cada componente (ex: Lambda) tenha apenas o acesso estritamente necessário para realizar suas tarefas (Princípio do Menor Privilégio).

---

## Ordem de Configuração e Deploy

A implantação da infraestrutura é dividida em etapas lógicas para garantir que as dependências sejam resolvidas corretamente. Siga a ordem abaixo.

### Pré-requisitos

- [AWS CLI](https://aws.amazon.com/cli/) instalado e configurado com credenciais de acesso.
- Python e `pip` instalados.
- `zip` instalado.

### Passo 1: Deploy do Bucket de Artefatos (Execução Única)

Este bucket armazena os artefatos de build. Ele só precisa ser criado uma vez por combinação de conta/região da AWS.

```bash
aws cloudformation deploy \
  --template-file backend-artifacts-template.yaml \
  --stack-name adocs-pdf-merge-artifacts-stack \
  --capabilities CAPABILITY_IAM
```

### Passo 2: Preparação e Upload dos Artefatos

Este script empacota o código da Lambda e suas dependências, e faz o upload para o bucket de artefatos criado no passo anterior.

```bash
bash backend-artifacts-setup.sh
```

### Passo 3: Deploy da Aplicação Principal

Com os artefatos no S3, este comando implanta a API Gateway, a Lambda, o bucket de armazenamento e todas as permissões necessárias.

```bash
aws cloudformation deploy \
  --template-file backend-dev-template.yaml \
  --stack-name adocs-pdf-merge-dev-stack \
  --capabilities CAPABILITY_IAM
```

### Passo 4: Teste de Integração

Após o deploy, a URL base da API será exibida nas saídas (Outputs) do CloudFormation. 

1.  Copie esta URL.
2.  Cole-a na variável `API_GATEWAY_BASE_URL` dentro do arquivo `test_script.py`.
3.  Execute o script para validar todo o fluxo da aplicação.

```bash
python3 test_script.py
```

---

## Documentação da API

A API possui dois endpoints públicos.

### 1. `POST /upload`

Este endpoint é usado para solicitar URLs seguras para fazer o upload de arquivos diretamente para o S3.

- **Input (Corpo da Requisição):**
  ```json
  {
    "fileNames": ["documento1.pdf", "contrato.pdf"]
  }
  ```

- **Output (Resposta de Sucesso `200 OK`):**
  ```json
  {
    "uploads": [
      {
        "originalFileName": "documento1.pdf",
        "post_details": {
          "url": "https://s3-bucket-url.com/",
          "fields": {
            "Content-Type": "application/pdf",
            "key": "uploads/uuid/documento1.pdf",
            "AWSAccessKeyId": "...",
            "policy": "...",
            "signature": "..."
          }
        }
      },
      { ... }
    ]
  }
  ```

### 2. `POST /merge`

Este endpoint inicia o processo de junção dos arquivos que já foram enviados para o S3.

- **Input (Corpo da Requisição):**
  ```json
  {
    "fileKeys": [
      "uploads/uuid/documento1.pdf",
      "uploads/uuid/contrato.pdf"
    ]
  }
  ```

- **Output (Resposta de Sucesso `200 OK`):**
  ```json
  {
    "message": "PDFs juntados com sucesso!",
    "downloadUrl": "https://s3.presigned-url.com/para/download/do/resultado.pdf?AWSAccessKeyId=..."
  }
  ```

---

## Ambientes: Desenvolvimento vs. Deploy

-   **Desenvolvimento:** O ciclo de desenvolvimento ocorre localmente. Você edita os arquivos de código (`lambda_function.py`) e de infraestrutura (`.yaml`) no seu ambiente. O `test_script.py` é a principal ferramenta para interagir com a infraestrutura já implantada na AWS e validar as alterações.

-   **Deploy:** O processo de deploy é a transição do código local para a infraestrutura na nuvem. Ele não é feito manualmente, mas sim de forma automatizada e declarativa através dos scripts (`backend-artifacts-setup.sh`) e templates do CloudFormation. Isso garante que cada deploy seja consistente e evita a "deriva de configuração" (diferenças manuais entre ambientes).

## Considerações de Segurança

-   **URLs Pré-Assinadas:** O serviço não expõe diretamente as credenciais da AWS. Em vez disso, gera URLs temporárias e com escopo limitado para permitir uploads e downloads, que é a prática recomendada pela AWS.
-   **Menor Privilégio (Least Privilege):** As políticas do IAM são estritamente definidas para conceder à função Lambda apenas as permissões necessárias para acessar o bucket S3 e escrever logs.
-   **Nenhum Acesso Público:** Os buckets S3 são configurados para bloquear todo o acesso público. Toda a interação é feita através de permissões IAM e URLs pré-assinadas.
-   **Sanitização de Inputs:** Nomes de arquivos enviados pelo cliente são sanitizados para prevenir ataques de *Path Traversal*.
-   **CORS:** A política CORS no ambiente de desenvolvimento é permissiva (`*`). **Para um ambiente de produção, ela DEVE ser restringida ao domínio exato do seu frontend** para evitar que sites não autorizados interajam com sua API.
