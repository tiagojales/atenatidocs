"use client";

import { useState } from "react";
import { FileUpload } from "@/components/adocs/FileUpload";
import { FileList } from "@/components/adocs/FileList";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Download, ReplyAll, Loader2 } from "lucide-react";

export default function MergePdfPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [mergedPdfUrl, setMergedPdfUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  const handleFilesSelected = (selectedFiles: File[]) => {
    const MAX_TOTAL_SIZE_MB = 100;
    const MAX_TOTAL_SIZE_BYTES = MAX_TOTAL_SIZE_MB * 1024 * 1024;

    const currentSize = files.reduce((sum, file) => sum + file.size, 0);
    let newFilesSize = 0;

    const newFiles = selectedFiles.filter((file) => {
      if (file.type !== "application/pdf") {
        toast({ title: "Arquivo inválido", description: `O arquivo '${file.name}' não é um PDF.`, variant: "destructive" });
        return false;
      }
      if (files.some((existing) => existing.name === file.name)) {
        toast({ title: "Arquivo duplicado", description: `O arquivo '${file.name}' já foi adicionado.`, variant: "destructive" });
        return false;
      }
      if (currentSize + newFilesSize + file.size > MAX_TOTAL_SIZE_BYTES) {
        toast({ title: "Limite de tamanho excedido", description: `A seleção atual excede o limite total de ${MAX_TOTAL_SIZE_MB}MB.`, variant: "destructive" });
        return false;
      }
      newFilesSize += file.size;
      return true;
    });

    setFiles((prevFiles) => [...prevFiles, ...newFiles]);
  };

  const handleRemoveFile = (fileName: string) => {
    setFiles((prevFiles) => prevFiles.filter((file) => file.name !== fileName));
  };

  const handleReorderFiles = (reorderedFiles: File[]) => {
    setFiles(reorderedFiles);
  };

  const handleClearAll = () => {
    setFiles([]);
  };

  const handleMergeSuccess = (downloadUrl: string) => {
    setMergedPdfUrl(downloadUrl);
    setFiles([]);
  };

  const handleStartOver = () => {
    setMergedPdfUrl(null);
    setFiles([]);
  };

  const handleDownload = async (url: string | null) => {
    if (!url) return;
    setIsDownloading(true);
    toast({ title: "Iniciando download...", description: "Seu PDF combinado está sendo preparado." });

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Falha ao buscar o arquivo. Status: ${response.status}`);
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "adocs-documento-combinado.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error("Download failed:", error);
      toast({
        title: "Falha no Download",
        description: "Não foi possível baixar o arquivo. Verifique sua conexão e tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-4 sm:py-12">
      {mergedPdfUrl ? (
        <Card className="p-6 sm:p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">Seus PDFs foram combinados!</h2>
          <p className="text-muted-foreground mb-6">Seu arquivo está pronto. Clique no botão abaixo para fazer o download.</p>
          <div className="flex flex-col justify-center items-center gap-4">
            <Button onClick={() => handleDownload(mergedPdfUrl)} size="lg" disabled={isDownloading}>
              {isDownloading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Download className="mr-2 h-5 w-5" />
              )}
              {isDownloading ? "Baixando..." : "Baixar PDF"}
            </Button>
            <Button onClick={handleStartOver} variant="outline" size="lg" disabled={isDownloading}>
              <ReplyAll className="mr-2 h-5 w-5" />
              Refazer
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-8 ">
          <div className="text-center space-y-2">
              <div className="flex items-center justify-center gap-3">
                  <h1 className="text-4xl font-bold tracking-tight text-foreground">Juntar Arquivos PDF</h1>
              </div>
              <p className="text-lg text-muted-foreground">Arraste, solte, reordene e combine seus PDFs em um único arquivo.</p>
          </div>
          <Card className="p-6 sm:p-8">
            <FileUpload onFilesSelected={handleFilesSelected} />
          </Card>
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
