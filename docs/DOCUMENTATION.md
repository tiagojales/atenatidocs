# AtenaDocs: Technical Documentation

## 1. Project Overview

AtenaDocs is a web application designed for merging multiple PDF files into a single document. It provides a simple, drag-and-drop interface for users to upload, reorder, and merge PDFs efficiently. The architecture is built to handle large file uploads (up to 100MB total) by leveraging a serverless backend on AWS.

## 2. Architecture and Data Flow

The application uses a hybrid architecture where the frontend is a Next.js application and the backend is a serverless Python function on AWS Lambda. To handle large file uploads securely and efficiently without overloading the server, the system uses S3 pre-signed POST URLs.

### Infrastructure Diagram

```
+-----------+      +-------------------+      +---------------+      +----------------+      +----------+
|           |      | Next.js Server    |      | API Gateway   |      | AWS Lambda     |      |   AWS S3 |
|           |      | (Server Actions)  |      |               |      | (Python)       |      |   Bucket |
+-----------+      +-------------------+      +---------------+      +----------------+      +----------+
      |                      |                      |                      |                      |
 1. User selects PDF files
      |                      |                      |                      |                      |
      V                      |                      |                      |                      |
+-----------+                |                      |                      |                      |
| Browser   | -- 2. Request Upload URLs --------> | -- (forward) --------> | -- (invoke) --------> |
| (Client)  |                                      |                      |                      |
|           | <---------------- 4. Return URLs --- | <--- (response) ---- | <--- 3. Generate --- | <-- (s3:generatePresignedPost)
+-----------+                                      |                      |    Presigned URLs    |
      |                                            |                      |                      |
      |---- 5. Upload files directly to S3 ---------------------------------------------------->|
      |                                            |                      |                      |
      V                                            |                      |                      |
+-----------+                |                      |                      |                      |
| Browser   | -- 6. Request Merge --------------> | -- (forward) --------> | -- (invoke) --------> |
| (Client)  |                                      |                      |                      |
|           |                                      |                      | 7. Get files, merge, | <-- (s3:getObject)
|           |                                      |                      |    save merged file, | --> (s3:putObject)
|           |                                      |                      |    delete originals  | --> (s3:deleteObject)
|           |                                      |                      |                      |
|           | <---------------- 9. Return -------- | <--- (response) ---- | <--- 8. Generate --- | <-- (s3:generatePresignedUrl)
|           |     Download URL                     |                      |    Download URL      |
+-----------+                                      |                      |                      |
      |                                            |                      |                      |
      |---- 10. Download merged file from S3 -------------------------------------------------->|
      |                                            |                      |                      |
      V                                            |                      |                      |
   (Done)                                                                                      (Done)
```

### Flow Explained

1.  **File Selection**: The user drags and drops or selects PDF files in the browser.
2.  **Request Upload URLs**: The frontend calls a Next.js Server Action (`getUploadUrls`) with the names of the files. This is a backend-for-frontend (BFF) pattern that keeps the API endpoint secure.
3.  **Generate Pre-signed URLs**: The Server Action calls the API Gateway, which invokes the Lambda function. The Lambda function asks the AWS S3 service to create a unique, secure, temporary URL for *each file*.
4.  **Return URLs**: These pre-signed URLs are sent back to the browser.
5.  **Direct Upload**: The browser uses these URLs to upload each file directly to the S3 bucket. This architecture is highly efficient as it bypasses the API Gateway's 10MB payload limit and offloads bandwidth from the Lambda.
6.  **Request Merge**: Once all uploads are complete, the frontend calls another Server Action (`triggerPdfMerge`), sending the unique S3 keys (file paths) of the uploaded files in the desired order.
7.  **Merge & Clean**: The Lambda function downloads the specified files from S3, merges them in memory using `PyPDF2`, uploads the final merged PDF back to a different S3 path, and then deletes the original individual files.
8.  **Generate Download URL**: The Lambda function generates another pre-signed URL, this time a GET request for downloading the final merged file.
9.  **Return Download URL**: The download URL is sent back to the browser.
10. **Download**: The user clicks the "Download" button. The browser uses the provided URL to download the file directly from S3. Special headers on this URL force a "Save As" dialog instead of displaying the file.

