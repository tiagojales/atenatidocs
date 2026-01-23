/**
 * @file This file defines Next.js Server Actions that act as a secure bridge
 * between the client-side components and the external Python backend API running on AWS.
 * This approach prevents the backend API URL from being exposed in the browser.
 */

"use server";

// --- TYPE DEFINITIONS ---

/**
 * Describes the data returned by the backend for a single file upload.
 * It contains the URL to POST the file to and all the form fields required by S3's POST policy.
 */
type PresignedUploadDetails = {
  originalFileName: string;
  post_details: {
    url: string;
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

// The backend API URL is sourced from an environment variable.
// It first checks for a server-side specific variable (API_URL) and falls back to the public one.
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;

/**
 * A generic helper function to make POST requests to the external Python backend API.
 * It centralizes request logic, error handling, and JSON parsing.
 * @param path - The specific API endpoint path (e.g., '/upload' or '/merge').
 * @param body - The JavaScript object to be sent as the JSON request body.
 * @returns The parsed JSON response from the API.
 * @throws An error if the request fails or if the API URL is not configured.
 */
async function apiPost(path: string, body: object) {
  if (!API_URL) {
    throw new Error(
      "Configuration Error: The backend API URL is not set. Please ensure the API_URL or NEXT_PUBLIC_API_URL environment variable is configured."
    );
  }

  // Construct the full URL by appending the specific path to the base API URL.
  const fullUrl = `${API_URL}${path}`;

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Ensure that requests are not cached. This forces a fresh call to the backend
    // every time, which is essential for operations like generating unique presigned URLs.
    cache: "no-store",
  });

  const responseText = await response.text();
  let responseJson;

  try {
    // Attempt to parse the response text as JSON, but don't fail if it's empty
    // (which can be valid for some successful HTTP responses).
    if (responseText) {
      responseJson = JSON.parse(responseText);
    }
  } catch (e) {
    // If JSON parsing fails on a non-OK response, we'll handle it below.
    // This just prevents a crash if the error response itself isn't valid JSON.
  }
  
  if (!response.ok) {
    // If the API returned an error (e.g., 4xx or 5xx status code), construct a detailed error message.
    // We prioritize using the 'error' field from the JSON body, which our Python backend
    // provides in development for clear debugging.
    // If that's not available, fall back to the raw response text or the generic HTTP status text.
    const errorMessage = responseJson?.error || responseText || response.statusText;
    throw new Error(`Backend API Error: ${errorMessage}`);
  }

  if (!responseJson) {
      throw new Error("API Error: The backend returned a successful status code but the response body was empty or not valid JSON.");
  }

  return responseJson;
}


/**
 * Server Action to request pre-signed S3 POST URLs from the backend.
 * @param files - An array of objects, each containing the name of a file to be uploaded.
 * @returns A promise that resolves to an array of PresignedUploadDetails, one for each file.
 */
export async function getUploadUrls(
  files: { name: string }[]
): Promise<PresignedUploadDetails[]> {
  // Call the API with the '/upload' path.
  const result = await apiPost("/upload", { fileNames: files.map((f) => f.name) });
  // The backend's response wraps the array in an 'uploads' key, which we extract here.
  return result.uploads;
}

/**
 * Server Action to trigger the final PDF merge process on the backend.
 * @param fileKeys - An array of S3 object keys in the exact order they should be merged.
 * @returns A promise resolving to an object containing the download URL for the merged PDF.
 */
export async function triggerPdfMerge(
  fileKeys: string[]
): Promise<MergeTriggerResult> {
  // Call the API with the '/merge' path.
  const result = await apiPost("/merge", { fileKeys });
  return result;
}
