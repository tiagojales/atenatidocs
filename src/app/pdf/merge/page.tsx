"use client";

import { useState } from "react";
import { FileUpload } from "@/components/adocs/FileUpload";
import { FileList } from "@/components/adocs/FileList";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Download, ReplyAll } from "lucide-react";

/**
 * The main page component for the PDF merging tool.
 * This component orchestrates the entire user flow for merging PDFs, including:
 * 1. Handling file selection and validation.
 * 2. Displaying the list of selected files.
 * 3. Managing the multi-step merge process (upload, merge, download).
 * 4. Conditionally rendering either the upload interface or the final download screen.
 */
export default function MergePdfPage() {
  // --- STATE MANAGEMENT ---

  // Holds the list of PDF files the user has selected.
  // This state is the single source of truth for the file list that the user sees and reorders.
  const [files, setFiles] = useState<File[]>([]);
  
  // Holds the URL for the final merged PDF. When this is set, the UI switches to the download view.
  // This state also acts as a flag to control which UI view (upload or download) is rendered.
  const [mergedPdfUrl, setMergedPdfUrl] = useState<string | null>(null);

  const { toast } = useToast();

  // --- FILE HANDLING ---

  /**
   * Handles new files selected by the user via drag-and-drop or the file input.
   * It performs several validation checks before adding the files to the main state.
   * @param selectedFiles - An array of File objects from the file input or drop event.
   */
  const handleFilesSelected = (selectedFiles: File[]) => {
    const MAX_TOTAL_SIZE_MB = 100;
    const MAX_TOTAL_SIZE_BYTES = MAX_TOTAL_SIZE_MB * 1024 * 1024;

    // Calculate the total size of files already in the list.
    const currentSize = files.reduce((sum, file) => sum + file.size, 0);
    let newFilesSize = 0;

    // Filter the incoming files to ensure they are valid before adding them to the state.
    const newFiles = selectedFiles.filter((file) => {
      // Validation 1: Check if the file is a PDF.
      if (file.type !== "application/pdf") {
        toast({
          title: "Tipo de arquivo inválido",
          description: `${file.name} não é um arquivo PDF.`,
          variant: "destructive",
        });
        return false;
      }
      // Validation 2: Check for duplicate file names to prevent user confusion.
      if (files.some((existing) => existing.name === file.name)) {
        toast({
          title: "Arquivo duplicado",
          description: `${file.name} já foi adicionado.`,
          variant: "destructive",
        });
        return false;
      }
      // Validation 3: Check if adding the new file would exceed the total size limit.
      if (currentSize + newFilesSize + file.size > MAX_TOTAL_SIZE_BYTES) {
        toast({
          title: "Limite de tamanho excedido",
          description: `A adição destes arquivos excede o limite total de ${MAX_TOTAL_SIZE_MB}MB.`,
          variant: "destructive",
        });
        return false;
      }
      // If the file is valid, add its size to the running total for this batch.
      newFilesSize += file.size;
      return true;
    });

    // Add the newly validated files to the existing file list.
    setFiles((prevFiles) => [...prevFiles, ...newFiles]);
  };

  /**
   * Removes a specific file from the list, identified by its name.
   * @param fileName - The name of the file to remove.
   */
  const handleRemoveFile = (fileName: string) => {
    setFiles((prevFiles) => prevFiles.filter((file) => file.name !== fileName));
  };

  /**
   * Updates the file list order after a drag-and-drop operation in the FileList component.
   * This function receives the newly reordered array and updates the state.
   * @param reorderedFiles - The new, reordered array of File objects.
   */
  const handleReorderFiles = (reorderedFiles: File[]) => {
    setFiles(reorderedFiles);
  };

  /**
   * Clears all files from the list, resetting the selection.
   */
  const handleClearAll = () => {
    setFiles([]);
  };

  // --- MERGE AND DOWNLOAD ---

  /**
   * This callback is triggered by the FileList component upon a successful merge.
   * It sets the download URL and clears the file list, transitioning the UI to the download view.
   * @param downloadUrl - The pre-signed URL for the merged PDF, received from the backend.
   */
  const handleMergeSuccess = (downloadUrl: string) => {
    setMergedPdfUrl(downloadUrl);
    setFiles([]); // Clear the file list as the operation is complete.
  };

  /**
   * Resets the entire UI to its initial state, allowing the user to start a new merge operation.
   * This is called from the "Refazer" (Start Over) button on the download screen.
   */
  const handleStartOver = () => {
    setMergedPdfUrl(null);
    setFiles([]);
  };

  // --- RENDER LOGIC ---

  return (
    <div className="container mx-auto px-4 py-4 sm:py-12">
      {/* Conditional rendering: Show download UI if mergedPdfUrl exists, otherwise show the upload UI. */}
      {mergedPdfUrl ? (
        // --- DOWNLOAD VIEW ---
        <Card className="p-6 sm:p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">Seus PDFs foram juntados!</h2>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
            <Button asChild size="lg">
              <a href={mergedPdfUrl} download>
                <Download className="mr-2 h-5 w-5" />
                Baixar Agora
              </a>
            </Button>
            <Button onClick={handleStartOver} variant="outline" size="lg">
              <ReplyAll className="mr-2 h-5 w-5" />
              Refazer
            </Button>
          </div>
        </Card>
      ) : (
        // --- UPLOAD VIEW ---
        <div className="space-y-8 ">
          {/* App title and description, integrated directly into the main page content. */}
          <div className="text-center space-y-2">
              <div className="flex items-center justify-center gap-3">
                  <h1 className="text-4xl font-bold tracking-tight text-foreground">
                      Juntar Arquivos PDF
                  </h1>
              </div>
              <p className="text-lg text-muted-foreground">Arraste, solte, reordene e junte seus PDFs em um só.</p>
          </div>

          {/* File upload component. */}
          <Card className="p-6 sm:p-8">
            <FileUpload onFilesSelected={handleFilesSelected} />
          </Card>

          {/* File list component, only shown if there are files selected. */}
          {files.length > 0 && (
            <FileList
              files={files}
              onRemoveFile={handleRemoveFile}
              onReorderFiles={handleReorderFiles}
              onClearAll={handleClearAll}
              onMergeSuccess={handleMergeSuccess}
            />
          )}
        </div>
      )}
    </div>
  );
}
