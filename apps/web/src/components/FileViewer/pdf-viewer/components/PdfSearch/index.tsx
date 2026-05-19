import React from 'react';
import type { PdfSearchPanelProps } from './types';
import { SearchIcon } from '../Icons';
import { usePdfState } from '../../context/PdfContext';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderSnippet(snippet: string, keyword: string, theme: string) {
  if (!keyword) return snippet;
  const re = new RegExp(escapeRegExp(keyword), 'gi');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(snippet))) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > lastIndex) parts.push(snippet.slice(lastIndex, start));
    parts.push(
      <span key={`${start}-${end}`} className="sprSnippert font-bold">
        {snippet.slice(start, end)}
      </span>,
    );
    lastIndex = end;
  }

  if (lastIndex < snippet.length) parts.push(snippet.slice(lastIndex));
  return <>{parts}</>;
}

export function PdfSearchPanel(props: PdfSearchPanelProps) {
  'use no memo';
  const { status, lastSubmitted, totalHits, resultsByPage, shownCountByPage } = props;
  const { theme } = usePdfState();

  const showEmpty = status === 'idle' && !lastSubmitted;
  const showNoMatches = status === 'ready' && !!lastSubmitted && (totalHits ?? 0) === 0;
  const showMatches = status === 'ready' && !!lastSubmitted && (totalHits ?? 0) > 0;

  const pageNumbers = React.useMemo(() => {
    return Object.keys(resultsByPage)
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
  }, [resultsByPage]);

  return (
    <div
      className="h-full min-h-0 flex flex-col p-3 gap-3"
      onClick={(e) => e.stopPropagation()} // 防止点击搜索面板时关闭
      onMouseDown={(e) => e.stopPropagation()} // 防止鼠标按下时关闭
    >
      <div className="relative">
        <div className="absolute inset-y-0 left-2 flex items-center pointer-events-none">
          <SearchIcon className={`${theme === 'dark' ? 'text-[#5F5F5F]' : ''}`} />
        </div>
        <input
          ref={props.inputRef} // eslint-disable-line react-hooks/refs
          className={`w-full h-8 rounded border pl-8 text-xs  focus:outline-none ${theme === 'dark' ? 'bg-[#222222] border-[#4B4B50] text-[#AFAFB8]' : 'bg-white border-border text-foreground'}`}
          placeholder="Search in document"
          value={props.inputValue} // eslint-disable-line react-hooks/refs
          onChange={(e) => {
            e.stopPropagation(); // 防止事件冒泡导致面板关闭
            props.onInputChange(e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation(); // 防止事件冒泡
            if (e.key === 'Enter') {
              e.preventDefault();
              props.onSubmit();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              // 不关闭面板，只清空输入
            }
          }}
          onClick={(e) => e.stopPropagation()} // 防止点击输入框时关闭面板
          onFocus={(e) => e.stopPropagation()} // 防止聚焦时关闭面板
        />
      </div>

      {status === 'loading' ? (
        <div className={`text-xs ${theme === 'dark' ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
          Searching…
        </div>
      ) : showEmpty ? (
        <div className={`text-xs ${theme === 'dark' ? 'text-muted-foreground' : 'text-muted-foreground'}`}></div>
      ) : showNoMatches ? (
        <div className={`text-xs ${theme === 'dark' ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
          No matches found
        </div>
      ) : showMatches ? (
        <div className={`text-xs ${theme === 'dark' ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
          Found {totalHits} matches
        </div>
      ) : null}

      {showMatches ? (
        <div className="min-h-0 overflow-x-hidden overflow-y-auto pr-1">
          <div className="grid gap-2 w-full min-w-0">
            {pageNumbers.map((pageNumber) => {
              const all = resultsByPage[pageNumber] ?? [];
              const shown = Math.max(0, Math.min(all.length, shownCountByPage[pageNumber] ?? 5));
              const slice = all.slice(0, shown);
              const hasMore = shown < all.length;
              return (
                <div key={pageNumber} className="grid gap-1">
                  {slice.map((r) => {
                    const selected =
                      props.selected?.pageNumber === r.pageNumber && props.selected?.hitOrdinal === r.hitOrdinal;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={[
                          'w-full max-w-full min-w-0 overflow-hidden rounded text-left px-2 py-2',
                          selected
                            ? theme === 'dark'
                              ? 'bg-[#3C3C3F]'
                              : 'bg-muted'
                            : theme === 'dark'
                              ? 'hover:bg-[#3C3C3F]'
                              : 'hover:bg-muted',
                        ].join(' ')}
                        onClick={() => props.onSelectResult(r.pageNumber, r.hitOrdinal)}
                      >
                        <div
                          className={`text-xs leading-4 max-h-[48px] overflow-hidden line-clamp-3 break-words ${theme === 'dark' ? 'text-[#AFAFB8]' : 'text-foreground'}`}
                        >
                          {renderSnippet(r.snippet, lastSubmitted ?? '', theme)}
                        </div>
                        <div
                          className={`mt-1 text-[10px] ${theme === 'dark' ? 'text-muted-foreground' : 'text-muted-foreground'} text-right`}
                        >
                          Page {r.pageNumber}
                        </div>
                      </button>
                    );
                  })}
                  {hasMore ? (
                    <button
                      type="button"
                      className={`w-full text-left rounded px-2 py-2 text-xs ${theme === 'dark' ? 'text-muted-foreground' : 'text-muted-foreground'} ${theme === 'dark' ? 'hover:bg-[#3C3C3F]' : 'hover:bg-muted'}`}
                      onClick={() => props.onShowMore(pageNumber)}
                    >
                      Show more
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