## 3. Codebase Breakdown

### Frontend (Next.js - `src/`)

-   **`src/app/pdf/merge/page.tsx`**: The main application component for the merge tool.
    -   **State Management**: It manages the core application state, including the list of `files` selected by the user and the final `mergedPdfUrl`.
    -   **Conditional Rendering**: It decides whether to show the file upload interface or the final download screen based on whether `mergedPdfUrl` is set.
    -   **Event Handling**: It orchestrates the entire process by passing handler functions down to child components (e.g., `handleFilesSelected`, `handleMergeSuccess`).

-   **`src/components/adocs/FileUpload.tsx`**: The drag-and-drop zone and file selection component.
    -   **Responsibilities**: Handles all user interactions for selecting files, including drag-and-drop events and clicks to open the native file dialog.
    -   **`onFilesSelected`**: When files are selected, it passes them up to the parent `page.tsx` component for validation and state management.

-   **`src/components/adocs/FileList.tsx`**: Displays the list of selected files and manages the merge process.
    -   **Responsibilities**:
        -   Renders each file with its name, size, and a remove button.
        -   Implements drag-and-drop reordering of the file list.
        -   Manages the multi-step loading state (`isPreparing`, `isUploading`, `isMerging`).
        -   Displays individual file upload progress and overall progress.
    -   **`handleMergeClick()`**: This is the most critical function in the frontend. It orchestrates the entire multi-phase merge process by calling the Server Actions in the correct sequence.

-   **`src/lib/actions.ts`**: Next.js Server Actions.
    -   **Purpose**: Acts as a secure bridge between the frontend components and the backend AWS Lambda API. This is a best practice that prevents the API Gateway URL from being exposed directly in client-side code.
    -   **`getUploadUrls(files)`**: Takes file metadata and calls the Lambda to get pre-signed S3 POST URLs.
    -   **`triggerPdfMerge(fileKeys)`**: Takes the S3 keys of the uploaded files (in the user-defined order) and calls the Lambda to start the merge process.

### Backend (AWS Lambda - `backend/`)

-   **`backend/lambda_function.py`**: The core serverless backend logic. It acts as a router with a single entry point (`lambda_handler`).
    -   **`lambda_handler(event, context)`**: The main entry point. It inspects the request body to decide which function to call based on the presence of specific keys.
    -   **`handle_generate_urls(file_names)`**:
        -   Triggered when the request body contains the `'fileNames'` key.
        -   For each file name, it generates a unique S3 key (path).
        -   It calls `s3_client.generate_presigned_post()` to create a secure, temporary POST policy that allows the browser to upload a PDF of a specific size to that specific key.
    -   **`handle_merge_files(file_keys)`**:
        -   Triggered when the request body contains the `'fileKeys'` key.
        -   It iterates through the provided `fileKeys` in the user-specified order.
        -   For each key, it downloads the corresponding file from S3 into an in-memory buffer.
        -   It uses `PyPDF2.PdfMerger` to append each downloaded PDF.
        -   After merging, it uploads the final combined PDF to the `merged/` folder in S3.
        -   It generates a pre-signed GET URL for the merged file with a `ResponseContentDisposition` header. This is the crucial part that forces the browser to download the file rather than displaying it.
        -   Finally, its `finally` block ensures that the original uploaded files are deleted from the `uploads/` folder, regardless of whether the merge succeeded or failed.

## 4. Local Development

To run this project on your local machine:

