import { FileText } from "lucide-react";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A specialized icon component for representing PDF files.
 * It uses the `FileText` icon from `lucide-react` and applies a
 * default 'destructive' (red) color to match the common association with PDFs.
 * @param {LucideProps} props - Standard lucide-react props.
 */
export function PdfIcon(props: LucideProps) {
  return (
    <FileText
      {...props}
      className={cn("text-destructive", props.className)}
    />
  );
}
