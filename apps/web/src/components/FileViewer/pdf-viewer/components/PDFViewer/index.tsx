'use client';

// Polyfill for Promise.withResolvers (needed by react-pdf on Node < 22)
if (typeof Promise.withResolvers === 'undefined') {
  (Promise as any).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

import React, { useEffect, useRef, useState, useImperativeHandle, useLayoutEffect, useMemo } from 'react';
import type { ComponentProps } from 'react';
import { Document, pdfjs } from 'react-pdf';
import { PDFViewerProps } from '../../types/PDFViewerProps';
import { PdfProvider, usePdfAction, usePdfRefs, usePdfState } from '../../context/PdfContext';
import { PDF_PAGE_GAP_PX } from '../../const/pdf';
import { PdfThumbnails } from '../PdfThumbnails';
import { PdfToolbar } from '../PdfToolbar';
import { usePdfZoomGestures } from '../../hooks/use-pdf-zoom-gestures';
import { usePdfScroll } from '../../hooks/use-pdf-scroll';
import { useAutoScale } from '../../hooks/use-auto-scale';
import { usePdfReadingState } from '../../hooks/use-pdf-reading-state';
import { PageList } from '../PageList';
import { PdfSearchPanel } from '../PdfSearch';
import { usePdfTextSearch } from '../../hooks/use-pdf-text-search';
import type { HighlightArea } from '../../types/highlight';
import { bboxToHighlightArea, bboxToScrollOffsetTopPx } from '../../utils/highlightIndex';
import { PdfTextSelectionOverlay } from '../PdfTextSelection';
import type { PdfTextSelectionHighlightPayload } from '../PdfTextSelection/types';

const PDFJS_WORKER_URL = 'https://cdn.eu.xxx.ai/frontend/pdfjs/pdf.worker.min.js';
const PDFJS_CMAP_URL = 'https://cdn.eu.xxx.ai/frontend/pdfjs/cmaps/';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '../../styles/pdf-viewer.css';

// Configure pdfjs worker (only on client side)
// Use local worker file from public directory (same as web/xxx-pdf-viewer approach)
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
}

type LoadedDocument = Parameters<NonNullable<ComponentProps<typeof Document>['onLoadSuccess']>>[0];

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; numPages: number };

// formatPercent moved to src/utils/format

export type PDFViewerHandle = {
  searchAndHighlightText: (text: string) => void;
  getPdfDocument: () => unknown | null;
  getPdfInfo: () => { originalWidth: number; originalHeight: number } | null;
};

export const PDFViewer = React.forwardRef(function PDFViewer(
  props: PDFViewerProps,
  ref: React.ForwardedRef<PDFViewerHandle>,
) {
  return (
    <PdfProvider initialShowThumbnails={false} key={props.file}>
      <PDFViewerInner {...props} ref={ref} />
    </PdfProvider>
  );
});

PDFViewer.displayName = 'PDFViewer';

