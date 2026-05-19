import { useCallback, useEffect, useRef, useState } from 'react';
import type { PdfSearchResultItem } from '../components/PdfSearch/types';
import type { HighlightArea } from '../types/highlight';

type PdfSearchDoc = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getViewport: (opts: { scale: number }) => {
      width: number;
      height: number;
      convertToViewportRectangle: (rect: [number, number, number, number]) => [number, number, number, number];
    };
    getTextContent: () => Promise<{ items: unknown[] }>;
  }>;
};

export type PdfTextSearchState =
  | {
      status: 'idle';
      inputValue: string;
      lastSubmitted: string | null;
      totalHits: null;
      resultsByPage: Record<number, PdfSearchResultItem[]>;
      shownCountByPage: Record<number, number>;
      highlightsByPage: Record<number, HighlightArea[]>;
      selected: { pageNumber: number; hitOrdinal: number } | null;
    }
  | {
      status: 'loading';
      inputValue: string;
      lastSubmitted: string;
      totalHits: null;
      resultsByPage: Record<number, PdfSearchResultItem[]>;
      shownCountByPage: Record<number, number>;
      highlightsByPage: Record<number, HighlightArea[]>;
      selected: { pageNumber: number; hitOrdinal: number } | null;
    }
  | {
      status: 'ready';
      inputValue: string;
      lastSubmitted: string;
      totalHits: number;
      resultsByPage: Record<number, PdfSearchResultItem[]>;
      shownCountByPage: Record<number, number>;
      highlightsByPage: Record<number, HighlightArea[]>;
      selected: { pageNumber: number; hitOrdinal: number } | null;
    };

function isPdfSearchDoc(doc: unknown): doc is PdfSearchDoc {
  return !!doc && typeof doc === 'object' && 'numPages' in doc && 'getPage' in doc;
}

function findAllOccurrences(haystack: string, needle: string) {
  if (!needle) return [];
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const result: number[] = [];
  let idx = 0;
  while (true) {
    const next = lowerHaystack.indexOf(lowerNeedle, idx);
    if (next === -1) break;
    result.push(next);
    idx = next + lowerNeedle.length;
  }
  return result;
}

function buildSnippet(str: string, matchStart: number) {
  const maxChars = 100;
  const safeStart = Math.max(0, Math.min(str.length, matchStart));
  const raw = str.slice(safeStart, Math.min(str.length, safeStart + maxChars + 64));
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const core = normalized.length > maxChars ? normalized.slice(0, maxChars).trimEnd() : normalized;
  const suffix = safeStart + maxChars < str.length ? '…' : '';
  return `${core}${suffix}`;
}

function needsInterItemSpace(
  prev: {
    str: string;
    transform: number[] | null;
    itemWidth: number;
    itemHeight: number;
  } | null,
  next: {
    str: string;
    transform: number[] | null;
    itemWidth: number;
    itemHeight: number;
  },
) {
  if (!prev) return false;
  if (!prev.str || !next.str) return false;

  const prevChar = prev.str[prev.str.length - 1] ?? '';
  const nextChar = next.str[0] ?? '';
  if (!prevChar || !nextChar) return false;
  if (/\s/.test(prevChar)) return false;
  if (/\s/.test(nextChar)) return false;

  // Prefer geometry-based spacing decisions to avoid breaking words like "Personaliz" + "ed".
  if (!prev.transform || !next.transform) return false;
  if (!Number.isFinite(prev.itemWidth) || prev.itemWidth <= 0) return false;

  const prevX = prev.transform[4];
  const prevY = prev.transform[5];
  const nextX = next.transform[4];
  const nextY = next.transform[5];
  if (![prevX, prevY, nextX, nextY].every((n) => Number.isFinite(n))) return false;

  const fontSize = Math.max(1, Math.abs(prev.transform[3] ?? 0) || prev.itemHeight || 10);
  const prevEndX = prevX + prev.itemWidth;
  const gapX = nextX - prevEndX;
  const sameLine = Math.abs(nextY - prevY) <= fontSize * 0.5 && nextX >= prevX - fontSize * 0.25;

  if (!sameLine) {
    // Hyphenation across lines: "exam-" + "ple" should not get a space.
    if (prevChar === '-') return false;
    return true;
  }

  // Add a space only if there is a noticeable horizontal gap between runs.
  return gapX >= fontSize * 0.25;
}

