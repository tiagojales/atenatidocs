# AtenaDocs: Technical Documentation

## 1. Project Overview

AtenaDocs is a web application designed for merging multiple PDF files into a single document. It consists of a Next.js frontend and a separate serverless Python backend running on AWS Lambda.

## 2. Architecture

-   **Frontend**: A Next.js application, hosted on AWS Amplify with a full CI/CD pipeline triggered by Git pushes.
-   **Backend**: A Python function running on AWS Lambda, exposed via AWS API Gateway. It handles S3 URL generation and the core PDF merging logic.
-   **Storage**: The architecture uses two S3 buckets:
    1.  `atenadocs-artifacts-...` bucket: Stores the packaged backend code and dependencies for deployment.
    2.  `atenadocs-pdf-merge-...` bucket: Stores user-uploaded and merged PDF files.

This project uses a unified CloudFormation stack (`IaC/deploy-template.yaml`) to deploy all resources for both the backend and the frontend CI/CD pipeline.

## 3. One-Time Setup

### Step 1: Install Prerequisites

Before you begin, ensure you have the following installed and configured:
-   **AWS CLI**: [Installation Guide](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html)
-   **A Configured AWS Profile**: Run `aws configure` to set up your credentials and default region.
-   **Python & Pip**: For managing backend dependencies.
-   **Node.js & npm**: For running the frontend.

### Step 2: Deploy the Bootstrap Stack (Run Once)

This stack creates the S3 bucket (`atenadocs-artifacts-...`) that will hold your backend deployment packages. This only needs to be done once per AWS account/region.

1.  Navigate to the AWS CloudFormation Console.
2.  Create a new stack using the `IaC/pre-deploy-template.yaml` file.
3.  Name the stack (e.g., `atenadocs-bootstrap`) and complete the creation process. The bucket name is standardized, so there is no need to copy any outputs.

### Step 3: Create a GitHub Personal Access Token (PAT)

AWS Amplify needs permission to access your GitHub repository to set up the CI/CD pipeline.

1.  Go to your GitHub **Settings** > **Developer settings** > **Personal access tokens** > **Tokens (classic)**.
2.  Click **Generate new token (classic)**.
3.  Give it a name (e.g., `atenadocs-amplify-token`) and set the **Expiration**.
4.  Under **Select scopes**, check the `repo` scope.
5.  Click **Generate token** and **immediately copy the token**. You will need it for the main deployment.

## 4. Main Application Deployment

This is a two-step process to deploy the backend and frontend.

### Step 1: Package and Upload the Backend Artifacts

Instead of manually packaging files, you will use the provided automation script.

1.  Open your terminal in the project root.
2.  **Make the script executable** (you only need to do this once):
    ```bash
    chmod +x IaC/pre-deploy-backend.sh
    ```
3.  **Run the script**:
    ```bash
    ./IaC/pre-deploy-backend.sh
    ```
    This script automatically packages the Lambda function and its dependencies, then uploads them to the correct S3 artifacts bucket.

### Step 2: Deploy the Main CloudFormation Stack

This stack creates the Lambda function, API Gateway, S3 bucket for PDFs, and the Amplify CI/CD pipeline for the frontend.

1.  Navigate to the AWS CloudFormation Console and create a new stack.
2.  Choose to upload the `IaC/deploy-template.yaml` file.
3.  On the "Specify stack details" page, provide the following parameters:

    *   **`EnvironmentName`**: Set to `development` for your dev branch or `production` for your main branch.
    *   **`RepositoryUrl`**: The full URL of your GitHub repository (e.g., `https://github.com/your-username/atenadocs`).
    *   **`AccessToken`**: The GitHub Personal Access Token you created earlier.
    *   **`BranchName`**: The Git branch Amplify should deploy from (e.g., `dev` or `main`).

4.  Proceed through the steps, acknowledge the IAM capabilities, and create the stack. This will take several minutes.
5.  Once complete, go to the stack's "Outputs" tab. You will find the **`AmplifyAppUrl`**, which is the public URL for your web application.

## 5. CI/CD and Ongoing Development

With the stack deployed, your CI/CD pipeline is active.
-   To deploy **frontend** changes, simply **push your code** to the configured Git branch.
-   To deploy **backend** changes, first run `./IaC/pre-deploy-backend.sh` and then push your code.

## 6. Local Development

1.  **Install Dependencies**: `npm install`
2.  **Run Frontend Dev Server**: `npm run dev`
    *   The frontend will be at `http://localhost:9002`. For it to work, create a `.env.local` file in the project root and add `NEXT_PUBLIC_API_URL` pointing to your deployed backend API Gateway. Get this URL from the `ApiGatewayEndpoint` output of your main CloudFormation stack.
    ```
    NEXT_PUBLIC_API_URL="your_api_gateway_endpoint_url"
    ```
