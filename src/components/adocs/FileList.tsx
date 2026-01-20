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
 * and orchestrates the entire multi-step PDF merging process.
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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Loading states to provide granular user feedback during the multi-step merge process.
  const [isPreparing, setIsPreparing] = useState(false); // Phase 1: Getting pre-signed upload URLs.
  const [isUploading, setIsUploading] = useState(false); // Phase 2: Uploading files directly to S3.
  const [isMerging, setIsMerging] = useState(false);     // Phase 3: Backend is merging the PDFs.

  // Tracks the upload progress of each individual file (e.g., { "file1.pdf": 50, "file2.pdf": 100 }).
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  
  const { toast } = useToast();

  // --- DRAG-AND-DROP REORDERING LOGIC ---

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragEnter = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;

    // Create a new array and reorder the files based on the drag-and-drop action.
    const reorderedFiles = Array.from(files);
    const [removed] = reorderedFiles.splice(draggedIndex, 1);
    reorderedFiles.splice(index, 0, removed);

    // Pass the new order up to the parent component to update the source of truth.
    onReorderFiles(reorderedFiles);
    // Update the dragged index to the file's new position in the list.
    setDraggedIndex(index);
  };

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
   * Orchestrates the entire merge process when the user clicks the "Merge" button.
   * This is a multi-step async operation:
   * 1. Get pre-signed URLs from our backend via a Server Action.
   * 2. Upload files directly to S3 from the browser using those URLs.
   * 3. Trigger the final merge on the backend via another Server Action.
   */
  const handleMergeClick = async () => {
    if (files.length < 2) {
      toast({
        title: "Arquivos insuficientes",
        description: "Adicione pelo menos dois arquivos para juntar.",
        variant: "destructive",
      });
      return;
    }

    try {
      // --- PHASE 1: Get Pre-signed URLs ---
      setIsPreparing(true);
      toast({ title: "Preparando envios..." });
      const filesToUpload = files.map((f) => ({ name: f.name, type: f.type }));
      const uploadDetails = await getUploadUrls(filesToUpload);

      // --- PHASE 2: Upload Files Directly to S3 ---
      setIsPreparing(false);
      setIsUploading(true);
      setUploadProgress({}); // Reset progress before starting a new upload session.
      toast({
        title: "Enviando arquivos...",
        description: "Aguarde enquanto seus arquivos são enviados.",
      });

      // Use Promise.all to run all file uploads in parallel for maximum efficiency.
      await Promise.all(
        uploadDetails.map(async (details) => {
          const file = files.find((f) => f.name === details.originalFileName);
          if (!file) {
            // This is a sanity check; it should not happen in normal operation.
            throw new Error(`Não foi possível encontrar os dados do arquivo para ${details.originalFileName}.`);
          }

          const formData = new FormData();
          // The backend provides all necessary fields for the S3 POST policy.
          Object.entries(details.post_details.fields).forEach(([key, value]) => {
            formData.append(key, value);
          });
          formData.append("file", file); // The actual file must be the last field.

          // We use XMLHttpRequest (XHR) instead of fetch because it provides upload progress events,
          // which are essential for a good user experience.
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
                reject(new Error(`Falha no envio de ${file.name}: ${xhr.statusText}`));
              }
            };
            xhr.onerror = () => reject(new Error("Erro de rede durante o envio."));
            xhr.send(formData);
          });
        })
      );

      // --- PHASE 3: Trigger Final Merge ---
      setIsUploading(false);
      setIsMerging(true);
      toast({ title: "Envio completo!", description: "Agora estamos combinando seus PDFs." });

      // Important: We must send the file keys in the same order as the user-defined list.
      // We map over our state `files` array to guarantee the correct order.
      const orderedKeys = files.map(file => {
          const detail = uploadDetails.find(d => d.originalFileName === file.name);
          // This is a robust check to prevent runtime errors if a file's details are missing.
          if (!detail || !detail.post_details.fields.key) {
            throw new Error(`Detalhes do envio ausentes para ${file.name}. Não é possível continuar com a junção.`);
          }
          // The S3 object key is provided by our backend in the 'fields' of the presigned post.
          return detail.post_details.fields.key;
      });

      const result = await triggerPdfMerge(orderedKeys);
      toast({ title: "Os PDFs foram combinados!", description: "Seu PDF combinado está pronto para download." });
      // On success, call the parent's callback to switch to the download view.
      onMergeSuccess(result.downloadUrl);

    } catch (error) {
      let description = "Ocorreu um erro desconhecido durante o envio.";
      if (error instanceof Error) {
        description = error.message;
        // Provide a more helpful error message for the most common failure case.
        if (error.message.toLowerCase().includes("network error")) {
          description = "Ocorreu um erro de rede durante o envio. Isso geralmente é causado por uma configuração de CORS ausente ou incorreta no bucket S3. Garanta que o bucket esteja configurado para aceitar solicitações POST do domínio do seu aplicativo.";
        }
      }
      toast({ title: "Falha na operação", description: description, variant: "destructive" });
    } finally {
        // Reset all loading states, regardless of success or failure, to return to a clean state.
        setIsPreparing(false);
        setIsUploading(false);
        setIsMerging(false);
    }
  };
  
  // --- RENDER LOGIC ---

  const isLoading = isPreparing || isUploading || isMerging;

  // Dynamically determines the text for the main action button based on the current loading state.
  const getButtonText = () => {
    if (isPreparing) return "Preparando...";
    if (isUploading) {
       // Calculate average upload progress across all files for the button text.
       const totalProgress = Object.values(uploadProgress).reduce((sum, current) => sum + current, 0);
       const averageProgress = files.length > 0 ? totalProgress / files.length : 0;
       return `Enviando... ${Math.round(averageProgress)}%`;
    }
    if (isMerging) return "Juntando...";
    return `Juntar`;
  }

  // Calculate the total size of all files for display in the footer.
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="text-xl" >Seus Arquivos</CardTitle>
          <CardDescription className="font-small text-sm text-foreground">
          Arraste para reordenar. Os arquivos serão combinados de cima para baixo.
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onClearAll} className="text-muted-foreground" disabled={isLoading}>
        Limpar <XCircle className="h-4 w-4" />
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
                onDragOver={(e) => e.preventDefault()} // This is necessary for the drop event to work correctly.
                className={cn(
                  "flex items-center rounded-lg border bg-card p-3 shadow-sm transition-all duration-300",
                  !isLoading && "cursor-grab",
                  // Apply visual styles when a file is being dragged.
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
                     {isFileUploading ? `${Math.round(progress)}% enviado` : formatBytes(file.size)}
                  </p>
                  {/* Show a progress bar for the individual file only while it is uploading. */}
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
                  <span className="sr-only">Remover PDF</span>
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
            {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}, totalizando {formatBytes(totalSize)}.
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
