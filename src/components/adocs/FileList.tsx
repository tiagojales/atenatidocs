"use client";

import { useState } from "react";
import { CircleArrowRight, GripVertical, Loader2, Trash2, XCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PdfIcon } from "../adocs/PdfIcon";
import { cn } from "@/lib/utils";
import { getUploadUrls, triggerPdfMerge } from "@/lib/actions";
import { useToast } from "@/hooks/use-toast";

type FileListProps = {
  files: File[];
  onRemoveFile: (fileName: string) => void;
  onReorderFiles: (files: File[]) => void;
  onClearAll: () => void;
  onMergeSuccess: (downloadUrl: string) => void;
};

/**
 * A component that displays the list of selected files, allows reordering,
 * and orchestrates the entire multi-step PDF merging process. It acts as a "container"
 * component, managing the state for the merge operation and communicating with the
 * backend via Server Actions.
 */
export function FileList({
  files,
  onRemoveFile,
  onReorderFiles,
  onClearAll,
  onMergeSuccess,
}: FileListProps) {
  // --- STATE MANAGEMENT ---

  // Tracks the index of the file being dragged for reordering.
  // Using `null` indicates that no drag is currently active.
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Granular loading states to provide precise user feedback during the multi-step merge process.
  const [isPreparing, setIsPreparing] = useState(false); // Phase 1: Getting pre-signed upload URLs from the backend.
  const [isUploading, setIsUploading] = useState(false); // Phase 2: Actively uploading one or more files directly to S3.
  const [isMerging, setIsMerging] = useState(false);     // Phase 3: The backend is processing and merging the PDFs.

  // Tracks the upload progress of each individual file.
  // The key is the file's name, and the value is a percentage (0-100).
  // This allows for per-file progress bars.
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  
  const { toast } = useToast();

  // --- DRAG-AND-DROP REORDERING LOGIC ---

  /**
   * Handles the `dragstart` event. It sets the index of the item that the user
   * has started to drag.
   */
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  /**
   * Handles the `dragenter` event. It fires when a dragged item enters the drop
   * zone of another item. This is where the actual reordering logic happens.
   */
  const handleDragEnter = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;

    // Create a new array from the existing state to avoid direct mutation.
    const reorderedFiles = Array.from(files);
    // Remove the dragged item from its original position.
    const [removed] = reorderedFiles.splice(draggedIndex, 1);
    // Insert the dragged item into its new position.
    reorderedFiles.splice(index, 0, removed);

    // Pass the newly reordered array up to the parent component, which updates the single source of truth.
    onReorderFiles(reorderedFiles);
    // The dragged item's index is now its new position. This must be updated
    // for subsequent drag events within the same drag operation.
    setDraggedIndex(index);
  };

  /**
   * Handles the `dragend` event. It resets the `draggedIndex` to null when the
   * drag operation is finished (e.g., the mouse button is released).
   */
  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // --- HELPER FUNCTIONS ---

  /**
   * Formats file size in bytes to a human-readable string (KB, MB, etc.).
   */
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  // --- CORE MERGE LOGIC ---

  /**
   * Orchestrates the entire merge process. This is a multi-step asynchronous operation
   * that provides feedback to the user at each stage.
   * 1. **Get Pre-signed URLs**: Asks our secure backend for temporary, one-time-use upload
   *    credentials for each file.
   * 2. **Upload Files to S3**: Uses these credentials to upload files directly from the
   *    browser to S3, bypassing our server to improve performance and scalability.
   * 3. **Trigger Final Merge**: Tells our backend to fetch the now-uploaded files from S3,
   *    merge them, and return a download link.
   */
  const handleMergeClick = async () => {
    if (files.length < 2) {
      toast({
        title: "Insufficient files",
        description: "Add at least two files to merge.",
        variant: "destructive",
      });
      return;
    }

    try {
      // --- PHASE 1: Get Pre-signed URLs ---
      setIsPreparing(true);
      toast({ title: "Preparing uploads..." });
      // Map the files to a simpler object array containing only the name and type,
      // as that's all the backend needs to generate the URLs.
      const filesToUpload = files.map((f) => ({ name: f.name, type: f.type }));
      const uploadDetails = await getUploadUrls(filesToUpload);

      // --- PHASE 2: Upload Files Directly to S3 ---
      setIsPreparing(false);
      setIsUploading(true);
      setUploadProgress({}); // Reset progress for any previous upload attempts.
      toast({
        title: "Uploading files...",
        description: "Please wait while your files are being uploaded.",
      });

      // Use Promise.all to execute all file uploads in parallel.
      // This is significantly faster than uploading them one by one.
      await Promise.all(
        uploadDetails.map(async (details) => {
          const file = files.find((f) => f.name === details.originalFileName);
          if (!file) {
            // This is a sanity check; it should not happen in normal operation.
            throw new Error(`Could not find file data for ${details.originalFileName}.`);
          }

          const formData = new FormData();
          // The S3 pre-signed POST expects a FormData object. We populate it with the
          // fields provided by our backend, which include the policy, signature, and other S3 requirements.
          Object.entries(details.post_details.fields).forEach(([key, value]) => {
            formData.append(key, value);
          });
          // The actual file content MUST be the last field appended to the FormData object.
          formData.append("file", file);

          // We use XMLHttpRequest (XHR) instead of `fetch` because it has a built-in `upload.onprogress`
          // event listener. This is essential for providing real-time upload progress feedback
          // to the user, which `fetch` does not reliably support for uploads.
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", details.post_details.url, true);

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const percent = (event.loaded / event.total) * 100;
                setUploadProgress((prev) => ({ ...prev, [file.name]: percent }));
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                setUploadProgress((prev) => ({ ...prev, [file.name]: 100 }));
                resolve();
              } else {
                reject(new Error(`Upload failed for ${file.name}: ${xhr.statusText}`));
              }
            };
            xhr.onerror = () => reject(new Error("Network error during upload."));
            xhr.send(formData);
          });
        })
      );

      // --- PHASE 3: Trigger Final Merge ---
      setIsUploading(false);
      setIsMerging(true);
      toast({ title: "Upload complete!", description: "Now merging your PDFs." });

      // CRITICAL: We must send the file keys in the exact order defined by the user in the UI.
      // We map over our local `files` state array to guarantee this order is preserved when
      // telling the backend what to merge.
      const orderedKeys = files.map(file => {
          const detail = uploadDetails.find(d => d.originalFileName === file.name);
          // This is a robust check to prevent runtime errors if a file's details are missing.
          if (!detail || !detail.post_details.fields.key) {
            throw new Error(`Upload details missing for ${file.name}. Cannot proceed with merge.`);
          }
          // The S3 object key (the unique path in the bucket) was determined by our backend
          // and provided in the 'key' field of the presigned post details.
          return detail.post_details.fields.key;
      });

      const result = await triggerPdfMerge(orderedKeys);
      toast({ title: "PDFs have been merged!", description: "Your combined PDF is ready for download." });
      
      // On a successful merge, the parent component's callback is invoked with the download URL.
      // This will cause the parent to re-render and display the download view.
      onMergeSuccess(result.downloadUrl);

    } catch (error) {
      // If any step in the process fails, display a generic but informative error toast.
      // We extract the message from the Error object to give the user some context.
      const description = error instanceof Error ? error.message.replace(/^API Error:\s*/, '') : "An unknown error occurred.";
      toast({ 
        title: "Operation Failed", 
        description: description,
        variant: "destructive" 
      });
    } finally {
        // The `finally` block is crucial. It ensures that all loading states are reset to `false`,
        // regardless of whether the operation succeeded or failed. This prevents the UI from
        // getting stuck in a loading state.
        setIsPreparing(false);
        setIsUploading(false);
        setIsMerging(false);
    }
  };
  
  // --- RENDER LOGIC ---

  // A computed boolean to easily disable UI elements during any of the loading phases.
  const isLoading = isPreparing || isUploading || isMerging;

  /**
   * Dynamically determines the text for the main action button based on the current phase
   * of the operation, providing clear, contextual feedback to the user.
   */
  const getButtonText = () => {
    if (isPreparing) return "Preparing...";
    if (isUploading) {
       // Calculate the average upload progress across all files for a summary in the button text.
       const totalProgress = Object.values(uploadProgress).reduce((sum, current) => sum + current, 0);
       const averageProgress = files.length > 0 ? totalProgress / files.length : 0;
       return `Uploading... ${Math.round(averageProgress)}%`;
    }
    if (isMerging) return "Merging...";
    return `Merge`;
  }

  // Calculate the total size of all files for display in the footer.
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="text-xl" >Your Files</CardTitle>
          <CardDescription className="font-small text-sm text-foreground">
          Drag to reorder. Files will be merged from top to bottom.
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onClearAll} className="text-muted-foreground" disabled={isLoading}>
        Clear <XCircle className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3" onDragEnd={handleDragEnd}>
          {files.map((file, index) => {
            const isFileUploading = isUploading && uploadProgress.hasOwnProperty(file.name);
            const progress = uploadProgress[file.name] || 0;

            return (
              <li
                key={file.name}
                draggable={!isLoading}
                onDragStart={() => !isLoading && handleDragStart(index)}
                onDragEnter={() => !isLoading && handleDragEnter(index)}
                onDragOver={(e) => e.preventDefault()} // This is necessary to allow the `drop` event to fire.
                className={cn(
                  "flex items-center rounded-lg border bg-card p-3 shadow-sm transition-all duration-300",
                  !isLoading && "cursor-grab",
                  // Apply visual styles when a file is being actively dragged over another item.
                  draggedIndex === index
                    ? "cursor-grabbing scale-105 bg-primary/10 shadow-lg"
                    : ""
                )}
              >
                <GripVertical className={cn("mr-3 h-5 w-5 text-muted-foreground", isLoading && "text-muted-foreground/50")} />
                <PdfIcon className="mr-4 h-8 w-8 flex-shrink-0" />
                <div className="flex-grow overflow-hidden">
                  <p className="truncate font-medium text-foreground">
                    {file.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                     {isFileUploading ? `${Math.round(progress)}% uploaded` : formatBytes(file.size)}
                  </p>
                  {/* Show a progress bar for the individual file only while it is actively uploading. */}
                  {isFileUploading && <Progress value={progress} className="mt-1 h-2" />}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveFile(file.name)}
                  disabled={isLoading}
                  className="ml-4 h-8 w-8 flex-shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Remove PDF</span>
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
      <CardFooter className="p-6 flex items-center justify-between">
        <div>
          {/* Display a summary of the number of files and their total size. */}
          <p className="font-medium text-sm text-foreground">
            {files.length} {files.length === 1 ? 'file' : 'files'}, totaling {formatBytes(totalSize)}.
          </p>
        </div>
        <Button
          onClick={handleMergeClick}
          disabled={isLoading || files.length < 2}
          className="w-auto"
          size="lg"
        >
          {getButtonText()}
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <CircleArrowRight className="h-5 w-5" />
          )}          
        </Button>
      </CardFooter>
    </Card>
  );
}
