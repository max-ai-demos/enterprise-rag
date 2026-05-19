import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { normalizeRotate } from '../utils/rotate';

type PersistedPdfReadingStateV1 = {
  v: 1;
  page: number;
  scale: number;
  rotate: number;
  scrollTop: number;
  scrollLeft: number;
  fitWidth: boolean;
  theme: 'light' | 'dark';
  updatedAt: number;
};

const STORAGE_PREFIX = 'spr:pdf:reading-state:v1:';

function makeDocFingerprint(file: File | string) {
  if (typeof file === 'string') return file;
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function getStorageKey(file: File | string | null | undefined, selectedId?: number) {
  if (!file) return null;
  const idPart = typeof selectedId === 'number' ? `id:${selectedId}` : 'id:-';
  const fingerprint = makeDocFingerprint(file);
  return `${STORAGE_PREFIX}${idPart}:${fingerprint}`;
}

function readState(key: string): PersistedPdfReadingStateV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const v = (parsed as { v?: unknown }).v;
    if (v !== 1) return null;
    const page = (parsed as { page?: unknown }).page;
    const scale = (parsed as { scale?: unknown }).scale;
    const rotate = (parsed as { rotate?: unknown }).rotate;
    const scrollTop = (parsed as { scrollTop?: unknown }).scrollTop;
    const scrollLeftRaw = (parsed as { scrollLeft?: unknown }).scrollLeft;
    const fitWidth = (parsed as { fitWidth?: unknown }).fitWidth;
    const theme = (parsed as { theme?: unknown }).theme;
    const updatedAt = (parsed as { updatedAt?: unknown }).updatedAt;

    const scrollLeft = scrollLeftRaw === undefined ? 0 : scrollLeftRaw;

    if (
      typeof page !== 'number' ||
      !Number.isFinite(page) ||
      page < 1 ||
      typeof scale !== 'number' ||
      !Number.isFinite(scale) ||
      scale <= 0 ||
      typeof rotate !== 'number' ||
      !Number.isFinite(rotate) ||
      typeof scrollTop !== 'number' ||
      !Number.isFinite(scrollTop) ||
      scrollTop < 0 ||
      typeof scrollLeft !== 'number' ||
      !Number.isFinite(scrollLeft) ||
      scrollLeft < 0 ||
      typeof fitWidth !== 'boolean' ||
      (theme !== undefined && theme !== 'light' && theme !== 'dark') ||
      typeof updatedAt !== 'number' ||
      !Number.isFinite(updatedAt)
    ) {
      return null;
    }

    return {
      v: 1,
      page,
      scale,
      rotate,
      scrollTop,
      scrollLeft,
      fitWidth,
      theme: theme === 'dark' ? 'dark' : 'light',
      updatedAt,
    };
  } catch {
    return null;
  }
}

function writeState(key: string, state: PersistedPdfReadingStateV1) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore quota / serialization errors
  }
}

function buildStateSnapshot(state: {
  page: number;
  scale: number;
  rotate: number;
  fitWidth: boolean;
  scrollTop: number;
  scrollLeft: number;
  theme: 'light' | 'dark';
}): PersistedPdfReadingStateV1 {
  return {
    v: 1,
    page: Math.max(1, Math.floor(state.page)),
    scale: state.scale,
    rotate: normalizeRotate(state.rotate),
    scrollTop: Math.max(0, state.scrollTop),
    scrollLeft: Math.max(0, state.scrollLeft),
    fitWidth: state.fitWidth,
    theme: state.theme,
    updatedAt: Date.now(),
  };
}

export type UsePdfReadingStateParams = {
  file: File | string | null | undefined;
  selectedId?: number;
  ready: boolean;

  page: number;
  setPage: (next: number | ((prev: number) => number)) => void;

  scale: number;
  setScale: (next: number | ((prev: number) => number)) => void;

  rotate: number;
  setRotate: (next: number | ((prev: number) => number)) => void;

  fitWidth: boolean;
  setFitWidth: (next: boolean | ((prev: boolean) => boolean)) => void;

  theme: 'light' | 'dark';
  setTheme: (next: 'light' | 'dark' | ((prev: 'light' | 'dark') => 'light' | 'dark')) => void;

  containerRef: RefObject<HTMLElement | null>;
  xScrollRef?: RefObject<HTMLElement | null>;
};