1.  **Prerequisites**: Ensure you have [Node.js](https://nodejs.org/) (which includes npm) installed.
2.  **Install Dependencies**: Open a terminal in the project root and run:
    ```bash
    npm install
    ```
3.  **Configure Environment**: Create a file named `.env.local` in the project root and add your API Gateway Invoke URL:
    ```
    NEXT_PUBLIC_MERGE_API_URL="your_api_gateway_invoke_url_here"
    ```
4.  **Run the App**: Start the Next.js development server:
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:9002`.

## 5. Deployment to AWS

The project uses a two-stack approach for deployment: a "bootstrap" stack to create a bucket for deployment artifacts, and a "main" stack for the application itself. This allows for deploying multiple environments (e.g., development, production) from different branches.

### Step 1: Deploy the Bootstrap Stack

This only needs to be done once per AWS account/region. This stack creates an S3 bucket to hold your CloudFormation templates and zipped Lambda code.

1.  Navigate to CloudFormation in the AWS Console.
2.  Click **Create stack** > **With new resources (standard)**.
3.  Choose **Upload a template file** and select `infrastructure/bootstrap-template.yaml`.
4.  Give the stack a name (e.g., `atenadocs-bootstrap`) and proceed through the steps to create it.
5.  Once created, go to the stack's **Outputs** tab and copy the `ArtifactsBucketName`. You will need this for the next step.

### Step 2: Package and Upload the Backend Code

> **⚠️ IMPORTANT: This is a critical manual step.**
> Before deploying the main application stack, you MUST package the Python Lambda code and upload it to the artifacts bucket you created in the bootstrap step. If you skip this, the CloudFormation deployment will fail with a `NoSuchKey` error.

1.  Navigate to the `backend` directory in your project's terminal.
2.  Create a zip file containing the contents of this directory. **The Python file must be at the root of the zip archive.**
    -   **On macOS/Linux:** `zip -r ../backend.zip .`
    -   **On Windows (using File Explorer):** Select `lambda_function.py` and `requirements.txt`, right-click, and choose "Send to" > "Compressed (zipped) folder". Name the resulting file `backend.zip` and move it to the project's root directory.
3.  In the AWS Console, navigate to the **S3 service**.
4.  Find and open the artifacts bucket you created in Step 1 (e.g., `atenadocs-bootstrap-artifacts-xxxx`).
5.  Click **Upload**, then **Add files**, and select the `backend.zip` file from your project root.
6.  Complete the upload. You should now see `backend.zip` in your artifacts bucket.

### Step 3: Deploy the Main Application Stack

This stack creates all the application resources (S3 bucket for PDFs, Lambda, API Gateway, Amplify frontend). You can deploy this stack multiple times for different environments. For example:
-   **Development Stack**: Set `EnvironmentName` to `development`, `MainBranchName` to `dev`, and `SubDomainPrefix` to `dev`.
-   **Production Stack**: Set `EnvironmentName` to `production`, `MainBranchName` to `main`, and `SubDomainPrefix` to `www` (or your desired production prefix).

1.  Navigate to CloudFormation in the AWS Console.
2.  Click **Create stack** > **With new resources (standard)**.
3.  Choose **Upload a template file** and select `infrastructure/template.yaml`.
4.  On the "Specify stack details" page, fill in the required parameters:
    *   `ArtifactsBucketName`: **(Required)** Paste the S3 bucket name you copied from the bootstrap stack's outputs in Step 1. **Do not leave this blank.**
    *   `LambdaCodeS3Key`: **(Required)** The filename of your uploaded code (e.g., `backend.zip`).
    *   `GitHubRepoURL`: **(Required)** Your full **HTTPS** repository URL (e.g., `https://github.com/your-username/your-repo.git`). **Important: Do not use the SSH URL (`git@...`).**
    *   `GitHubPersonalAccessToken`: **(Required)** A GitHub token with `repo` and `admin:repo_hook` scopes. This is critical for Amplify to connect to your repository and set up automatic deployments.
    *   `MainBranchName`: The name of the GitHub branch you want to deploy (e.g., `main` for production, `dev` for development). Defaults to `main`.
    *   `DomainName`: (Optional) The root domain you own (e.g., `atenadocs.com`).
    *   `SubDomainPrefix`: (Optional) The prefix for this environment (e.g., `dev`). The final URL will be `dev.atenadocs.com`.
5.  Proceed through the remaining steps to create the stack.

### Step 4: Triggering the First Build and Going Live

After the CloudFormation stack is successfully created, the Amplify app is connected to your GitHub repository, but it needs a signal to start its very first build.

You have two options:

1.  **Trigger via Git Push (Recommended)**: This is the standard CI/CD method.
    *   Make any small change to your code.
    *   Commit and push the change to your `main` branch.
    *   ```bash
      git commit -am "Trigger initial Amplify build"
      git push origin main
      ```
    *   This push will trigger the webhook that Amplify created, and you will see the build process start in the AWS Amplify console.

2.  **Trigger Manually in the Console**: If you want to test the build without making a code change:
    *   Navigate to **AWS Amplify** in the AWS Console.
    *   Select your application (e.g., `atenadocs-frontend-development`).
    *   You will see your `main` branch listed. Select it.
    *   Click the **Redeploy this version** button to start a build.

Once the build is complete, your application will be live at the `AmplifyAppUrl` (or your custom domain) found in the CloudFormation stack's "Outputs" tab.

### Step 5: Configure Custom Domain (Optional)

If you provided a `DomainName` in Step 3, CloudFormation will create an Amplify Domain resource for you. However, to complete the setup, you must manually validate that you own the domain.

1.  After the CloudFormation stack deployment begins, navigate to **AWS Amplify** in the AWS Console.
2.  Select your application (e.g., `atenadocs-frontend-development`).
3.  Go to the **Domain management** section in the sidebar.
4.  You will see your custom domain with a status of "Pending verification".
5.  Click on the domain to view the required **CNAME validation record**. It will look something like this:
    *   **Name**: `_c3a2b1d0.dev.atenadocs.com.`
    *   **Value**: `_f4e5d6c7.acm-validations.aws.`
6.  Go to your DNS provider (e.g., Amazon Route 53, GoDaddy, Cloudflare) and add a new CNAME record with the exact Name and Value provided by Amplify.
7.  Wait for the DNS changes to propagate. Amplify will automatically detect the record, validate the domain, and finish provisioning the SSL/TLS certificate. Your site will then be available at your custom domain.

## 6. Git Branching Strategy & Workflow

This project uses a simple but effective Git branching model to manage development and production releases.

-   `main`: This branch is for **production**. Only stable, tested code should be merged into `main`. Pushing to `main` will trigger a deployment to your production environment on AWS Amplify.
-   `dev`: This branch is for **development**. All new features, bug fixes, and other changes should be developed on this branch (or on feature branches that are then merged into `dev`). Pushing to `dev` can trigger a deployment to your development/staging environment.

### Initial Setup Commands

If you have just cloned the repository, your local repository is likely on the `main` branch. Use the following commands to create the `dev` branch and set up your local environment for this workflow.

1.  **Create the `dev` branch from `main`**:
    ```bash
    git checkout -b dev
    ```
    *(This command is a shortcut that creates the `dev` branch and immediately switches to it.)*

2.  **Push the new `dev` branch to GitHub**:
    This makes the `dev` branch available on the remote repository so AWS Amplify can use it for the development environment deployment.
    ```bash
    git push -u origin dev
    ```

3.  **Switch back to `main` (optional)**:
    If you want to ensure your local `main` branch is up-to-date.
    ```bash
    git checkout main
    git pull origin main
    ```

### Development Workflow

1.  Always start new work from the `dev` branch.
    ```bash
    git checkout dev
    git pull origin dev # Make sure you have the latest changes
    ```
2.  Make your code changes, commit them, and push them to the `dev` branch.
    ```bash
    # ...make your changes...
    git add .
    git commit -m "Your descriptive commit message"
    git push origin dev
    ```
3.  When a feature is complete and tested in the development environment, you can merge it into `main` to release it to production.
    ```bash
    git checkout main
    git pull origin main
    git merge dev
    git push origin main
    ```
    This push to `main` will trigger your production deployment on Amplify.

## 7. Troubleshooting

### CloudFormation Stack Fails with `NoSuchKey` Error

-   **Error Message**: `CREATE_FAILED` for the `PdfMergeFunction` with the message `Error occurred while GetObject. S3 Error Code: NoSuchKey`.

-   **Cause**: This error means CloudFormation could not find your Lambda function's code (`backend.zip`) in the S3 artifacts bucket. It is almost always caused by skipping the manual upload step (Step 2 in the deployment guide).

-   **Solution**:
    1.  In the AWS Console, navigate to CloudFormation and **delete the failed stack**.
    2.  Carefully follow the newly updated instructions in **"Step 2: Package and Upload the Backend Code"** to create and upload the `backend.zip` file.
    3.  Verify in the AWS S3 console that the `backend.zip` file is present in the correct bucket.
    4.  Redeploy the main application stack as described in Step 3.
