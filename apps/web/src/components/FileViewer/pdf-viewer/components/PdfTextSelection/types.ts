import type { HighlightArea } from '../../types/highlight';

export type PdfTextSelectionActionPayload = {
  pageNumber: number;
  text: string;
};

export type PdfTextSelectionHighlightPayload = PdfTextSelectionActionPayload & {
  highlights: HighlightArea[];
};