function clamp01To100(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function computeHighlightRectPercent(opts: {
  viewport: {
    width: number;
    height: number;
    convertToViewportRectangle: (r: [number, number, number, number]) => [number, number, number, number];
  };
  str: string;
  transform: number[];
  itemWidth: number;
  itemHeight: number;
  matchStart: number;
  matchLength: number;
}) {
  const { viewport, str, transform, itemWidth, itemHeight, matchStart, matchLength } = opts;
  if (!(viewport.width > 0 && viewport.height > 0)) return null;
  if (!Number.isFinite(itemWidth) || itemWidth <= 0) return null;
  if (!Number.isFinite(itemHeight) || itemHeight <= 0) return null;
  if (!Array.isArray(transform) || transform.length < 6) return null;
  if (!str) return null;

  const x = transform[4];
  const y = transform[5];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  // pdf.js 的文本坐标 y 通常是 baseline；字符主要分布在 baseline 上方
  const rect = viewport.convertToViewportRectangle([x, y, x + itemWidth, y + itemHeight]);
  const left = Math.min(rect[0], rect[2]);
  const top = Math.min(rect[1], rect[3]);
  const widthPx = Math.abs(rect[2] - rect[0]);
  const heightPx = Math.abs(rect[3] - rect[1]);
  if (!(widthPx > 0 && heightPx > 0)) return null;

  const denom = Math.max(1, str.length);
  const startRatio = matchStart / denom;
  const lengthRatio = matchLength / denom;
  const subLeft = left + widthPx * startRatio;
  const subWidth = Math.max(1, widthPx * lengthRatio);

  return {
    x: clamp01To100((subLeft / viewport.width) * 100),
    y: clamp01To100((top / viewport.height) * 100),
    width: clamp01To100((subWidth / viewport.width) * 100),
    height: clamp01To100((heightPx / viewport.height) * 100),
  };
}

export type UsePdfTextSearchOptions = {
  doc: unknown | null;
  pdfPaneRef: React.RefObject<HTMLElement | null>;
  scrollToPage: (pageNumber: number, behavior?: ScrollBehavior) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  pageResultBatchSize?: number;
};

export function usePdfTextSearch(opts: UsePdfTextSearchOptions) {
  const { doc, pdfPaneRef, scrollToPage, inputRef, pageResultBatchSize = 5 } = opts;

  const [showSearch, setShowSearch] = useState(false);
  const searchSeqRef = useRef(0);
  const lastAutoScrollTargetRef = useRef<string | null>(null);
  const prevShowSearchRef = useRef(false);

  const [search, setSearch] = useState<PdfTextSearchState>({
    status: 'idle',
    inputValue: '',
    lastSubmitted: null,
    totalHits: null,
    resultsByPage: {},
    shownCountByPage: {},
    highlightsByPage: {},
    selected: null,
  });

  const resetSearch = useCallback((options?: { closePanel?: boolean }) => {
    searchSeqRef.current += 1;
    if (options?.closePanel) {
      setShowSearch(false);
    }
    setSearch({
      status: 'idle',
      inputValue: '',
      lastSubmitted: null,
      totalHits: null,
      resultsByPage: {},
      shownCountByPage: {},
      highlightsByPage: {},
      selected: null,
    });
  }, []);

  // 折叠清空搜索状态（但不关闭面板，让用户手动控制）
  useEffect(() => {
    const wasOpen = prevShowSearchRef.current;
    prevShowSearchRef.current = showSearch;
    // 移除自动关闭逻辑，让用户手动控制搜索面板的显示/隐藏
    // if (!showSearch && wasOpen) {
    //   resetSearch();
    // }
  }, [showSearch]);

  const runSearch = useCallback(
    async (keyword: string) => {
      if (!isPdfSearchDoc(doc)) return;

      searchSeqRef.current += 1;
      const seq = searchSeqRef.current;

      setSearch((prev) => ({
        status: 'loading',
        inputValue: prev.inputValue,
        lastSubmitted: keyword,
        totalHits: null,
        resultsByPage: {},
        shownCountByPage: {},
        highlightsByPage: {},
        selected: null,
      }));

      const highlightsByPage: Record<number, HighlightArea[]> = {};
      const resultsByPage: Record<number, PdfSearchResultItem[]> = {};
      const shownCountByPage: Record<number, number> = {};
      let totalHits = 0;

      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        if (seq !== searchSeqRef.current) return;
        const pdfPage = await doc.getPage(pageNumber);
        const viewport = pdfPage.getViewport({ scale: 1 });
        const textContent = await pdfPage.getTextContent();
        const items = Array.isArray(textContent.items) ? textContent.items : [];

        let pageHitOrdinal = 0;
        const pageHighlights: HighlightArea[] = [];
        const pageHits: PdfSearchResultItem[] = [];

        const runs: Array<{
          start: number;
          str: string;
          transform: number[] | null;
          itemWidth: number;
          itemHeight: number;
        }> = [];
        const parts: string[] = [];
        let cursor = 0;
        let prevRun: { str: string; transform: number[] | null; itemWidth: number; itemHeight: number } | null = null;

        for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
          const item = items[itemIndex] as unknown as {
            str?: unknown;
            transform?: unknown;
            width?: unknown;
            height?: unknown;
          };
          const str = typeof item.str === 'string' ? item.str : '';
          if (!str) continue;

          const transform = Array.isArray(item.transform) ? (item.transform as number[]) : null;
          const itemWidth = typeof item.width === 'number' ? item.width : NaN;
          const rawHeight = typeof item.height === 'number' ? item.height : NaN;
          const itemHeight =
            Number.isFinite(rawHeight) && rawHeight > 0
              ? rawHeight
              : transform && typeof transform[3] === 'number'
                ? Math.abs(transform[3]) || 10
                : 10;

          const nextRun = { str, transform, itemWidth, itemHeight };
          if (needsInterItemSpace(prevRun, nextRun)) {
            parts.push(' ');
            cursor += 1;
          }

          const start = cursor;
          parts.push(str);
          cursor += str.length;
          runs.push({ start, str, transform, itemWidth, itemHeight });
          prevRun = nextRun;
        }

        const pageText = parts.join('');
        const starts = findAllOccurrences(pageText, keyword);
        if (starts.length > 0 && runs.length > 0) {
          const findFirstRunIndex = (pos: number) => {
            let lo = 0;
            let hi = runs.length - 1;
            let best = runs.length;
            while (lo <= hi) {
              const mid = (lo + hi) >> 1;
              const run = runs[mid];
              const runEnd = run.start + run.str.length;
              if (runEnd > pos) {
                best = mid;
                hi = mid - 1;
              } else {
                lo = mid + 1;
              }
            }
            return best;
          };

          for (const start of starts) {
            const ordinal = pageHitOrdinal;
            pageHitOrdinal += 1;
            totalHits += 1;

            const baseId = `${pageNumber}-${ordinal}`;
            const end = start + keyword.length;

            let segmentIndex = 0;
            for (let runIndex = findFirstRunIndex(start); runIndex < runs.length; runIndex += 1) {
              const run = runs[runIndex];
              if (run.start >= end) break;

              const runLen = run.str.length;
              const localStart = Math.max(0, start - run.start);
              const localEnd = Math.min(runLen, end - run.start);
              const segLen = localEnd - localStart;
              if (segLen <= 0) continue;

              const rectPct =
                run.transform && Number.isFinite(run.itemWidth)
                  ? computeHighlightRectPercent({
                      viewport,
                      str: run.str,
                      transform: run.transform,
                      itemWidth: run.itemWidth,
                      itemHeight: run.itemHeight,
                      matchStart: localStart,
                      matchLength: segLen,
                    })
                  : null;
              if (rectPct) {
                pageHighlights.push({
                  id: segmentIndex === 0 ? baseId : `${baseId}:${segmentIndex}`,
                  pageNumber,
                  ...rectPct,
                  color: '#FFDD57',
                  opacity: 0.25,
                });
                segmentIndex += 1;
              }
            }

            pageHits.push({
              id: baseId,
              pageNumber,
              hitOrdinal: ordinal,
              snippet: buildSnippet(pageText, start),
            });
          }
        }

        if (pageHitOrdinal > 0) {
          highlightsByPage[pageNumber] = pageHighlights;

          const unique = new Set<string>();
          const deduped: PdfSearchResultItem[] = [];
          for (const hit of pageHits) {
            if (unique.has(hit.snippet)) continue;
            unique.add(hit.snippet);
            deduped.push(hit);
          }
          if (deduped.length > 0) {
            resultsByPage[pageNumber] = deduped;
            shownCountByPage[pageNumber] = Math.min(pageResultBatchSize, deduped.length);
          }
        }
      }

      if (seq !== searchSeqRef.current) return;
      setSearch((prev) => ({
        status: 'ready',
        inputValue: prev.inputValue,
        lastSubmitted: keyword,
        totalHits,
        resultsByPage,
        shownCountByPage,
        highlightsByPage,
        selected: null,
      }));
    },
    [doc, pageResultBatchSize],
  );

  const submitSearch = useCallback(() => {
    const keyword = search.inputValue.trim();
    if (!keyword) {
      setSearch((prev) => ({
        status: 'idle',
        inputValue: prev.inputValue,
        lastSubmitted: null,
        totalHits: null,
        resultsByPage: {},
        shownCountByPage: {},
        highlightsByPage: {},
        selected: null,
      }));
      return;
    }
    void runSearch(keyword);
  }, [runSearch, search.inputValue]);

  const selectSearchResult = useCallback(
    (pageNumber: number, hitOrdinal: number) => {
      setSearch((prev) => ({
        ...prev,
        selected: { pageNumber, hitOrdinal },
      }));
      scrollToPage(pageNumber);
    },
    [scrollToPage],
  );

  const showMoreForPage = useCallback(
    (pageNumber: number) => {
      setSearch((prev) => {
        const all = prev.resultsByPage[pageNumber] ?? [];
        const current = prev.shownCountByPage[pageNumber] ?? 0;
        const next = Math.min(all.length, current + pageResultBatchSize);
        if (next === current) return prev;
        return {
          ...prev,
          shownCountByPage: {
            ...prev.shownCountByPage,
            [pageNumber]: next,
          },
        };
      });
    },
    [pageResultBatchSize],
  );

  const openSearchPanel = useCallback(() => {
    setShowSearch(true);
    window.setTimeout(() => inputRef?.current?.focus(), 0);
  }, [inputRef]);

  const toggleSearchPanel = useCallback(() => {
    setShowSearch((prev) => {
      const next = !prev;
      if (next) window.setTimeout(() => inputRef?.current?.focus(), 0);
      return next;
    });
  }, [inputRef]);

  const openAndSearchText = useCallback(
    (text: string) => {
      const next = text.trim();
      setShowSearch(true);
      setSearch((prev) => ({
        ...prev,
        inputValue: next,
      }));
      window.setTimeout(() => inputRef?.current?.focus(), 0);
      if (next) void runSearch(next);
    },
    [inputRef, runSearch],
  );

  useEffect(() => {
    if (!search.selected) return;
    const { pageNumber, hitOrdinal } = search.selected;
    const root = pdfPaneRef.current;
    if (!root) return;

    let cancelled = false;
    let attempts = 0;
    const targetId = `${pageNumber}-${hitOrdinal}`;
    if (lastAutoScrollTargetRef.current === targetId) return;
    lastAutoScrollTargetRef.current = targetId;

    const tick = () => {
      if (cancelled) return;
      attempts += 1;
      const el = root.querySelector<HTMLElement>(`[data-spr-hit='${targetId}']`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (attempts < 180) window.requestAnimationFrame(tick);
    };

    window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [pdfPaneRef, search.selected]);

  return {
    showSearch,
    setShowSearch,
    search,
    setSearch,
    submitSearch,
    runSearch,
    selectSearchResult,
    showMoreForPage,
    resetSearch,
    openSearchPanel,
    toggleSearchPanel,
    openAndSearchText,
  } as const;
}
