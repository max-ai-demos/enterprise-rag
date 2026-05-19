import React from 'react';
import type { HighlightArea } from '../../types/highlight';
import type { PdfTextSelectionActionPayload, PdfTextSelectionHighlightPayload } from './types';

type SelectionSnapshot = {
  pageNumber: number;
  text: string;
  rangeRect: DOMRect;
  clientRects: DOMRect[];
};

export type PdfTextSelectionOverlayProps = {
  pdfPaneRef: React.RefObject<HTMLElement | null>;
  chatIconSrc?: string;
  onAddHighlight?: (payload: PdfTextSelectionHighlightPayload) => void;
  onAskChat?: (payload: PdfTextSelectionActionPayload) => void;
  onTranslate?: (payload: PdfTextSelectionActionPayload) => void;
  onAddFlowNote?: (payload: PdfTextSelectionActionPayload) => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return clamp(n, 0, 100);
}

function getPageWrapper(node: Node | null) {
  if (!node) return null;
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest?.('[data-pdf-page]') ?? null;
}

function getPageNumberFromWrapper(el: Element | null) {
  if (!el) return null;
  const raw = (el as HTMLElement).dataset?.pdfPage;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function getSelectionSnapshot(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return null;
  const text = selection.toString().trim();
  if (!text) return null;

  const anchorWrapper = getPageWrapper(selection.anchorNode);
  const focusWrapper = getPageWrapper(selection.focusNode);
  if (!anchorWrapper || !focusWrapper || anchorWrapper !== focusWrapper) return null;

  const pageNumber = getPageNumberFromWrapper(anchorWrapper);
  if (!pageNumber) return null;

  const range = selection.getRangeAt(0);
  if (!range || range.collapsed) return null;

  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  if (rects.length === 0) return null;

  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const rangeRect = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));

  return { pageNumber, text, rangeRect, clientRects: rects };
}

function buildHighlightsFromRects(args: {
  pageNumber: number;
  pageEl: HTMLElement;
  rects: DOMRect[];
}): HighlightArea[] {
  const { pageNumber, pageEl, rects } = args;
  const pageRect = pageEl.getBoundingClientRect();
  if (!(pageRect.width > 0 && pageRect.height > 0)) return [];

  const now = Date.now();
  return rects.map((r, idx) => {
    const x = clampPct(((r.left - pageRect.left) / pageRect.width) * 100);
    const y = clampPct(((r.top - pageRect.top) / pageRect.height) * 100);
    const width = clampPct((r.width / pageRect.width) * 100);
    const height = clampPct((r.height / pageRect.height) * 100);
    return {
      id: `sel-${pageNumber}-${now}-${idx}`,
      pageNumber,
      x,
      y,
      width,
      height,
      color: '#FFDD57',
      opacity: 0.28,
    };
  });
}

export function PdfTextSelectionOverlay(props: PdfTextSelectionOverlayProps) {
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);
  const [snapshot, setSnapshot] = React.useState<SelectionSnapshot | null>(null);
  const pendingCommitRef = React.useRef(false);

  React.useEffect(() => {
    const onSelectionChange = () => {
      setSnapshot(null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, []);

  React.useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const toolbarEl = toolbarRef.current;
      if (toolbarEl && e.target instanceof Node && toolbarEl.contains(e.target)) {
        pendingCommitRef.current = false;
        return;
      }
      setSnapshot(null);
      const targetEl = e.target instanceof Element ? e.target : null;
      const inTextLayer = !!targetEl?.closest?.('.react-pdf__Page__textContent, .textLayer');
      pendingCommitRef.current = inTextLayer;
    };

    const onPointerUp = () => {
      if (!pendingCommitRef.current) return;
      pendingCommitRef.current = false;
      queueMicrotask(() => {
        setSnapshot(getSelectionSnapshot());
      });
    };
    const onKeyUp = () => {
      queueMicrotask(() => {
        setSnapshot(getSelectionSnapshot());
      });
    };

    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const anchor = React.useMemo(() => {
    if (!snapshot) return null;
    const cx = snapshot.rangeRect.left + snapshot.rangeRect.width / 2;
    const cy = snapshot.rangeRect.top - 48;
    const margin = 8;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const left = clamp(cx, margin, Math.max(margin, vw - margin));
    const top = Math.max(margin, cy);
    return { left, top };
  }, [snapshot]);

  React.useEffect(() => {
    if (!snapshot) return;
    const pane = props.pdfPaneRef.current;
    const refresh = () => {
      setSnapshot(getSelectionSnapshot());
    };
    window.addEventListener('resize', refresh);
    pane?.addEventListener('scroll', refresh, { passive: true });
    return () => {
      window.removeEventListener('resize', refresh);
      pane?.removeEventListener('scroll', refresh);
    };
  }, [snapshot, props.pdfPaneRef]);

  if (!snapshot || !anchor) return null;

  const payload: PdfTextSelectionActionPayload = { pageNumber: snapshot.pageNumber, text: snapshot.text };

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[90] flex flex-row items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white shadow-lg px-3 py-2"
      style={{ left: anchor.left, top: anchor.top, transform: 'translate(-50%, 0)' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        title="Copy"
        className="flex items-center justify-center w-7 h-7 rounded hover:bg-gray-100 text-xs"
        onClick={() => { void navigator.clipboard.writeText(snapshot.text); }}
      >
        📋
      </button>
      {props.onAddHighlight && (
        <button
          type="button"
          title="Highlight"
          className="flex items-center justify-center w-7 h-7 rounded hover:bg-yellow-50 text-xs"
          onClick={() => {
            const pageEl = document.querySelector<HTMLElement>(
              `[data-pdf-page='${snapshot.pageNumber}'] .pdf-page`,
            );
            if (!pageEl) return;
            const highlights = buildHighlightsFromRects({
              pageNumber: snapshot.pageNumber,
              pageEl,
              rects: snapshot.clientRects,
            });
            if (highlights.length === 0) return;
            props.onAddHighlight?.({ ...payload, highlights });
          }}
        >
          ✏️
        </button>
      )}
      {props.onAskChat && (
        <button
          type="button"
          title="Ask Chat"
          className="flex items-center justify-center gap-1 px-2 h-7 rounded hover:bg-blue-50 text-xs text-blue-600"
          onClick={() => props.onAskChat?.(payload)}
        >
          💬 Chat
        </button>
      )}
    </div>
  );
}
