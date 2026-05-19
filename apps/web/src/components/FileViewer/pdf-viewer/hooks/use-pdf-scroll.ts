import { useMemo, useCallback, useState, useEffect } from 'react';
import { usePdfState } from '../context/PdfContext';
import { PDF_PAGE_GAP_PX } from '../const/pdf';
import { clamp } from '../utils/number';

interface UsePdfScrollOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  /** The number of pages to render in advance. */
  bufferSize: number;
}

interface UsePdfScrollResult {
  /** The indices of the currently visible pages. */
  visiblepageIndices: number[];
  /** The top position of the container. */
  top: number;
  /** The height of the container. */
  currentPageIndex: number;
  /** The height of the container. */
  pageHeight: number;
  /** The function to scroll to a specific page. */
  scrollToPage: (pageNumber: number, behavior?: ScrollBehavior, offsetTop?: number) => void;
  /** The function to get the current page index. */
  getCurrentPageIndex: () => number;
}

/** Lightweight replacement for ahooks/useScroll */
function useScrollTop(containerRef: React.RefObject<HTMLElement | null>): number {
  const [top, setTop] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setTop(el.scrollTop);
    const handler = () => setTop(el.scrollTop);
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef.current]);

  return top;
}

export const usePdfScroll = ({ containerRef, bufferSize = 5 }: UsePdfScrollOptions): UsePdfScrollResult => {
  'use no memo';
  const { scale, rotate, totalPages, originalWidth, originalHeight } = usePdfState();

  const top = useScrollTop(containerRef);

  // Avoid off-by-one page index when scrollTop lands extremely close to a page boundary due to floating-point rounding.
  const SCROLL_EPS_PX = 0.5;

  const pageHeight = useMemo(() => {
    if (!(originalWidth > 0 && originalHeight > 0)) return 0;

    const normalizedRotate = ((rotate % 360) + 360) % 360;
    const baseHeight = normalizedRotate === 90 || normalizedRotate === 270 ? originalWidth : originalHeight;

    return Math.max(0, baseHeight * scale);
  }, [originalHeight, originalWidth, rotate, scale]);

  const pageStride = Math.max(1, pageHeight + PDF_PAGE_GAP_PX);

  const currentPageIndex = useMemo(() => {
    if (totalPages <= 0) return 0;
    const idx = Math.floor((top + SCROLL_EPS_PX) / pageStride);
    return Math.max(0, Math.min(totalPages - 1, idx));
  }, [pageStride, top, totalPages]);

  const visiblepageIndices = useMemo(() => {
    if (totalPages <= 0) return [];

    const containerHeight = containerRef.current?.clientHeight ?? 0;
    const firstVisible = Math.floor((top + SCROLL_EPS_PX) / pageStride);
    const lastVisible = Math.floor((top + Math.max(0, containerHeight - SCROLL_EPS_PX)) / pageStride);

    const start = Math.max(0, firstVisible - bufferSize);
    const end = Math.min(totalPages - 1, lastVisible + bufferSize);
    if (end < start) return [];

    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [bufferSize, containerRef, pageStride, top, totalPages]);

  const scrollToPage = useCallback(
    (pageNumber: number, behavior: ScrollBehavior = 'smooth', offsetTop: number = 0) => {
      const root = containerRef.current;
      if (!root) return;
      if (totalPages <= 0) return;

      const nextIndex = Math.max(0, Math.min(totalPages - 1, pageNumber - 1));
      const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
      const targetTop = nextIndex * pageStride + (Number.isFinite(offsetTop) ? offsetTop : 0);
      root.scrollTo({ top: clamp(targetTop, 0, maxTop), behavior });
    },
    [containerRef, pageStride, totalPages],
  );

  const getCurrentPageIndex = useCallback(() => currentPageIndex, [currentPageIndex]);

  return {
    visiblepageIndices,
    top,
    currentPageIndex,
    pageHeight,
    scrollToPage,
    getCurrentPageIndex,
  };
};
