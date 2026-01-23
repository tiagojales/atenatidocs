# Infraestrutura como Código (IaC) para o Projeto AtenaDocs

Este diretório contém todos os recursos de Infraestrutura como Código (IaC) para o projeto AtenaDocs, utilizando AWS CloudFormation.

## Estrutura de Arquivos

-   `backend-artifacts-template.yaml`: Template CloudFormation para criar o bucket S3 que armazena os artefatos de build do backend (código Lambda e Layers).
-   `backend-dev-template.yaml`: Template CloudFormation para o ambiente de desenvolvimento do backend. Cria a função Lambda, API Gateway, Bucket S3 de armazenamento e todas as permissões (IAM) necessárias.
-   `frontend-dev-template.yaml`: Template CloudFormation para o ambiente de desenvolvimento do frontend. Cria a aplicação AWS Amplify e a configura para build e deploy contínuo a partir do GitHub.
-   `backend-artifacts-setup.sh`: Script de automação para preparar e fazer o upload dos artefatos do backend (código da função e dependências) para o bucket S3.
-   `lambda_function.py`: O código-fonte da função AWS Lambda que executa a lógica de merge dos PDFs.
-   `test_script.py`: Um script de teste de integração para validar o backend de ponta a ponta.
-   `README.md`: Este documento.

## Ordem de Deploy da Infraestrutura

A implantação da infraestrutura deve seguir uma ordem específica para garantir que as dependências entre os recursos sejam satisfeitas. Siga estritamente as etapas abaixo.

### Etapa 1: Criar o Repositório de Artefatos do Backend

**O quê?** Implanta o template que cria o bucket S3 para guardar o código da aplicação.

**Comando:**

```bash
aws cloudformation deploy \
  --template-file iac/backend-artifacts-template.yaml \
  --stack-name adocs-backend-artifacts-stack \
  --capabilities CAPABILITY_IAM
```

**Por quê?** Este bucket é um pré-requisito para a próxima etapa. Ele precisa existir para que você tenha um local para enviar o código da sua função Lambda.

### Etapa 2: Empacotar e Enviar o Código do Backend

**O quê?** Executa o script que prepara o código da Lambda e suas dependências, empacota em arquivos `.zip` e os envia para o bucket criado na Etapa 1.

**Comando:**

```bash
bash iac/backend-artifacts-setup.sh
```

**Por quê?** O template da aplicação backend (próxima etapa) precisa encontrar esses arquivos `.zip` no S3 para criar a função Lambda e sua camada de dependências.

### Etapa 3: Deploy da Aplicação Backend

**O quê?** Implanta o template principal do backend, que cria a função Lambda, o API Gateway, o bucket de armazenamento e as permissões.

**Comando:**

```bash
aws cloudformation deploy \
  --template-file iac/backend-dev-template.yaml \
  --stack-name adocs-backend-dev-stack \
  --capabilities CAPABILITY_IAM
```

**Por quê?** Esta etapa cria a API que o frontend irá consumir. Após sua conclusão, você terá a `ApiGatewayEndpoint` como saída, que é essencial para a próxima etapa.

### Etapa 4: Deploy da Aplicação Frontend

**O quê?** Implanta o template do frontend, que configura o AWS Amplify para se conectar ao seu repositório GitHub.

**Comando:**

```bash
# Primeiro, obtenha o URL da API do stack do backend
BACKEND_URL=$(aws cloudformation describe-stacks --stack-name adocs-backend-dev-stack --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayEndpoint'].OutputValue" --output text)

# Agora, faça o deploy do frontend com os parâmetros necessários
aws cloudformation deploy \
  --template-file iac/frontend-dev-template.yaml \
  --stack-name adocs-frontend-dev-stack \
  --parameter-overrides \
    BackendApiUrl=$BACKEND_URL \
    RepositoryUrl=<URL_HTTPS_DO_SEU_REPO_GITHUB> \
    GitHubOAuthToken=<SEU_TOKEN_PESSOAL_DO_GITHUB> \
  --capabilities CAPABILITY_IAM
```

**Por quê?** Isso prepara o ambiente no Amplify. Ele configura o pipeline de build, o deploy e injeta a URL do backend como uma variável de ambiente para a sua aplicação Next.js.

### Etapa 5: Iniciar o Build e Deploy do Frontend

**O quê?** Envia seu código mais recente para a branch `dev` do repositório no GitHub para acionar o pipeline do Amplify.

**Ação:**

```bash
git add .
git commit -m "Triggering Amplify build"
git push origin dev
```

**Por quê?** O `push` para a branch `dev` é o gatilho que o AWS Amplify espera. Ao receber essa notificação do GitHub, ele inicia automaticamente o pipeline de CI/CD: baixa o código, executa o build (`npm run build`) e, se bem-sucedido, publica o site no domínio público.

## Considerações de Segurança

-   **URLs Pré-Assinadas:** O serviço não expõe diretamente as credenciais da AWS. Em vez disso, gera URLs temporárias e com escopo limitado para permitir uploads e downloads, que é a prática recomendada pela AWS.
-   **Menor Privilégio (Least Privilege):** As políticas do IAM são estritamente definidas para conceder à função Lambda apenas as permissões necessárias para acessar o bucket S3 e escrever logs.
-   **Nenhum Acesso Público:** Os buckets S3 são configurados para bloquear todo o acesso público. Toda a interação é feita através de permissões IAM e URLs pré-assinadas.
-   **Sanitização de Inputs:** Nomes de arquivos enviados pelo cliente são sanitizados para prevenir ataques de *Path Traversal*.
-   **CORS:** A política CORS no ambiente de desenvolvimento é permissiva (`*`). **Para um ambiente de produção, ela DEVE ser restringida ao domínio exato do seu frontend** para evitar que sites não autorizados interajam com sua API.
