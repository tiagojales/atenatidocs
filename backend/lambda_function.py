# --- AtenaDocs Lambda Function ---
# This AWS Lambda function serves as the backend for the AtenaDocs application.
# It is designed as a single-endpoint router triggered by API Gateway, handling two main tasks:
# 1. Generating pre-signed S3 POST URLs for secure, direct-to-S3 browser uploads.
# 2. Merging multiple PDF files (specified by their S3 keys) into a single document.
# This architecture is efficient and scalable, offloading large file uploads from the Lambda's execution environment.

import json
import base64
import io
import os
import boto3
from PyPDF2 import PdfMerger
import uuid
import traceback

# Initialize the S3 client once per container to be reused across invocations for performance.
s3_client = boto3.client('s3')

# The S3 bucket name is injected as an environment variable from the CloudFormation template.
# This must be configured in the Lambda function's settings in the AWS console.
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')

def _make_response(status_code, body):
    """
    A helper function to create a standard JSON API response object for API Gateway.
    It automatically stringifies the body if it's not already a string and includes
    CORS headers to allow cross-origin requests from the frontend.
    """
    if not isinstance(body, str):
        body = json.dumps(body)

    return {
        'statusCode': status_code,
        'headers': {
            # --- CRITICAL PRODUCTION NOTE ---
            # For a production application, it is vital to replace the wildcard '*' with your specific frontend domain
            # to prevent Cross-Site Request Forgery (CSRF) and other web vulnerabilities.
            # Example: 'Access-Control-Allow-Origin': 'https://www.atenadocs.com'
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        'body': body
    }

def handle_generate_urls(file_names):
    """
    Handles the first phase of the file upload process: generating secure, temporary URLs
    that the browser can use to upload files directly to S3. This avoids the 10MB API Gateway
    payload limit and offloads the upload bandwidth from this Lambda function.
    """
    if not isinstance(file_names, list) or not file_names:
        return _make_response(400, "'fileNames' must be a non-empty list.")

    response_parts = []
    for file_name in file_names:
        # Generate a universally unique path for each file to prevent name collisions in the S3 bucket.
        # The format is: uploads/<uuid4>/original_filename.pdf
        key = f"uploads/{uuid.uuid4()}/{file_name}"
        
        # Generate a pre-signed POST policy. This is a set of rules and credentials that S3 will use
        # to validate the incoming request from the browser.
        presigned_post = s3_client.generate_presigned_post(
            Bucket=S3_BUCKET_NAME,
            Key=key,
            # These fields and conditions must be matched exactly by the browser's POST request.
            Fields={"Content-Type": "application/pdf"},
            Conditions=[
                # The uploaded file must be a PDF.
                {"Content-Type": "application/pdf"},
                # The file size must be between 1 byte and 100 MB (100 * 1024 * 1024).
                ["content-length-range", 1, 104857600] 
            ],
            ExpiresIn=3600  # The pre-signed URL is valid for 1 hour.
        )
        response_parts.append({
            'originalFileName': file_name,
            'post_details': presigned_post
        })

    return _make_response(200, {"uploads": response_parts})

def handle_merge_files(file_keys):
    """
    Handles the second phase: merging the PDFs after they have been uploaded to S3.
    It downloads the specified files from S3, merges them in memory, uploads the result
    back to S3, generates a download URL, and finally, cleans up the original source files.
    """
    if not isinstance(file_keys, list) or len(file_keys) < 2:
        return _make_response(400, "At least two 'fileKeys' are required to merge.")

    merger = PdfMerger()

    try:
        # Step 1: Download each specified file from S3 and append it to the merger object in memory.
        # The file keys are provided by the client, in the user-specified order.
        for key in file_keys:
            s3_object = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=key)
            # PyPDF2's merger can read from a file-like object, so we wrap the S3 object's body in BytesIO.
            merger.append(io.BytesIO(s3_object['Body'].read()))

        # Step 2: Write the final merged PDF from the PdfMerger object to an in-memory buffer.
        output_buffer = io.BytesIO()
        merger.write(output_buffer)
        output_buffer.seek(0) # Rewind the buffer to the beginning before reading.
        merger.close()

        # Step 3: Upload the merged PDF from the in-memory buffer to a new S3 object.
        merged_key = f"merged/{uuid.uuid4()}.pdf"
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=merged_key,
            Body=output_buffer,
            ContentType='application/pdf'
        )

        # Step 4: Generate a pre-signed GET URL for the user to download the final merged file.
        download_filename = f"atenadocs-merged-{uuid.uuid4().hex}.pdf"
        download_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': S3_BUCKET_NAME, 
                'Key': merged_key,
                # --- CRITICAL HEADER ---
                # This 'ResponseContentDisposition' header is essential. It instructs the
                # browser to treat the URL as a file download (triggering a 'Save As' dialog)
                # rather than attempting to display the PDF inline.
                'ResponseContentDisposition': f'attachment; filename="{download_filename}"'
            },
            ExpiresIn=3600  # The download link is valid for 1 hour.
        )

        return _make_response(200, {
            'message': 'PDFs merged successfully!',
            'downloadUrl': download_url
        })
    finally:
        # Step 5: Clean up the original uploaded source files from the /uploads folder.
        # This is placed in a 'finally' block to ensure it runs even if the merge process fails,
        # preventing orphaned files from accumulating in the S3 bucket.
        if file_keys: # Only attempt to delete if file_keys were provided.
            for key in file_keys:
                try:
                    s3_client.delete_object(Bucket=S3_BUCKET_NAME, Key=key)
                except Exception as e:
                    # Log a warning to CloudWatch but do not fail the entire function if a delete fails.
                    # This could happen if permissions are wrong or the file was already deleted.
                    print(f"Warning: Failed to delete source file {key}: {e}")

def lambda_handler(event, context):
    """
    The main entry point for the Lambda function, invoked by API Gateway.
    It inspects the request body to determine the desired action and routes
    the request to the appropriate handler function.
    - If 'fileNames' is in the body, it calls handle_generate_urls.
    - If 'fileKeys' is in the body, it calls handle_merge_files.
    """
    # Fail-fast if the essential S3 bucket environment variable is not configured.
    if not S3_BUCKET_NAME:
        print("CRITICAL ERROR: S3_BUCKET_NAME environment variable not set.")
        return _make_response(500, "Server configuration error: S3 bucket not specified.")

    try:
        # API Gateway may or may not base64 encode the request body, so we handle both cases for robustness.
        body_str = event.get('body', '{}')
        if event.get('isBase64Encoded', False):
            body_str = base64.b64decode(body_str).decode('utf-8')
        
        body = json.loads(body_str)

        # Route the request based on the keys present in the JSON body.
        # This simple routing mechanism allows a single Lambda endpoint to serve multiple functions.
        if 'fileNames' in body:
            return handle_generate_urls(body.get('fileNames', []))
        elif 'fileKeys' in body:
            return handle_merge_files(body.get('fileKeys', []))
        else:
            return _make_response(400, "Invalid request. Body must contain 'fileNames' or 'fileKeys'.")

    except Exception as e:
        # Comprehensive error logging for easier debugging in CloudWatch.
        # Including the request ID is crucial for tracing specific invocations.
        request_id = context.aws_request_id if context else 'N/A'
        print(f"ERROR: Exception in lambda_handler for request ID {request_id}. Details: {e}")
        traceback.print_exc() # Print the full stack trace to the logs.
        return _make_response(500, f'An internal server error occurred. Please check logs. Request ID: {request_id}')