const PDFViewerInner = React.forwardRef(function PDFViewerInner(
  props: PDFViewerProps,
  ref: React.ForwardedRef<PDFViewerHandle>,
) {
  'use no memo';
  const { scale, rotate, showThumbnails, originalHeight, originalWidth, theme } = usePdfState();

  const { setScale, setRotate, setTotalPages, setPdfDocument, setPdfInfo, setShowThumbnails, setTheme } =
    usePdfAction();
  const { pdfDocumentRef, viewerRef, pdfPaneRef } = usePdfRefs();

  const {
    file,
    className,
    highlightText,
    highlightIndex,
    onDocumentLoadSuccess,
    onCurrentPageChange,
    onFileSelect,
    onScrollToPageChange,
    scrollToPage,
    selectedId,
  } = props;

  // 确保所有函数和逻辑都在组件函数内部
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [page, setPage] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [doc, setDoc] = useState<LoadedDocument | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const documentScrollRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectionHighlightsByPage, setSelectionHighlightsByPage] = useState<Record<number, HighlightArea[]>>({});
  const lastHighlightIndexScrollIdRef = useRef<string | null>(null);
  const lastHighlightTextValueRef = useRef<string | undefined>(undefined);
  const lastHighlightTextRunRef = useRef<{ keyword: string; doc: unknown | null } | null>(null);

  const indexHighlightsByPage = React.useMemo<Record<number, HighlightArea[]>>(() => {
    if (!highlightIndex) {
      return {};
    }
    const pageNumber = highlightIndex.index?.page_idx;
    const bbox = highlightIndex.index?.bbox;
    if (!(typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber >= 1)) {
      return {};
    }
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      return {};
    }
    if (!(originalWidth > 0 && originalHeight > 0)) {
      return {};
    }

    const id = `index:${highlightIndex.indexId}`;
    const area = bboxToHighlightArea({
      id,
      pageNumber,
      bbox,
      originalWidth,
      originalHeight,
      color: 'rgba(255,215,0,0.25)',
      opacity: 1,
      border: '2px solid #FFD700',
    });
    if (!area) {
      return {};
    }

    return { [pageNumber]: [area] };
  }, [highlightIndex, originalHeight, originalWidth]);

  // Memoize documentOptions to prevent unnecessary reloads
  const documentOptions = useMemo(
    () => ({
      cMapUrl: PDFJS_CMAP_URL,
      cMapPacked: true,
    }),
    [],
  );

  const handleDownload = React.useCallback(() => {
    if (!file) return;

    if (typeof file === 'string') {
      const a = document.createElement('a');
      a.href = file;
      a.download = 'document.pdf';
      a.rel = 'noopener';
      a.target = '_blank';
      a.click();
      return;
    }

    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.pdf';
    a.rel = 'noopener';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [file]);

  useEffect(() => {
    const target = rootRef.current;
    if (!target) return;
    const handler = () => {
      setIsFullscreen(document.fullscreenElement === target);
    };
    document.addEventListener('fullscreenchange', handler);
    handler();
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // 暴露方法给父组件
  /* eslint-disable react-hooks/immutability */
  useImperativeHandle(ref, () => ({
    searchAndHighlightText: (text: string) => {
      const next = text.trim();
      setShowSearch(true);
      setSearch((prev) => ({ ...prev, inputValue: next }));
      if (next) void runSearch(next);
    },
    getPdfDocument: () => pdfDocumentRef.current,
    getPdfInfo: () => (originalWidth > 0 && originalHeight > 0 ? { originalWidth, originalHeight } : null),
  }));
  /* eslint-enable react-hooks/immutability */

  const numPages = load.status === 'ready' ? load.numPages : 0;

  usePdfZoomGestures({
    containerRef: pdfPaneRef as unknown as React.RefObject<HTMLElement | null>,
    effectiveScale: scale,
    setFitWidth,
    setScale,
    enabled: !!doc,
  });

  const {
    currentPageIndex,
    scrollToPage: scrollToPageVirtual,
    visiblepageIndices,
  } = usePdfScroll({
    containerRef: pdfPaneRef as unknown as React.RefObject<HTMLElement>,
    bufferSize: 5,
  });

  useAutoScale({ enabled: fitWidth });

  async function onLoadSuccess(loaded: LoadedDocument) {
    const pdfPage = await loaded.getPage(1);
    setDoc(loaded);
    setLoad({ status: 'ready', numPages: loaded.numPages });
    const viewport = pdfPage.getViewport({ scale: 1 });
    setPdfInfo({
      originalWidth: viewport.width,
      originalHeight: viewport.height,
    });
    setTotalPages(loaded.numPages);
    setPdfDocument(loaded);
    onDocumentLoadSuccess?.(loaded.numPages);
  }

  function onLoadError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setLoad({ status: 'error', message });
  }

  const scrollToPageInView = React.useCallback(
    (pageNumber: number, behavior: ScrollBehavior = 'auto', offsetTop: number = 0) => {
      const clamped = Math.max(1, Math.min(numPages || 1, pageNumber));
      scrollToPageVirtual(clamped, behavior, offsetTop);
    },
    [numPages, scrollToPageVirtual],
  );

  const scrollToPageInViewSmooth = React.useCallback(
    (pageNumber: number) => {
      scrollToPageInView(pageNumber, 'smooth');
    },
    [scrollToPageInView],
  );

  const scrollToPageInViewSmoothWithOffset = React.useCallback(
    (pageNumber: number, offsetTop: number) => {
      scrollToPageInView(pageNumber, 'smooth', offsetTop);
    },
    [scrollToPageInView],
  );

  useEffect(() => {
    if (!highlightIndex) {
      lastHighlightIndexScrollIdRef.current = null;
      return;
    }
    const pageNumber = highlightIndex.index?.page_idx;
    if (!(typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber >= 1)) return;
    if (numPages <= 0) return;

    const targetId = `index:${highlightIndex.indexId}`;
    if (lastHighlightIndexScrollIdRef.current === targetId) return;
    lastHighlightIndexScrollIdRef.current = targetId;

    const bbox = highlightIndex.index?.bbox;
    const offsetTop =
      Array.isArray(bbox) && bbox.length === 4 ? bboxToScrollOffsetTopPx({ bbox, originalHeight, scale }) : 0;

    scrollToPageInViewSmoothWithOffset(pageNumber, offsetTop);
  }, [highlightIndex, numPages, originalHeight, scale, scrollToPageInViewSmoothWithOffset]);

  const {
    showSearch,
    setShowSearch,
    search,
    setSearch,
    submitSearch,
    runSearch,
    selectSearchResult,
    showMoreForPage,
    resetSearch,
    toggleSearchPanel,
  } = usePdfTextSearch({
    doc,
    pdfPaneRef: pdfPaneRef as unknown as React.RefObject<HTMLElement | null>,
    scrollToPage: scrollToPageInViewSmooth,
    inputRef: searchInputRef,
  });

  // 处理 highlightText prop（外部传入的搜索文本）
  useEffect(() => {
    if (highlightText === undefined) return;

    const nextValue = highlightText;
    // Normalize whitespace: chunk_text from backend uses \n between lines,
    // but PDFJS page text is built with spaces between text items
    const keyword = nextValue.trim().replace(/\s+/g, ' ');
    const propChanged = lastHighlightTextValueRef.current !== nextValue;

    if (propChanged) {
      lastHighlightTextValueRef.current = nextValue;
      setSearch((prev) => ({ ...prev, inputValue: keyword }));
    }

    if (!keyword) {
      if (propChanged) {
        resetSearch({ closePanel: false }); // 不关闭面板，让用户手动控制
      }
      lastHighlightTextRunRef.current = null;
      return;
    }

    // lastHighlightTextRunRef deduplicates: skip if same keyword AND same doc instance
    // (doc changes when PDF reloads; null doc means search was attempted before PDF was ready)
    const lastRun = lastHighlightTextRunRef.current;
    if (lastRun && lastRun.keyword === keyword && lastRun.doc === doc) return;
    lastHighlightTextRunRef.current = { keyword, doc };
    void runSearch(keyword);
  }, [doc, highlightText, resetSearch, runSearch, setSearch]);

  const leftPanelOpen = showThumbnails || showSearch;
  const leftPanelWidth = (showThumbnails ? 120 : 0) + (showSearch ? 192 : 0);

  const prevZoomAnchorRef = useRef<{
    scale: number;
    rotate: number;
    pageHeight: number;
    pageWidth: number;
  } | null>(null);
  const suppressPageSyncRef = useRef(false);

  useEffect(() => {
    prevZoomAnchorRef.current = null;
  }, [file]);

  useEffect(() => {
    setDoc(null);
    setPdfDocument(null);
    setPdfInfo(null);
    setLoad(file ? { status: 'loading' } : { status: 'idle' });
    setPage(1);
    setTotalPages(0);
    setFitWidth(true);
    resetSearch({ closePanel: true });
  }, [file, resetSearch, setPdfDocument, setPdfInfo, setTotalPages]);

  const { restoring: restoringReadingState } = usePdfReadingState({
    file,
    selectedId,
    ready: load.status === 'ready',
    page,
    setPage,
    scale,
    setScale,
    rotate,
    setRotate,
    fitWidth,
    setFitWidth,
    theme,
    setTheme,
    containerRef: pdfPaneRef,
    xScrollRef: pdfPaneRef,
  });

  useLayoutEffect(() => {
    const root = pdfPaneRef.current;
    if (!root) return;
    if (restoringReadingState) return;
    if (numPages <= 0) return;
    if (!(originalWidth > 0 && originalHeight > 0)) return;

    const skipForScale = (root as unknown as { __sprSkipScaleSyncForScale?: unknown }).__sprSkipScaleSyncForScale;
    if (typeof skipForScale === 'number' && Number.isFinite(skipForScale) && Math.abs(skipForScale - scale) < 1e-4) {
      delete (root as unknown as { __sprSkipScaleSyncForScale?: unknown }).__sprSkipScaleSyncForScale;
      return;
    }

    const normalizedRotate = ((rotate % 360) + 360) % 360;
    const isRotated = normalizedRotate === 90 || normalizedRotate === 270;
    const baseHeight = isRotated ? originalWidth : originalHeight;
    const baseWidth = isRotated ? originalHeight : originalWidth;
    const pageHeight = baseHeight * scale;
    const pageWidth = baseWidth * scale;
    const prev = prevZoomAnchorRef.current;
    prevZoomAnchorRef.current = { scale, rotate, pageHeight, pageWidth };

    if (!prev) return;
    if (Math.abs(prev.scale - scale) < 1e-6 && prev.rotate === rotate) return;

    const prevStride = prev.pageHeight + PDF_PAGE_GAP_PX;
    const nextStride = pageHeight + PDF_PAGE_GAP_PX;
    if (!(prevStride > 0 && nextStride > 0)) return;

    suppressPageSyncRef.current = true;
    window.requestAnimationFrame(() => {
      suppressPageSyncRef.current = false;
    });

    const topRatio = root.scrollTop / prevStride;
    const nextTop = topRatio * nextStride;
    const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
    const clampedTop = Math.max(0, Math.min(maxTop, nextTop));

    const leftRatio = prev.pageWidth > 0 ? root.scrollLeft / prev.pageWidth : 0;
    const nextLeft = leftRatio * pageWidth;
    const maxLeft = Math.max(0, root.scrollWidth - root.clientWidth);
    const clampedLeft = Math.max(0, Math.min(maxLeft, nextLeft));

    root.scrollTo({ top: clampedTop, left: clampedLeft, behavior: 'auto' });
  }, [numPages, originalHeight, originalWidth, pdfPaneRef, restoringReadingState, rotate, scale]);

  const handleAddHighlight = React.useCallback(
    (payload: PdfTextSelectionHighlightPayload) => {
      setSelectionHighlightsByPage((prev) => ({
        ...prev,
        [payload.pageNumber]: [...(prev[payload.pageNumber] ?? []), ...payload.highlights],
      }));
      props.onSelectionHighlight?.({
        pageNumber: payload.pageNumber,
        text: payload.text,
      });
    },
    [props],
  );

  const toggleThumbnailsPanel = React.useCallback(() => {
    setShowThumbnails((prev) => !prev);
  }, [setShowThumbnails]);

  useEffect(() => {
    if (!scrollToPage) return;
    if (numPages <= 0) return;
    scrollToPageInView(scrollToPage, 'smooth');
    onScrollToPageChange?.(scrollToPage);
  }, [numPages, onScrollToPageChange, scrollToPage, scrollToPageInView]);

  useEffect(() => {
    onCurrentPageChange?.(page);
  }, [onCurrentPageChange, page]);

  useEffect(() => {
    if (numPages <= 0) return;
    if (restoringReadingState) return;
    if (suppressPageSyncRef.current) return;
    const next = currentPageIndex + 1;
    setPage((prev) => (prev === next ? prev : next));
  }, [currentPageIndex, numPages, restoringReadingState]);

  if (!file) {
    return (
      <div className="h-full grid place-content-center gap-2 text-slate-200">
        <div className="text-sm font-semibold">No PDF loaded</div>
        <div className="text-xs text-slate-400">Enter a URL or select a file</div>
      </div>
    );
  }

  const toggleFullscreen = async () => {
    const target = rootRef.current;
    if (!target) return;
    if (!document.fullscreenEnabled) return;

    if (document.fullscreenElement === target) {
      await document.exitFullscreen();
      return;
    }

    await target.requestFullscreen();
  };

  return (
    <div ref={rootRef} className={`h-full flex overflow-hidden bg-white ${className}`}>
      <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-white">
        <PdfToolbar
          page={page}
          numPages={numPages}
          effectiveScale={scale}
          onPrev={() => scrollToPageInView(page - 1)}
          onNext={() => scrollToPageInView(page + 1)}
          onPageChange={(p) => scrollToPageInView(p, 'smooth')}
          fitWidth={fitWidth}
          onFitWidth={() => setFitWidth(true)}
          onToggleFitWidth={() => setFitWidth((v) => !v)}
          onDisableFitWidth={() => setFitWidth(false)}
          isFullscreen={isFullscreen}
          leftPanelOpen={leftPanelOpen}
          thumbnailsActive={showThumbnails}
          onToggleThumbnails={toggleThumbnailsPanel}
          searchActive={showSearch}
          onToggleSearch={toggleSearchPanel}
          onToggleFullscreen={
            typeof document !== 'undefined' && document.fullscreenEnabled
              ? () => {
                  void toggleFullscreen();
                }
              : undefined
          }
          onDownload={file ? handleDownload : undefined}
        />

        <div
          ref={viewerRef}
          className={`flex flex-1 min-h-0 overflow-hidden px-4 pt-2 pb-1 ${theme === 'dark' ? 'bg-neutral-800/50' : ''}`}
        >
          <div
            className={[
              'shrink-0 overflow-hidden transition-[width,opacity,transform] duration-200 ease-out will-change-transform',
              leftPanelOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 pointer-events-none',
            ].join(' ')}
            aria-hidden={!leftPanelOpen}
            style={{ width: leftPanelOpen ? `${leftPanelWidth}px` : '0px' }}
          >
            <div className="h-full flex">
              <div
                className={[
                  'h-full overflow-hidden transition-[width,opacity,transform] duration-200 ease-out will-change-transform',
                  showThumbnails
                    ? 'w-[120px] opacity-100 translate-x-0'
                    : 'w-0 opacity-0 -translate-x-2 pointer-events-none border-r-0',
                ].join(' ')}
                aria-hidden={!showThumbnails}
              >
                <div className="w-[120px] h-full">
                  <PdfThumbnails
                    className="overflow-hidden flex flex-col min-h-0 h-full"
                    pdf={doc}
                    numPages={numPages}
                    activePage={page}
                    onSelectPage={(p) => scrollToPageInView(p, 'auto')}
                    originalWidth={originalWidth}
                    originalHeight={originalHeight}
                  />
                </div>
              </div>

              <div
                className={[
                  'h-full overflow-hidden transition-[width,opacity,transform] duration-200 ease-out will-change-transform',
                  showSearch
                    ? 'w-[192px] opacity-100 translate-x-0'
                    : 'w-0 opacity-0 -translate-x-2 pointer-events-none border-r-0',
                ].join(' ')}
                aria-hidden={!showSearch}
              >
                <div className={`w-[192px] h-full ${theme === 'dark' ? 'bg-[#222222]' : ''}`}>
                  <PdfSearchPanel
                    inputRef={searchInputRef}
                    inputValue={search.inputValue}
                    onInputChange={(next) => setSearch((prev) => ({ ...prev, inputValue: next }))}
                    onSubmit={submitSearch}
                    status={search.status}
                    lastSubmitted={search.lastSubmitted}
                    totalHits={search.totalHits}
                    resultsByPage={search.resultsByPage}
                    shownCountByPage={search.shownCountByPage}
                    onShowMore={showMoreForPage}
                    selected={search.selected}
                    onSelectResult={selectSearchResult}
                  />
                </div>
              </div>
            </div>
          </div>

          <div
            ref={pdfPaneRef}
            className="pdf-container min-w-0 flex-1 overflow-auto"
            style={{ willChange: 'scroll-position', borderRadius: '8px' }}
          >
            <div className="relative h-full">
              <Document
                file={file}
                loading={
                  <div className="flex items-center justify-center h-full w-full min-h-full absolute left-0 right-0 top-0 bottom-0">
                    <div className="flex items-center justify-center h-full w-full text-slate-400 text-sm">Loading…</div>
                  </div>
                }
                className={'min-h-full'}
                error={<div className="text-red-300 p-4">Failed to load PDF.</div>}
                onLoadSuccess={onLoadSuccess}
                onLoadError={onLoadError}
                externalLinkTarget="_blank"
                options={documentOptions}
                inputRef={(ref) => {
                  documentScrollRef.current = ref;
                  if (ref) {
                    ref.style.setProperty('--scale-factor', scale.toString());
                    ref.style.setProperty('--pdf-origin-width', originalWidth > 0 ? originalWidth.toString() : '');
                    ref.style.setProperty('--pdf-origin-height', originalHeight > 0 ? originalHeight.toString() : '');
                  }
                }}
              >
                {load.status === 'error' ? (
                  <div className="text-red-300 p-4">{load.message}</div>
                ) : (
                  <PageList
                    visiblepageIndices={visiblepageIndices}
                    searchHighlightsByPage={search.highlightsByPage}
                    searchSelected={search.selected}
                    selectionHighlightsByPage={selectionHighlightsByPage}
                    indexHighlightsByPage={indexHighlightsByPage}
                  />
                )}
              </Document>
            </div>

            {/* 文本选择工具栏 */}
            <PdfTextSelectionOverlay
              pdfPaneRef={pdfPaneRef}
              chatIconSrc="/cdn/common/tool/ai-chat.png"
              onAddHighlight={handleAddHighlight}
              onAskChat={props.onSelectionAskChat}
              onTranslate={props.onSelectionTranslate}
              onAddFlowNote={props.onSelectionAddFlowNote}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
