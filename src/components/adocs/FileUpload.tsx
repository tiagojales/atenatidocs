"use client";

import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

type FileUploadProps = {
  /**
   * A callback function that gets invoked with an array of File objects
   * whenever the user selects files, either via drag-and-drop or the file input dialog.
   */
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
  // --- STATE AND REFS ---

  /**
   * State to track whether a file is currently being dragged over the component.
   * This is used to apply dynamic styling (e.g., highlighting the drop zone)
   * to provide visual feedback to the user.
   */
  const [isDragging, setIsDragging] = useState(false);

  /**
   * A React ref attached to the hidden file input element. Using a ref allows us
   * to programmatically trigger the input's click event (opening the file dialog)
   * when the user clicks on the styled `div`, without directly showing the
   * un-stylable native file input element.
   */
  const inputRef = useRef<HTMLInputElement>(null);

  // --- DRAG-AND-DROP EVENT HANDLERS ---

  /**
   * Handles the `dragenter` event. It fires when a dragged item enters the drop zone.
   * We prevent the browser's default behavior and check if files are being dragged
   * before setting the `isDragging` state to true.
   */
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // Prevents the browser from opening the file itself.
    e.stopPropagation(); // Stops the event from bubbling up to parent elements.
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  /**
   * Handles the `dragleave` event. It fires when a dragged item leaves the drop zone.
   * This resets the `isDragging` state to remove the visual feedback.
   */
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  /**
   * Handles the `dragover` event. It fires continuously as a dragged item is moved
   * over the drop zone. Calling `preventDefault` here is essential; it signals to
   * the browser that this element is a valid drop target, which allows the `drop` event to fire.
   */
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // This is the key to making the element a drop target.
    e.stopPropagation();
  };

  /**
   * Handles the `drop` event. It fires when a dragged item is released over the drop zone.
   * We extract the file(s) from the event's `dataTransfer` object and pass them
   * to the parent component via the `onFilesSelected` callback.
   */
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false); // Reset visual state.

    const files = Array.from(e.dataTransfer.files);
    if (files && files.length > 0) {
      onFilesSelected(files);
    }
  };

  // --- FILE INPUT EVENT HANDLER ---

  /**
   * Handles the `change` event on the hidden file input. This is triggered when
   * the user selects files through the native file browser dialog.
   */
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesSelected(files);
    }

    // --- CRITICAL ---
    // The file input's `onChange` event only fires when its `value` (the selected file path)
    // changes. If a user selects a file, removes it from our app's UI, and then tries to
    // select the *exact same file* again, the `onChange` event won't fire because the input's
    // internal value hasn't changed.
    // By programmatically clearing the input's value after every selection, we ensure that
    // the `onChange` event will reliably fire every single time a selection is made.
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  // --- RENDER LOGIC ---

  return (
    <div
      // Programmatically trigger the hidden file input when this div is clicked.
      onClick={() => inputRef.current?.click()}
      // Attach all necessary event handlers for a complete drag-and-drop experience.
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "relative flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-input p-12 text-center transition-colors duration-300",
        // The `cn` utility merges Tailwind classes and handles conditional classes gracefully.
        // Here, we apply a different border and background color when `isDragging` is true,
        // providing clear visual feedback to the user that they are over a valid drop target.
        isDragging
          ? "border-primary bg-primary/10"
          : "hover:border-primary/50 hover:bg-primary/5"
      )}
    >
      {/* The actual file input is hidden from view and controlled entirely by the ref.
          - `multiple`: Allows the user to select more than one file.
          - `accept`: Restricts the file dialog to only show PDF files. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Visual prompt for the user, indicating the component's functionality. */}
      <UploadCloud className="mb-4 h-12 w-12 text-primary/80" />
      <p className="text-lg font-semibold text-foreground">
        Arraste e solte os arquivos PDF aqui
      </p>
      <p className="text-muted-foreground">Ou clique para selecionar em seu dispositivo</p>
    </div>
  );
}
