import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { clamp } from '../utils/number';
import { normalizeRotate } from '../utils/rotate';

export type PdfInfo = {
  originalWidth: number;
  originalHeight: number;
};

export type PdfTheme = 'light' | 'dark';

export type PdfState = {
  originalWidth: number;
  originalHeight: number;
  scale: number;
  showThumbnails: boolean;
  rotate: number;
  totalPages: number;
  viewerWidth: number;
  pdfPaneWidth: number;
  theme: PdfTheme;
};

export type PdfRefs = {
  pdfDocumentRef: React.MutableRefObject<unknown | null>;
  viewerRef: React.MutableRefObject<HTMLDivElement | null>;
  pdfPaneRef: React.MutableRefObject<HTMLDivElement | null>;
};

export type PdfActions = {
  scale: number;
  setScale: (next: number | ((prev: number) => number)) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  theme: PdfTheme;
  setTheme: (next: PdfTheme | ((prev: PdfTheme) => PdfTheme)) => void;
  toggleTheme: () => void;

  showThumbnails: boolean;
  setShowThumbnails: (next: boolean | ((prev: boolean) => boolean)) => void;
  toggleThumbnails: () => void;

  rotate: number;
  setRotate: (next: number | ((prev: number) => number)) => void;
  rotateLeft: () => void;
  rotateRight: () => void;
  resetRotate: () => void;

  totalPages: number;
  setTotalPages: (next: number) => void;

  setPdfDocument: (doc: unknown | null) => void;
  setPdfInfo: (info: PdfInfo | null) => void;
};

export type PdfContextValue = PdfState & PdfActions & PdfRefs;

export type PdfProviderProps = {
  children: React.ReactNode;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  scaleStep?: number;
  initialShowThumbnails?: boolean;
  initialRotate?: number;
  initialTheme?: PdfTheme;
};

const PdfStateContext = createContext<PdfState | null>(null);
const PdfActionsContext = createContext<PdfActions | null>(null);
const PdfRefsContext = createContext<PdfRefs | null>(null);

function useElementWidthRef<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number>(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Wrap callback in requestAnimationFrame to prevent "ResizeObserver loop" errors
    const ro = new ResizeObserver((entries) => {
      window.requestAnimationFrame(() => {
        const entry = entries[0];
        if (!entry) return;
        setWidth(entry.contentRect.width);
      });
    });
    ro.observe(element);
    return () => ro.disconnect();
  }, []);

  return { ref, width } as const;
}

export function PdfProvider({
  children,
  initialScale = 1,
  minScale = 0.25,
  maxScale = 3,
  scaleStep = 0.1,
  initialShowThumbnails = false,
  initialRotate = 0,
  initialTheme = 'light',
}: PdfProviderProps) {
  'use no memo';
  const [scale, _setScale] = useState(() => clamp(initialScale, minScale, maxScale));
  const [showThumbnails, setShowThumbnails] = useState(initialShowThumbnails);
  const [rotate, _setRotate] = useState(() => normalizeRotate(initialRotate));
  const [totalPages, setTotalPages] = useState(0);
  const [pdfInfo, setPdfInfoState] = useState<PdfInfo | null>(null);
  const [theme, setTheme] = useState<PdfTheme>(initialTheme);

  const pdfDocumentRef = useRef<unknown | null>(null);
  const { ref: viewerRef, width: viewerWidth } = useElementWidthRef<HTMLDivElement>();
  const { ref: pdfPaneRef, width: pdfPaneWidth } = useElementWidthRef<HTMLDivElement>();

  const setScale = useCallback<PdfActions['setScale']>(
    (next) => {
      _setScale((prev) => {
        const candidate = typeof next === 'function' ? next(prev) : next;
        return clamp(candidate, minScale, maxScale);
      });
    },
    [maxScale, minScale],
  );

  const zoomIn = useCallback(() => setScale((s) => s + scaleStep), [scaleStep, setScale]);
  const zoomOut = useCallback(() => setScale((s) => s - scaleStep), [scaleStep, setScale]);
  const resetZoom = useCallback(() => setScale(initialScale), [initialScale, setScale]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const toggleThumbnails = useCallback(() => setShowThumbnails((v) => !v), []);

  const setRotate = useCallback<PdfActions['setRotate']>((next) => {
    _setRotate((prev) => {
      const candidate = typeof next === 'function' ? next(prev) : next;
      return normalizeRotate(candidate);
    });
  }, []);

  const rotateLeft = useCallback(() => setRotate((r) => r - 90), [setRotate]);
  const rotateRight = useCallback(() => setRotate((r) => r + 90), [setRotate]);
  const resetRotate = useCallback(() => setRotate(initialRotate), [initialRotate, setRotate]);

  const setPdfDocument = useCallback((doc: unknown | null) => {
    pdfDocumentRef.current = doc;
  }, []);

  const setPdfInfo = useCallback((info: PdfInfo | null) => {
    setPdfInfoState(info);
  }, []);

  const state = useMemo<PdfState>(
    () => ({
      originalWidth: pdfInfo?.originalWidth ?? 0,
      originalHeight: pdfInfo?.originalHeight ?? 0,
      scale,
      showThumbnails,
      rotate,
      totalPages,
      viewerWidth,
      pdfPaneWidth,
      theme,
    }),
    [pdfInfo, pdfPaneWidth, rotate, scale, showThumbnails, theme, totalPages, viewerWidth],
  );

  const refs = useMemo<PdfRefs>(() => ({ pdfDocumentRef, viewerRef, pdfPaneRef }), []); // eslint-disable-line react-hooks/preserve-manual-memoization

  const actions = useMemo<PdfActions>(
    () => ({
      scale,
      setScale,
      zoomIn,
      zoomOut,
      resetZoom,
      theme,
      setTheme,
      toggleTheme,
      showThumbnails,
      setShowThumbnails,
      toggleThumbnails,
      rotate,
      setRotate,
      rotateLeft,
      rotateRight,
      resetRotate,
      totalPages,
      setTotalPages,
      setPdfDocument,
      setPdfInfo,
    }),
    [
      resetRotate,
      resetZoom,
      rotate,
      rotateLeft,
      rotateRight,
      scale,
      setPdfDocument,
      setPdfInfo,
      setRotate,
      setScale,
      setShowThumbnails,
      setTheme,
      showThumbnails,
      theme,
      toggleThumbnails,
      toggleTheme,
      totalPages,
      zoomIn,
      zoomOut,
    ],
  );

  return (
    <PdfStateContext.Provider value={state}>
      <PdfActionsContext.Provider value={actions}>
        <PdfRefsContext.Provider value={refs}>{children}</PdfRefsContext.Provider>
      </PdfActionsContext.Provider>
    </PdfStateContext.Provider>
  );
}

export function usePdfContext() {
  const state = useContext(PdfStateContext);
  const actions = useContext(PdfActionsContext);
  const refs = useContext(PdfRefsContext);
  if (!state || !actions || !refs) throw new Error('usePdfContext must be used within <PdfProvider>.');
  return { ...state, ...actions, ...refs } satisfies PdfContextValue;
}

export function usePdfState() {
  const state = useContext(PdfStateContext);
  if (!state) throw new Error('usePdfState must be used within <PdfProvider>.');
  return state;
}

export function usePdfAction() {
  const actions = useContext(PdfActionsContext);
  if (!actions) throw new Error('usePdfAction must be used within <PdfProvider>.');
  return actions;
}

export function usePdfRefs() {
  const refs = useContext(PdfRefsContext);
  if (!refs) throw new Error('usePdfRefs must be used within <PdfProvider>.');
  return refs;
}
