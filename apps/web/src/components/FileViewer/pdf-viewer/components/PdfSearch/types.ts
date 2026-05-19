import type React from 'react';

export type PdfSearchResultItem = {
  id: string;
  pageNumber: number;
  hitOrdinal: number;
  snippet: string;
};

export type PdfSearchPanelProps = {
  inputValue: string;
  onInputChange: (next: string) => void;
  onSubmit: () => void;
  status: 'idle' | 'loading' | 'ready';
  lastSubmitted: string | null;
  totalHits: number | null;
  resultsByPage: Record<number, PdfSearchResultItem[]>;
  shownCountByPage: Record<number, number>;
  onShowMore: (pageNumber: number) => void;
  selected: { pageNumber: number; hitOrdinal: number } | null;
  onSelectResult: (pageNumber: number, hitOrdinal: number) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
};
