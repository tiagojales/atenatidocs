"use client";

import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

type FileUploadProps = {
  onFilesSelected: (files: File[]) => void;
};

/**
 * A client component that provides a drag-and-drop zone and a clickable area
 * for users to select files from their local device.
 */
export function FileUpload({ onFilesSelected }: FileUploadProps) {
  // --- STATE MANAGEMENT ---
  // State to track if a file is being dragged over the drop zone for visual feedback.
  const [isDragging, setIsDragging] = useState(false);
  // A ref to the hidden file input element, used to trigger it programmatically.
  const inputRef = useRef<HTMLInputElement>(null);

  // --- DRAG-AND-DROP EVENT HANDLERS ---

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging state if files are being dragged.
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
    e.preventDefault(); // This is crucial to allow a 'drop' event to fire.
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Extract files from the drop event and pass them up to the parent component.
    const files = Array.from(e.dataTransfer.files);
    if (files && files.length > 0) {
      onFilesSelected(files);
    }
  };

  // --- FILE INPUT EVENT HANDLER ---

  /**
   * Handles file selection when the user clicks the drop zone and uses the native file browser.
   */
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files && files.length > 0) {
      onFilesSelected(files);
    }

    // --- IMPORTANT ---
    // Reset the input's value after selection. This is crucial because the `onChange` event
    // will not fire if the user selects the same file again after removing it.
    // Clearing the value ensures the event will always trigger.
    if(inputRef.current) {
        inputRef.current.value = "";
    }
  };

  // --- RENDER LOGIC ---

  return (
    <div
      // Make the entire div clickable to trigger the hidden file input.
      onClick={() => inputRef.current?.click()}
      // Attach all necessary drag-and-drop event handlers.
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "relative flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-input p-12 text-center transition-colors duration-300",
        // Dynamically change border and background color when a file is being dragged over the component.
        isDragging
          ? "border-primary bg-primary/10"
          : "hover:border-primary/50 hover:bg-primary/5"
      )}
    >
      {/* The actual file input is hidden from view and controlled by the ref. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf"
        className="hidden"
        onChange={handleFileSelect}
      />
      
      {/* Visual prompt for the user. */}
      <UploadCloud className="mb-4 h-12 w-12 text-primary/80" />
      <p className="text-lg font-semibold text-foreground">
        Arraste e solte os PDFs aqui
      </p>
      <p className="text-muted-foreground">Ou clique para selecionar no seu dispositivo</p>
    </div>
  );
}