export type UsePdfReadingStateResult = {
  restoring: boolean;
};

export function usePdfReadingState(params: UsePdfReadingStateParams): UsePdfReadingStateResult {
  const {
    file,
    selectedId,
    ready,
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
    containerRef,
    xScrollRef,
  } = params;

  const storageKey = useMemo(() => getStorageKey(file, selectedId), [file, selectedId]);
  const saved = useMemo(() => (storageKey ? readState(storageKey) : null), [storageKey]);

  const [restoring, setRestoring] = useState(() => !!saved);
  const restoringRef = useRef(restoring);
  const readyRef = useRef(ready);

  const latestRef = useRef({
    page,
    scale,
    rotate,
    fitWidth,
    theme,
    scrollTop: 0,
    scrollLeft: 0,
  });

  const saveTimerRef = useRef<number | null>(null);
  const scheduleSaveRef = useRef<(() => void) | null>(null);
  const restoredForKeyRef = useRef<string | null>(null);
  const didRestoreScrollRef = useRef(false);

  useEffect(() => {
    restoringRef.current = restoring;
  }, [restoring]);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  useEffect(() => {
    latestRef.current.page = page;
    latestRef.current.scale = scale;
    latestRef.current.rotate = rotate;
    latestRef.current.fitWidth = fitWidth;
    latestRef.current.theme = theme;
  }, [fitWidth, page, rotate, scale, theme]);

  useEffect(() => {
    didRestoreScrollRef.current = false;
    restoredForKeyRef.current = null;
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) {
      queueMicrotask(() => setRestoring(false));
      return;
    }
    queueMicrotask(() => setRestoring(!!saved));
  }, [saved, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    if (!saved) return;

    restoredForKeyRef.current = storageKey;
    didRestoreScrollRef.current = false;

    latestRef.current.page = Math.max(1, Math.floor(saved.page));
    latestRef.current.rotate = normalizeRotate(saved.rotate);
    latestRef.current.fitWidth = saved.fitWidth;
    latestRef.current.scale = saved.fitWidth ? latestRef.current.scale : saved.scale;
    latestRef.current.theme = saved.theme;
    latestRef.current.scrollTop = saved.scrollTop;
    latestRef.current.scrollLeft = saved.scrollLeft;

    setTheme(saved.theme);
    setRotate(normalizeRotate(saved.rotate));
    setPage(Math.max(1, Math.floor(saved.page)));

    if (saved.fitWidth) {
      setFitWidth(true);
      return;
    }

    setFitWidth(false);
    setScale(saved.scale);
  }, [saved, setFitWidth, setPage, setRotate, setScale, setTheme, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    if (!saved) return;
    if (!ready) return;
    if (restoredForKeyRef.current !== storageKey) return;
    if (didRestoreScrollRef.current) return;

    const yRoot = containerRef.current;
    if (!yRoot) return;
    const xRoot = xScrollRef?.current ?? null;
    const isUnifiedScroll = !!xRoot && xRoot === yRoot;

    let raf = 0;
    let attempts = 0;
    const maxAttempts = 120;
    const tolerance = 1;

    const tryRestore = () => {
      attempts += 1;

      const appliedY = saved.scrollTop <= 0 || Math.abs(yRoot.scrollTop - saved.scrollTop) <= tolerance;
      const appliedX = !xRoot || saved.scrollLeft <= 0 || Math.abs(xRoot.scrollLeft - saved.scrollLeft) <= tolerance;

      if (appliedY && appliedX) {
        didRestoreScrollRef.current = true;
        setRestoring(false);
        return;
      }

      if (attempts >= maxAttempts) {
        didRestoreScrollRef.current = true;
        setRestoring(false);
        return;
      }

      const canApplyY = saved.scrollTop <= 0 || yRoot.scrollHeight > yRoot.clientHeight + 1 || attempts >= maxAttempts;
      const canApplyX =
        !xRoot || saved.scrollLeft <= 0 || xRoot.scrollWidth > xRoot.clientWidth + 1 || attempts >= maxAttempts;

      if (canApplyY && canApplyX) {
        if (isUnifiedScroll) {
          yRoot.scrollTo({
            top: Math.max(0, saved.scrollTop),
            left: Math.max(0, saved.scrollLeft),
            behavior: 'auto',
          });
        } else {
          yRoot.scrollTo({ top: Math.max(0, saved.scrollTop), behavior: 'auto' });
          if (xRoot) xRoot.scrollTo({ left: Math.max(0, saved.scrollLeft), behavior: 'auto' });
        }
      }

      raf = window.requestAnimationFrame(tryRestore);
    };

    raf = window.requestAnimationFrame(tryRestore);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [containerRef, ready, saved, storageKey, xScrollRef]);

  useEffect(() => {
    if (!storageKey) return;
    if (typeof window === 'undefined') return;

    const yRoot = containerRef.current;
    if (!yRoot) return;
    const xRoot = xScrollRef?.current ?? null;
    const isUnifiedScroll = !!xRoot && xRoot === yRoot;

    const flushNow = () => {
      if (!readyRef.current) return;
      latestRef.current.scrollTop = yRoot.scrollTop;
      if (isUnifiedScroll) {
        latestRef.current.scrollLeft = yRoot.scrollLeft;
      } else if (xRoot) {
        latestRef.current.scrollLeft = xRoot.scrollLeft;
      }
      writeState(storageKey, buildStateSnapshot(latestRef.current));
    };

    const scheduleSave = () => {
      if (restoringRef.current) return;
      if (!readyRef.current) return;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        writeState(storageKey, buildStateSnapshot(latestRef.current));
      }, 200);
    };
    scheduleSaveRef.current = scheduleSave;

    const onUnifiedScroll = () => {
      latestRef.current.scrollTop = yRoot.scrollTop;
      latestRef.current.scrollLeft = yRoot.scrollLeft;
      scheduleSave();
    };

    const onYScroll = () => {
      latestRef.current.scrollTop = yRoot.scrollTop;
      scheduleSave();
    };

    const onXScroll = () => {
      if (!xRoot) return;
      latestRef.current.scrollLeft = xRoot.scrollLeft;
      scheduleSave();
    };

    const onBeforeUnload = () => {
      flushNow();
    };

    if (isUnifiedScroll) {
      yRoot.addEventListener('scroll', onUnifiedScroll, { passive: true });
    } else {
      yRoot.addEventListener('scroll', onYScroll, { passive: true });
      xRoot?.addEventListener('scroll', onXScroll, { passive: true });
    }
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      flushNow();
      scheduleSaveRef.current = null;
      if (isUnifiedScroll) {
        yRoot.removeEventListener('scroll', onUnifiedScroll);
      } else {
        yRoot.removeEventListener('scroll', onYScroll);
        xRoot?.removeEventListener('scroll', onXScroll);
      }
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [containerRef, storageKey, xScrollRef]);

  useEffect(() => {
    if (!storageKey) return;
    if (restoring) return;
    if (!ready) return;
    const yRoot = containerRef.current;
    if (yRoot) {
      latestRef.current.scrollTop = yRoot.scrollTop;
      const xRoot = xScrollRef?.current ?? null;
      latestRef.current.scrollLeft = xRoot ? xRoot.scrollLeft : yRoot.scrollLeft;
    }
    scheduleSaveRef.current?.();
  }, [containerRef, fitWidth, page, ready, restoring, rotate, scale, storageKey, theme, xScrollRef]);

  useEffect(() => {
    if (!storageKey) return;
    if (typeof window === 'undefined') return;
    if (!ready) return;
    const yRoot = containerRef.current;
    if (!yRoot) return;
    latestRef.current.scrollTop = yRoot.scrollTop;
    const xRoot = xScrollRef?.current ?? null;
    latestRef.current.scrollLeft = xRoot ? xRoot.scrollLeft : yRoot.scrollLeft;
  }, [containerRef, ready, storageKey, xScrollRef]);

  return { restoring };
}
