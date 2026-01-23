# Backend para o Projeto AtenaDocs

Este diretório contém todos os recursos de backend para o projeto AtenaDocs, utilizando AWS CloudFormation para a infraestrutura.

## Estrutura de Arquivos

-   **`api/`**: Contém os artefatos da aplicação, como o código-fonte da função Lambda (`lambda_function.py`), as definições de dependências (`requirements.txt`) e os scripts de empacotamento (`artifacts-setup.sh`).
-   **`adocs-artifacts.yaml`**: Template do CloudFormation para o bucket S3 que armazena os artefatos de build (código da Lambda e layers).
-   **`adocs-backend.yaml`**: Template principal do CloudFormation que define todos os recursos da aplicação (API Gateway, Função Lambda, Bucket S3 para os PDFs, políticas do IAM, etc.).
-   **`README.md`**: Esta documentação.

## Visão Geral da Arquitetura

A arquitetura é baseada em serviços Serverless da AWS para fornecer uma solução escalável, resiliente e com custo-benefício para a manipulação de PDFs.

![Diagrama da Arquitetura](./AtenaDocs-Architecture.png)

### Componentes Principais

1.  **Amazon S3 (Simple Storage Service)**
    -   **Bucket de Artefatos (`adocs-artifacts-<env>`):** Armazena os pacotes de código da função Lambda e suas dependências (layers). Este bucket é usado durante o processo de deploy.
    -   **Bucket de Dados (`adocs-data-<env>`):** Armazena os arquivos PDF enviados pelos usuários (`uploads/`) e os arquivos PDF combinados (`merged/`). É configurado para ser privado e acessado apenas através de URLs pré-assinadas.

2.  **AWS Lambda (`adocs-pdf-merger-function-<env>`)**
    -   É o cérebro da aplicação. Uma única função Python que expõe dois endpoints através do API Gateway:
        -   `POST /upload`: Recebe uma lista de nomes de arquivos e gera URLs de upload pré-assinadas para o S3. Isso permite que o cliente (navegador) envie os arquivos diretamente para o S3 de forma segura, sem sobrecarregar a função Lambda.
        -   `POST /merge`: Recebe uma lista de chaves de arquivos (previamente enviados para `uploads/`), combina-os usando a biblioteca `pypdf`, salva o resultado na pasta `merged/` e retorna uma URL de download pré-assinada para o arquivo final.

3.  **Amazon API Gateway**
    -   Fornece um endpoint HTTP público e seguro que serve como a porta de entrada para a função Lambda. Ele é responsável por rotear as requisições para a Lambda e lidar com CORS (Cross-Origin Resource Sharing).

4.  **AWS IAM (Identity and Access Management)**
    -   Define as permissões para garantir que cada componente (Lambda, API Gateway) tenha apenas o acesso estritamente necessário aos outros recursos (como o bucket S3), seguindo o princípio do menor privilégio.

5.  **AWS CloudFormation**
    -   Gerencia toda a infraestrutura como código. Os templates YAML descrevem todos os recursos da AWS necessários, permitindo que a infraestrutura seja versionada, replicada e gerenciada de forma consistente e automatizada.

## Fluxo de Execução

1.  O frontend (aplicação Next.js) faz uma requisição `POST /upload` para o API Gateway com os nomes dos arquivos PDF que o usuário selecionou.
2.  O API Gateway invoca a função Lambda.
3.  A Lambda gera URLs de POST pré-assinadas para cada arquivo, apontando para o bucket `adocs-data-<env>/uploads/`, e as retorna para o frontend.
4.  O frontend usa essas URLs para fazer o upload dos arquivos diretamente para o S3, exibindo uma barra de progresso para cada um.
5.  Uma vez que todos os uploads estão completos, o frontend faz uma requisição `POST /merge` para o API Gateway, enviando as chaves dos arquivos que acabaram de ser enviados.
6.  O API Gateway invoca a função Lambda novamente.
7.  A Lambda baixa os arquivos especificados do S3, os combina em um único PDF na memória, faz o upload do arquivo combinado para a pasta `merged/` do bucket e deleta os arquivos originais da pasta `uploads/`.
8.  A Lambda gera uma URL de download pré-assinada para o novo arquivo e a retorna para o frontend.
9.  O frontend recebe a URL e a usa para baixar o PDF combinado para o computador do usuário.

## Deploy

O deploy é um processo de dois passos, orquestrado via CloudFormation.

### Passo 1: Deploy do Bucket de Artefatos

Este bucket só precisa ser criado uma vez por ambiente. Ele armazenará o código que será executado no Passo 2.

```bash
aws cloudformation deploy \
    --template-file adocs-artifacts.yaml \
    --stack-name adocs-artifacts-stack-dev
```

### Passo 2: Empacotamento e Deploy da Aplicação

Este passo empacota o código da Lambda e suas dependências e, em seguida, implanta a stack principal da aplicação.

1.  **Navegue até a pasta da API:**

    ```bash
    cd api
    ```

2.  **Execute o script de empacotamento:**

    Este script irá:
    a.  Criar uma camada (layer) do Lambda com as dependências do `requirements.txt`.
    b.  Compactar o código da função Lambda.
    c.  Fazer o upload desses artefatos para o bucket S3 criado no Passo 1.

    ```bash
    ./artifacts-setup.sh adocs-artifacts-devlopment
    ```

3.  **Volte para o diretório raiz do backend e implante a stack principal:**

    ```bash
    cd ..
    aws cloudformation deploy \
        --template-file adocs-backend.yaml \
        --stack-name adocs-backend-stack-dev \
        --capabilities CAPABILITY_IAM \
        --parameter-overrides ArtifactsBucket=adocs-artifacts-devlopment
    ```

## Considerações de Segurança

-   **URLs Pré-Assinadas:** O serviço não expõe diretamente as credenciais da AWS. Em vez disso, gera URLs temporárias e com escopo limitado para permitir uploads e downloads, que é a prática recomendada pela AWS.
-   **Menor Privilégio (Least Privilege):** As políticas do IAM são estritamente definidas para conceder à função Lambda apenas as permissões necessárias para acessar o bucket S3 e escrever logs.
-   **Nenhum Acesso Público:** Os buckets S3 são configurados para bloquear todo o acesso público. Toda a interação é feita através de permissões IAM e URLs pré-assinadas.
-   **Sanitização de Inputs:** Nomes de arquivos enviados pelo cliente são sanitizados para prevenir ataques de *Path Traversal*.
-   **CORS:** A política CORS no ambiente de desenvolvimento é permissiva (`*`). **Para um ambiente de produção, ela DEVE ser restringida ao domínio exato do seu frontend** para evitar que sites não autorizados interajam com sua API.

## Limpeza

Para remover todos os recursos criados, delete as stacks do CloudFormation. É importante deletar a stack do backend primeiro.

**Atenção:** Antes de deletar a stack `adocs-backend-stack-dev`, você deve esvaziar manualmente o bucket S3 `adocs-data-development`. O CloudFormation não deleta buckets que contêm objetos.

```bash
# Delete a stack da aplicação
aws cloudformation delete-stack --stack-name adocs-backend-stack-dev

# Delete a stack de artefatos (após esvaziar o bucket manualmente)
aws cloudformation delete-stack --stack-name adocs-artifacts-stack-dev
```
