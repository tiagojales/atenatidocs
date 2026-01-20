"use server";

// This file defines Next.js Server Actions, which are server-side functions
// that can be called directly from client components. They act as a secure
// bridge (a "backend-for-frontend" or BFF) between our frontend and the
// external AWS Lambda API, preventing API URLs from being exposed in the browser.

// --- TYPE DEFINITIONS ---

/**
 * Describes the structure of the data returned by the backend for a single file upload.
 * It contains the URL to POST the file to and all the form fields required by the S3 POST policy.
 */
type PresignedUploadDetails = {
  originalFileName: string;
  post_details: {
    url: string;
    // The 'fields' object includes all the form fields for the S3 POST policy,
    // most importantly the unique 'key' (the path/filename) for the object in the S3 bucket.
    fields: Record<string, string>; 
  };
};

/**
 * Describes the structure of the successful response after triggering the PDF merge.
 */
type MergeTriggerResult = {
  message: string;
  downloadUrl: string;
};

// The URL of the deployed AWS Lambda function, accessed via API Gateway.
// This is securely accessed on the server via an environment variable.
const API_URL = process.env.NEXT_PUBLIC_MERGE_API_URL;

/**
 * A generic helper function to make POST requests to our backend Lambda API.
 * It centralizes request logic, error handling, and JSON parsing.
 * @param body - The JavaScript object to be sent as the JSON request body.
 * @returns The parsed JSON response from the API.
 * @throws An error if the API endpoint is not configured or if the request fails.
 */
async function apiPost(body: object) {
  if (!API_URL) {
    throw new Error(
      "The API endpoint is not configured. Please set NEXT_PUBLIC_MERGE_API_URL in your environment variables."
    );
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMessage = `API request failed with status: ${response.status} ${response.statusText}`;
    try {
      // Attempt to parse a more specific error message from the API response body.
      const errorBody = await response.json();
      errorMessage = errorBody.message || JSON.stringify(errorBody) || errorMessage;
    } catch (e) {
      // If parsing the error body fails, fall back to the original status text.
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * A Next.js Server Action that asks the backend for pre-signed S3 POST URLs.
 * This is the first step in the file upload process, called by the client.
 * @param files - An array of objects containing metadata (like the name) of the files to be uploaded.
 * @returns A promise that resolves to an array of PresignedUploadDetails.
 */
export async function getUploadUrls(
  files: { name: string }[]
): Promise<PresignedUploadDetails[]> {
  const fileNames = files.map((f) => f.name);
  const result = await apiPost({ fileNames });
  return result.uploads;
}

/**
 * A Next.js Server Action that tells the backend to merge the previously uploaded files.
 * This is the final step in the process, called by the client after all uploads are complete.
 * @param fileKeys - An array of S3 object keys (the full paths to the files in the bucket)
 *                   in the desired merge order.
 * @returns A promise that resolves to an object containing the download URL for the merged PDF.
 */
export async function triggerPdfMerge(
  fileKeys: string[]
): Promise<MergeTriggerResult> {
  const result = await apiPost({ fileKeys });
  return result;
}
