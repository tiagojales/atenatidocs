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

type UploadProgress = Record<string, number>;

export function FileList({
  files,
  onRemoveFile,
  onReorderFiles,
  onClearAll,
  onMergeSuccess,
}: FileListProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({});
  const { toast } = useToast();

  const handleDragStart = (index: number) => setDraggedIndex(index);

  const handleDragEnter = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;
    const reorderedFiles = Array.from(files);
    const [removed] = reorderedFiles.splice(draggedIndex, 1);
    reorderedFiles.splice(index, 0, removed);
    onReorderFiles(reorderedFiles);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => setDraggedIndex(null);

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

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
      setIsPreparing(true);
      toast({ title: "Etapa 1 de 3: Preparando para o envio..." });
      const fileMetadatas = files.map((f) => ({ name: f.name, type: f.type }));
      const uploadTargets = await getUploadUrls(fileMetadatas);

      setIsPreparing(false);
      setIsUploading(true);
      setUploadProgress({});
      toast({
        title: `Etapa 2 de 3: Enviando ${files.length} arquivos...`,
        description: "Por favor, aguarde o término do processo.",
      });

      const uploadPromises = files.map(file => {
        const target = uploadTargets.find(t => t.originalFileName === file.name);
        if (!target) {
            throw new Error(`Não foi encontrada uma URL de envio para ${file.name}.`);
        }

        return new Promise<string>((resolve, reject) => {
            const { url, fields } = target.post_details;
            const formData = new FormData();

            Object.entries(fields).forEach(([key, value]) => {
                formData.append(key, value as string);
            });
            formData.append("file", file);

            const xhr = new XMLHttpRequest();
            xhr.open("POST", url, true);

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const percent = (event.loaded / event.total) * 100;
                setUploadProgress(prev => ({ ...prev, [file.name]: percent }));
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));
                resolve(target.post_details.fields.key);
              } else {
                reject(new Error(`Falha no envio de ${file.name}: ${xhr.statusText}`));
              }
            };

            xhr.onerror = () => reject(new Error("Erro de rede durante o envio."));

            xhr.send(formData);
        });
      });

      const uploadedKeysInOrder = await Promise.all(uploadPromises);

      setIsUploading(false);
      setIsMerging(true);
      toast({ title: "Etapa 3 de 3: Juntando seus PDFs...", description: "Esta é a etapa final." });
      
      const result = await triggerPdfMerge(uploadedKeysInOrder);
      toast({ title: "Operação concluída!", description: "Seu arquivo foi gerado e está pronto para download." });
      
      onMergeSuccess(result.downloadUrl);

    } catch (error) {
      const description = error instanceof Error ? error.message.replace(/^API Error:\s*/, '') : "Ocorreu um erro desconhecido.";
      toast({ 
        title: "Operação Falhou", 
        description: description,
        variant: "destructive" 
      });
    } finally {
        setIsPreparing(false);
        setIsUploading(false);
        setIsMerging(false);
    }
  };
  
  const isLoading = isPreparing || isUploading || isMerging;

  const getButtonText = () => {
    if (isPreparing) return "Preparando...";
    if (isUploading) {
       const totalProgress = Object.values(uploadProgress).reduce((sum, current) => sum + current, 0);
       const averageProgress = files.length > 0 ? totalProgress / files.length : 0;
       return `Enviando... ${Math.round(averageProgress)}%`;
    }
    if (isMerging) return "Juntando...";
    const fileCount = files.length;
    return `Juntar`;
  }

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
        <Button variant="ghost" size="sm" onClick={onClearAll} className="text-muted-foreground gap-2" disabled={isLoading}>
          Limpar<XCircle className="h-4 w-4" />
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
                onDragOver={(e) => e.preventDefault()}
                className={cn(
                  "flex items-center rounded-lg border bg-card p-3 shadow-sm transition-all duration-300",
                  !isLoading && "cursor-grab",
                  draggedIndex === index
                    ? "cursor-grabbing scale-105 bg-primary/10 shadow-lg"
                    : ""
                )}
              >
                <GripVertical className={cn("mr-3 h-5 w-5 text-muted-foreground", isLoading && "text-muted-foreground/50")} />
                <PdfIcon className="mr-4 h-8 w-8 flex-shrink-0" />
                <div className="flex-grow overflow-hidden">
                  <p className="truncate font-medium text-foreground">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                     {isFileUploading ? `${Math.round(progress)}% enviado` : formatBytes(file.size)}
                  </p>
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
          <p className="font-medium text-sm text-foreground">
            {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}, totalizando {formatBytes(totalSize)}.
          </p>
        </div>
        <Button
          onClick={handleMergeClick}
          disabled={isLoading || files.length < 2}
          className="w-auto gap-2"
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
