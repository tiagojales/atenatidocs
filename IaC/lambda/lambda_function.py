"""
This module serves as the backend for the AtenaDocs application, running as a
single AWS Lambda function. It acts as a secure intermediary between the frontend
and AWS S3, handling two primary operations:

1.  generate_presigned_urls: Creates secure, temporary upload URLs for the frontend
    to send PDF files directly to an S3 bucket. This offloads the heavy lifting
    of file uploads from the Lambda function.

2.  merge_pdfs: After the files are uploaded, this function is triggered. It
    downloads the PDFs from S3, merges them into a single document in the correct
    order, uploads the final merged PDF back to S3, and generates a secure
    download link for the user.

The main entry point is `lambda_handler`, which acts as a simple router,
directing requests to the appropriate function based on the content of the
request body. It also includes robust error handling and CORS management.
"""
import json
import os
import uuid
import boto3
from PyPDF2 import PdfMerger

# Initialize the S3 client once to be reused across function invocations.
s3_client = boto3.client('s3')
# The S3 bucket name is passed in as an environment variable from the CloudFormation template.
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')

def get_cors_headers(event):
    """
    Generates appropriate CORS headers for API Gateway responses.

    This function dynamically reflects the request's 'Origin' header. This is a
    more secure practice than using a static wildcard ('*'), as it ensures that
    only the originating client domain is explicitly allowed access.

    Args:
        event (dict): The API Gateway event dictionary.

    Returns:
        dict: A dictionary of CORS headers for the API response.
    """
    # Default to a wildcard if the origin header is not present, though in a
    # browser context, it almost always will be.
    origin = event.get('headers', {}).get('origin', '*')

    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }

def generate_presigned_urls(event, context):
    """
    Generates pre-signed POST URLs for uploading files directly to S3.

    The client provides a list of file names, and this function returns a
    corresponding list of objects, each containing the S3 URL and the required
    form fields to perform a direct browser-based upload.

    Args:
        event (dict): The API Gateway event, containing the file names in its body.
        context (object): The Lambda context object (not used in this function).

    Returns:
        dict: An API Gateway response dictionary with the pre-signed URL details.
    """
    body = json.loads(event.get('body', '{}'))
    file_names = body.get('fileNames', [])
    cors_headers = get_cors_headers(event)

    if not file_names:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': "'fileNames' must be a non-empty list."})
        }

    response_parts = []
    for file_name in file_names:
        # Generate a unique key for each file to prevent name collisions in S3.
        key = f"uploads/{uuid.uuid4()}/{file_name}"
        
        # Create the pre-signed POST data. This is a set of credentials that
        # allows a client to upload a file with specific constraints.
        presigned_post = s3_client.generate_presigned_post(
            Bucket=S3_BUCKET_NAME,
            Key=key,
            # Define required fields and their values for the upload form.
            Fields={"Content-Type": "application/pdf"},
            # Define conditions the upload must meet (e.g., file type, size).
            Conditions=[
                {"Content-Type": "application/pdf"},
                # Limit file size to a maximum of 100MB.
                ["content-length-range", 1, 104857600]
            ],
            # The URL is valid for 1 hour (3600 seconds).
            ExpiresIn=3600
        )
        response_parts.append({
            'originalFileName': file_name,
            'post_details': presigned_post
        })

    return {
        'statusCode': 200,
        'headers': cors_headers,
        'body': json.dumps({'uploads': response_parts})
    }

