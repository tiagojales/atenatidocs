"use client";

import { useState } from "react";
import { FileUpload } from "@/components/adocs/FileUpload";
import { FileList } from "@/components/adocs/FileList";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Download, ReplyAll } from "lucide-react";

export default function MergePdfPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [mergedPdfUrl, setMergedPdfUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFilesSelected = (selectedFiles: File[]) => {
    const MAX_TOTAL_SIZE_MB = 100;
    const MAX_TOTAL_SIZE_BYTES = MAX_TOTAL_SIZE_MB * 1024 * 1024;

    const currentSize = files.reduce((sum, file) => sum + file.size, 0);
    let newFilesSize = 0;

    const newFiles = selectedFiles.filter((file) => {
      if (file.type !== "application/pdf") {
        toast({ title: "Tipo de arquivo inválido", description: `${file.name} não é um arquivo PDF.`, variant: "destructive" });
        return false;
      }
      if (files.some((existing) => existing.name === file.name)) {
        toast({ title: "Arquivo duplicado", description: `${file.name} já foi adicionado.`, variant: "destructive" });
        return false;
      }
      if (currentSize + newFilesSize + file.size > MAX_TOTAL_SIZE_BYTES) {
        toast({ title: "Limite de tamanho excedido", description: `A adição destes arquivos excede o limite total de ${MAX_TOTAL_SIZE_MB}MB.`, variant: "destructive" });
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

  /**
   * Callback acionado pelo FileList após um merge bem-sucedido.
   * Define a URL de download e limpa os arquivos, mudando a UI para a tela de sucesso.
   * @param downloadUrl - A URL pré-assinada do PDF combinado.
   */
  const handleMergeSuccess = (downloadUrl: string) => {
    setMergedPdfUrl(downloadUrl);
    setFiles([]); // Limpa a lista de arquivos para a próxima operação
    // A linha de download automático foi removida, conforme solicitado.
  };

  const handleStartOver = () => {
    setMergedPdfUrl(null);
    setFiles([]);
  };

  return (
    <div className="container mx-auto px-4 py-4 sm:py-12">
      {mergedPdfUrl ? (
        // --- TELA DE DOWNLOAD E SUCESSO ---
        <Card className="p-6 sm:p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">Seus PDFs foram juntados!</h2>
          <p className="text-muted-foreground mb-6">O link para download está disponível. Clique no botão abaixo para baixar.</p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
            <Button asChild size="lg">
              <a href={mergedPdfUrl} download>
                <Download className="mr-2 h-5 w-5" />
                Baixar PDF
              </a>
            </Button>
            <Button onClick={handleStartOver} variant="outline" size="lg">
              <ReplyAll className="mr-2 h-5 w-5" />
              Refazer
            </Button>
          </div>
        </Card>
      ) : (
        // --- TELA DE UPLOAD ---
        <div className="space-y-8 ">
          <div className="text-center space-y-2">
              <div className="flex items-center justify-center gap-3">
                  <h1 className="text-4xl font-bold tracking-tight text-foreground">Juntar Arquivos PDF</h1>
              </div>
              <p className="text-lg text-muted-foreground">Arraste, solte, reordene e junte seus PDFs em um só.</p>
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
