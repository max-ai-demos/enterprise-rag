import React, { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Document, Page } from 'react-pdf';
import { usePdfState } from '../../context/PdfContext';

type LoadedDocument = Parameters<NonNullable<ComponentProps<typeof Document>['onLoadSuccess']>>[0];

function useInView<T extends HTMLElement>(root: HTMLElement | null) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !root) return;

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) setInView(true);
      },
      { root, rootMargin: '300px 0px' },
    );

    io.observe(element);
    return () => io.disconnect();
  }, [root]);

  return { ref, inView } as const;
}

const ThumbnailItem = React.memo(function ThumbnailItem(props: {
  pageNumber: number;
  width: number;
  height: number;
  pdf: LoadedDocument | null;
  active: boolean;
  onClick: () => void;
  listRoot: HTMLElement | null;
  enabled?: boolean;
}) {
  const { ref, inView } = useInView<HTMLButtonElement>(props.listRoot);
  const { theme } = usePdfState();

  const classes =
    theme === 'dark'
      ? 'mix-blend-multiply bg-neutral-800 brightness-[80%] contrast-[228%] hue-rotate-180 invert-[91%]'
      : '';

  const thumbBtn = props.active
    ? 'relative box-border overflow-hidden rounded-md border-2 border-solid border-black bg-black/5 p-0.5 text-left text-slate-200'
    : 'relative box-border overflow-hidden rounded-md border-2 border-transparent bg-transparent p-0.5 text-left text-slate-200 hover:border-solid hover:border-black hover:border-opacity-50';

  return (
    <button
      ref={ref}
      type="button"
      className={thumbBtn}
      onClick={props.onClick}
      title={`Page ${props.pageNumber}`}
      data-thumb-page={props.pageNumber}
      style={{ width: `${props.width + 8}px`, height: `${props.height + 8}px` }}
    >
      <div className={`w-full h-full overflow-hidden ${classes}`}>
        {props.enabled !== false && inView && props.pdf ? (
          <Page
            pdf={props.pdf}
            pageNumber={props.pageNumber}
            width={props.width}
            devicePixelRatio={1}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading=""
          />
        ) : (
          <div className="w-full h-full from-slate-400/10 to-slate-400/5" />
        )}
      </div>
    </button>
  );
});

ThumbnailItem.displayName = 'ThumbnailItem';

export type PdfThumbnailsProps = {
  pdf: LoadedDocument | null;
  numPages: number;
  activePage: number;
  onSelectPage: (pageNumber: number) => void;
  originalWidth: number;
  originalHeight: number;
  width?: number;
  className?: string;
};

const PdfThumbnailsImpl = function PdfThumbnails({
  pdf,
  numPages,
  activePage,
  onSelectPage,
  originalWidth,
  originalHeight,
  width = 102,
  className,
}: PdfThumbnailsProps) {
  'use no memo';
  const listRef = useRef<HTMLDivElement | null>(null);
  const [enabled, setEnabled] = useState(false);

  const thumbHeight =
    originalWidth > 0 && originalHeight > 0
      ? Math.round((width * originalHeight) / originalWidth)
      : Math.round(width / 0.77);

  useEffect(() => {
    if (!pdf) {
      setEnabled(false);
      return;
    }

    const win = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(() => setEnabled(true), { timeout: 300 });
      return () => {
        win.cancelIdleCallback?.(id);
      };
    }

    const t = window.setTimeout(() => setEnabled(true), 0);
    return () => window.clearTimeout(t);
  }, [pdf]);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-thumb-page='${activePage}']`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activePage]);

  return (
    <div className={className ?? ''}>
      <div ref={listRef} className="pr-2 overflow-auto grid gap-2 justify-items-start min-h-0">
        {numPages > 0 ? (
          Array.from({ length: numPages }, (_, idx) => {
            // eslint-disable-line react-hooks/refs
            const pageNumber = idx + 1;
            return (
              <ThumbnailItem
                key={pageNumber}
                pageNumber={pageNumber}
                width={width}
                height={thumbHeight}
                pdf={pdf}
                active={pageNumber === activePage}
                onClick={() => onSelectPage(pageNumber)}
                listRoot={listRef.current}
                enabled={enabled}
              />
            );
          })
        ) : (
          <div className="text-xs text-slate-400 px-1 py-2"></div>
        )}
      </div>
    </div>
  );
};

export const PdfThumbnails = React.memo(PdfThumbnailsImpl);
PdfThumbnails.displayName = 'PdfThumbnails';
