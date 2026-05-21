import React from 'react';
import { Page } from 'react-pdf';
import { PageContent } from './PageContent';
import { usePdfState } from '../../context/PdfContext';
import { PDF_PAGE_GAP_PX } from '../../const/pdf';
import { useRetainedLayerPages } from '../../hooks/use-retained-layer-pages';
import type { HighlightArea } from '../../types/highlight';

import './index.css';

export type PageListProps = {
  visiblepageIndices: number[];
  searchHighlightsByPage?: Record<number, HighlightArea[]>;
  indexHighlightsByPage?: Record<number, HighlightArea[]>;
  selectionHighlightsByPage?: Record<number, HighlightArea[]>;
  searchSelected?: { pageNumber: number; hitOrdinal: number } | null;
};

export const PageList: React.FC<PageListProps> = (props) => {
  const {
    visiblepageIndices,
    searchHighlightsByPage,
    indexHighlightsByPage,
    selectionHighlightsByPage,
    searchSelected,
  } = props;

  const { totalPages, scale, rotate, originalHeight, originalWidth } = usePdfState();
  const retainedPages = useRetainedLayerPages(visiblepageIndices);

  // 如果 originalWidth 或 originalHeight 为 0，页面无法正确显示
  if (originalWidth <= 0 || originalHeight <= 0 || totalPages <= 0) {
    return null;
  }

  const height = originalHeight * scale;
  const width = originalWidth * scale;

  const isRotate = rotate % 180 !== 0;

  const pageWrapperStyle = {
    height: `${isRotate ? width : height}px`,
    width: `${isRotate ? height : width}px`,
    display: 'flex',
    alignItems: 'center',
  };

  const getTranslateY = () => {
    if (!isRotate) {
      return 0;
    }
    if (height > width) {
      return 0;
    }
    const baseOffset = (height - width) / 2;
    if (rotate === 90) {
      return baseOffset * -1;
    }

    return baseOffset;
  };

  const pageStyle: React.CSSProperties = {
    width: width,
    height: height,
    transform: `rotate(${rotate}deg) translateY(${getTranslateY()}px)`,
    flexShrink: 0,
    willChange: 'transform',
  };

  return (
    <div
      className="pdf-viewer relative flex mx-auto my-0 flex-col"
      style={{
        gap: `${PDF_PAGE_GAP_PX}px`,
        width: 'max-content',
        willChange: 'transform',
      }}
    >
      {totalPages > 0 &&
        Array.from({ length: totalPages }, (_, idx) => {
          const pageNumber = idx + 1;
          const isShow = visiblepageIndices.includes(idx);
          const selected =
            searchSelected && searchSelected.pageNumber === pageNumber
              ? `${pageNumber}-${searchSelected.hitOrdinal}`
              : null;
          const rawHighlights = searchHighlightsByPage?.[pageNumber] ?? [];
          const searchHighlights: HighlightArea[] = rawHighlights.map((h) => ({
            ...h,
            color: selected && h.id === selected ? '#FFBF00' : '#FFDD57',
            opacity: selected && h.id === selected ? 0.45 : 0.25,
          }));
          const selectionHighlights = selectionHighlightsByPage?.[pageNumber] ?? [];
          const indexHighlights = indexHighlightsByPage?.[pageNumber] ?? [];
          // 确保索引高亮始终显示（即使没有搜索高亮）
          const highlights: HighlightArea[] = [...selectionHighlights, ...searchHighlights, ...indexHighlights];
          return (
            <div key={pageNumber} data-pdf-page={pageNumber} style={pageWrapperStyle}>
              <div className="pdf-page" style={pageStyle} id={`page-${pageNumber}`}>
                <Page
                  pageNumber={pageNumber}
                  scale={scale}
                  loading=""
                  renderTextLayer={retainedPages.has(idx)}
                  renderAnnotationLayer={retainedPages.has(idx)}
                  renderMode="none"
                  onRenderTextLayerError={(err) => {
                    // PDF.js 在滚动、虚拟列表回收页面等场景会取消文本层任务，抛出 AbortException，属预期行为，勿当错误上报。
                    if ((err as { name?: string })?.name === 'AbortException') return;
                    console.error(err);
                  }}
                >
                  <PageContent pageNumber={pageNumber} isShow={isShow} highlights={highlights} />
                </Page>
              </div>
            </div>
          );
        })}
    </div>
  );
};

export default PageList;
