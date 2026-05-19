import React, { useRef, useMemo, useState, useEffect } from 'react';
import { usePageContext } from 'react-pdf';
import { HighlightArea } from '../../types/highlight';
import { usePdfState } from '../../context/PdfContext';

type PdfRenderTask = {
  promise: Promise<unknown>;
  cancel?: () => void;
};

interface PageContentProps {
  pageNumber: number;
  isShow: boolean;
  highlights?: HighlightArea[];
}

export const PageContent: React.FC<PageContentProps> = ({ pageNumber, isShow, highlights }) => {
  const { theme } = usePdfState();
  const pageContext = usePageContext();
  const page = pageContext?.page || null;

  const canvasDom = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<PdfRenderTask | null>(null);
  const renderSeqRef = useRef(0);

  const [canvasIsRender, setCanvasIsRender] = useState(false);

  const devicePixelRatio = window.devicePixelRatio || 1;

  const canvasRenderScale = useMemo(() => {
    return Math.max(devicePixelRatio, 3);
  }, [devicePixelRatio]);

  const renderViewport = useMemo(
    () => page && page.getViewport({ scale: canvasRenderScale }),
    [page, canvasRenderScale],
  );

  useEffect(() => {
    if (!isShow) return;
    if (!page || !canvasDom.current || !renderViewport) {
      return;
    }

    renderSeqRef.current += 1;
    const renderSeq = renderSeqRef.current;

    queueMicrotask(() => setCanvasIsRender(false));

    renderTaskRef.current?.cancel?.();
    renderTaskRef.current = null;

    const canvas = canvasDom.current;

    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);

    const canvasContext = canvas.getContext('2d', { alpha: true, willReadFrequently: true });

    if (!canvasContext) {
      return;
    }

    canvasContext.setTransform(1, 0, 0, 1, 0, 0);

    const canvasId = `pdf-page-canvas-${pageNumber}`;

    canvas.id = canvasId;

    const renderContext = {
      canvasContext,
      viewport: renderViewport,
    };

    const renderTask = page.render(renderContext);
    const task = renderTask as unknown as PdfRenderTask;
    renderTaskRef.current = task;

    renderTask.promise
      .then(() => {
        if (renderSeq !== renderSeqRef.current) return;
        setCanvasIsRender(true);
      })
      .catch((err) => {
        if (renderSeq !== renderSeqRef.current) return;
        setCanvasIsRender(true);
        if (err?.name === 'RenderingCancelledException') return;
        // Rendering error handled silently
      });

    return () => {
      task.cancel?.();
      if (renderTaskRef.current === task) {
        renderTaskRef.current = null;
      }
    };
  }, [isShow, page, renderViewport, pageNumber]);

  if (!isShow) {
    return null;
  }

  if (!page || !renderViewport) {
    return null;
  }

  return (
    <>
      <div
        className={[
          'w-full h-full block',
          theme === 'dark'
            ? 'mix-blend-multiply bg-neutral-800 brightness-[80%] contrast-[228%] hue-rotate-180 invert-[91%]'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <canvas className="pdf-page-canvas w-full h-full block" ref={canvasDom}></canvas>
      </div>
      {highlights && highlights.length > 0 && (
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-10">
          {highlights.map((highlight, index) => {
            return (
              <div
                key={`${highlight.id}-${index}`}
                data-spr-hit={highlight.id}
                data-spr-page={highlight.pageNumber}
                style={{
                  position: 'absolute',
                  left: `${highlight.x}%`,
                  top: `${highlight.y}%`,
                  width: `${highlight.width}%`,
                  height: `${highlight.height}%`,
                  backgroundColor: highlight.color,
                  opacity: highlight.opacity ?? 0.3,
                  border: highlight.border,
                  boxSizing: 'border-box',
                  zIndex: highlight.id.startsWith('index:') ? 20 : 10, // 索引高亮显示在最上层
                }}
              ></div>
            );
          })}
        </div>
      )}
    </>
  );
};
