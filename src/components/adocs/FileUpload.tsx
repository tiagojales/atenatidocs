"use client";

import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

type FileUploadProps = {
  onFilesSelected: (files: File[]) => void;
};

/**
 * @file This file defines the FileUpload component, a client-side "presentational" component.
 * Its sole responsibility is to provide a user interface for selecting files. It handles
 * both drag-and-drop and standard file input clicks.
 *
 * This component is designed to be "dumb" - it doesn't know about the application's
 * business logic (like uploading or merging). It simply captures the user's file
 * selections and passes them up to its parent component via the `onFilesSelected` prop.
 * This promotes reusability and a clean separation of concerns.
 */
export function FileUpload({ onFilesSelected }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files && files.length > 0) {
      onFilesSelected(files);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesSelected(files);
    }

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "relative flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-input p-12 text-center transition-colors duration-300",
        isDragging
          ? "border-primary bg-primary/10"
          : "hover:border-primary/50 hover:bg-primary/5"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf"
        className="hidden"
        onChange={handleFileSelect}
      />

      <UploadCloud className="mb-4 h-12 w-12 text-primary/80" />
      <p className="text-lg font-semibold text-foreground">
        Arraste e solte os PDFs aqui
      </p>
      <p className="text-muted-foreground">Ou clique para selecionar os arquivos</p>
    </div>
  );
}