def merge_pdfs(event, context):
    """
    Downloads PDFs from S3, merges them, and provides a download link.

    This function receives a list of S3 object keys in the desired merge order.
    It processes them in the Lambda's temporary file system (`/tmp`) and then
    uploads the final result back to S3.

    Args:
        event (dict): The API Gateway event, containing S3 file keys in its body.
        context (object): The Lambda context object (not used in this function).

    Returns:
        dict: An API Gateway response with the download URL for the merged file.
    """
    body = json.loads(event.get('body', '{}'))
    file_keys = body.get('fileKeys', [])
    cors_headers = get_cors_headers(event)

    if len(file_keys) < 2:
        return {'statusCode': 400, 'headers': cors_headers, 'body': json.dumps({'error': 'At least two files are required to merge.'})}

    merger = PdfMerger()
    temp_files = []
    # Define path for the final merged file in the Lambda's ephemeral storage.
    merged_temp_path = f"/tmp/merged-{uuid.uuid4()}.pdf"

    try:
        # Step 1: Download all specified files from S3 to the /tmp directory.
        for key in file_keys:
            temp_path = f"/tmp/{uuid.uuid4()}.pdf"
            temp_files.append(temp_path)
            s3_client.download_file(S3_BUCKET_NAME, key, temp_path)
            # Step 2: Append each downloaded PDF to the merger object.
            merger.append(temp_path)

        # Step 3: Write the merged content to a single file in /tmp.
        merger.write(merged_temp_path)

        # Step 4: Upload the final merged PDF to a 'merged/' prefix in S3.
        merged_key = f"merged/{uuid.uuid4()}.pdf"
        s3_client.upload_file(merged_temp_path, S3_BUCKET_NAME, merged_key)
        
        # Step 5: Generate a pre-signed GET URL for the client to download the file.
        # The 'ResponseContentDisposition' header suggests a filename to the browser.
        download_filename = f"atenadocs-merged-{uuid.uuid4().hex[:8]}.pdf"
        download_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': S3_BUCKET_NAME,
                'Key': merged_key,
                'ResponseContentDisposition': f'attachment; filename="{download_filename}"'
            },
            ExpiresIn=3600 # Link is valid for 1 hour.
        )

        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'PDFs merged successfully!', 'downloadUrl': download_url})
        }

    finally:
        # This block executes whether the 'try' block succeeded or failed.
        # It's crucial for cleaning up resources to avoid filling up the /tmp
        # directory or leaving orphaned files in S3.
        
        # Clean up all temporary files from the Lambda's /tmp directory.
        all_temp_paths = temp_files + ([merged_temp_path] if os.path.exists(merged_temp_path) else [])
        for path in all_temp_paths:
            if os.path.exists(path):
                os.remove(path)
        
        # Clean up the original source files from the S3 'uploads/' directory.
        if file_keys:
            s3_client.delete_objects(
                Bucket=S3_BUCKET_NAME,
                Delete={'Objects': [{'Key': key} for key in file_keys]}
            )
            
        # Close the PdfMerger object to free up resources.
        merger.close()

def lambda_handler(event, context):
    """
    The main entry point for the AWS Lambda function.

    This function acts as a router, validates prerequisites, and handles exceptions.
    """
    # Fail fast if the S3 bucket environment variable isn't set.
    if not S3_BUCKET_NAME:
        return {'statusCode': 500, 'body': json.dumps({'error': 'S3_BUCKET_NAME environment variable not set.'})}
        
    # Handle CORS preflight (OPTIONS) requests from the browser.
    # This is necessary for the browser to verify that the subsequent POST request is allowed.
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': get_cors_headers(event),
            'body': ''
        }

    # This is a simple router that inspects the request body to decide which
    # function to execute.
    try:
        body = json.loads(event.get('body', '{}'))
        if 'fileNames' in body:
            return generate_presigned_urls(event, context)
        elif 'fileKeys' in body:
            return merge_pdfs(event, context)
        else:
            # If the request body doesn't match a known operation, return a Bad Request error.
            return {
                'statusCode': 400,
                'headers': get_cors_headers(event),
                'body': json.dumps({'error': "Invalid request. Body must contain 'fileNames' or 'fileKeys'."})
            }
    except Exception as e:
        # Log the full technical error to CloudWatch for debugging purposes.
        print(f"Error: {e}")
        
        # Determine if we are in a production environment. This is set in the
        # CloudFormation template.
        is_production = os.environ.get('ENVIRONMENT_NAME', 'development').lower() == 'production'
        
        # Formulate a safe error message. For non-production environments, we return
        # the actual error to make debugging easier. For production, we return a
        # generic message to avoid leaking implementation details.
        error_message = 'An internal server error occurred.'
        if not is_production:
            error_message = str(e)

        return {
            'statusCode': 500,
            'headers': get_cors_headers(event),
            'body': json.dumps({'error': error_message})
        }
