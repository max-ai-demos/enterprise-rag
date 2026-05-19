import React from 'react';
import { usePdfAction, usePdfState } from '../../context/PdfContext';
import { usePdfZoom } from '../../hooks/use-pdf-zoom';
import { IconButton } from '../IconButton';
import {
  ListIcon,
  MoonIcon,
  SunIcon,
  FullscreenIcon,
  ChevronUpIcon,
  SearchIcon,
  DownloadIcon,
  RotateRightIcon,
  CollapseIcon,
  ExitFullscreenIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../Icons';

export type PdfToolbarProps = {
  page: number;
  numPages: number;
  onPrev: () => void;
  onNext: () => void;
  onPageChange: (page: number) => void;
  fitWidth: boolean;
  onFitWidth: () => void;
  onToggleFitWidth: () => void;
  onDisableFitWidth: () => void;
  effectiveScale: number;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onDownload?: () => void;
  onToggleThumbnails?: () => void;
  thumbnailsActive?: boolean;
  onToggleSearch?: () => void;
  searchActive?: boolean;
  leftPanelOpen?: boolean;
};

export function PdfToolbar({
  page,
  numPages,
  onPrev,
  onNext,
  onPageChange,
  fitWidth,
  onFitWidth,
  onDisableFitWidth,
  effectiveScale,
  isFullscreen,
  onToggleFullscreen,
  onDownload,
  onToggleThumbnails,
  thumbnailsActive,
  onToggleSearch,
  searchActive,
}: PdfToolbarProps) {
  const { setScale, resetZoom, rotateRight, theme, toggleTheme } = usePdfAction();
  const { rotate } = usePdfState();
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [inputValue, setInputValue] = React.useState('');
  const [pageInput, setPageInput] = React.useState(String(page));
  const [isEditingPage, setIsEditingPage] = React.useState(false);
  const [iconRotate, setIconRotate] = React.useState(rotate);
  const iconRotateRef = React.useRef(rotate);
  const prevRotateRef = React.useRef(rotate);

  React.useEffect(() => {
    const prev = prevRotateRef.current;
    prevRotateRef.current = rotate;

    const forwardDelta = (rotate - prev + 360) % 360;
    const delta = forwardDelta > 180 ? forwardDelta - 360 : forwardDelta;

    iconRotateRef.current += delta;
    setIconRotate(iconRotateRef.current);
  }, [rotate]);

  const { presetPercents, percent, setZoomPercent, selectPageFit, zoomInPreset, zoomOutPreset } = usePdfZoom({
    effectiveScale,
    fitWidth,
    setFitWidth: (v) => (v ? onFitWidth() : onDisableFitWidth()),
    setScale,
  });

  const canPrev = page > 1;
  const canNext = numPages > 0 && page < numPages;

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    setInputValue(`${percent}%`);
  }, [open, percent]);

  React.useEffect(() => {
    if (isEditingPage) return;
    setPageInput(String(page));
  }, [page, isEditingPage]);

  const label = fitWidth ? 'Page fit' : `${percent}%`;

  const commitInput = () => {
    const n = Number(inputValue.replace('%', '').trim());
    if (!Number.isFinite(n)) return;
    setOpen(false);
    setZoomPercent(n);
  };

  return (
    <div className="h-12 border-b-[0.5px] border-solid border-b-slate-200">
      <div className="h-full grid grid-cols-[128px_1fr_96px] items-center px-2">
        <div className="w-[128px] flex items-center pl-1">
          <IconButton title="Toggle thumbnails" onClick={onToggleThumbnails} active={thumbnailsActive}>
            <ListIcon />
          </IconButton>
          <IconButton title="Toggle search" onClick={onToggleSearch} active={searchActive}>
            <SearchIcon />
          </IconButton>
          <IconButton
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </IconButton>
        </div>

        <div className="text-foreground">
          {page > 0 && numPages > 0 && (
            <div className="justify-self-center flex items-center gap-1.5">
              <div className="flex items-center gap-1 text-xs">
                <input
                  className="w-8 h-8 text-center rounded rounded-md bg-[#5B718A0F] text-foreground outline-none"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
                  onFocus={(e) => {
                    setIsEditingPage(true);
                    e.currentTarget.select();
                  }}
                  onBlur={() => {
                    setIsEditingPage(false);
                    setPageInput(String(page));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const rawNext = parseInt(pageInput, 10);
                      if (!Number.isFinite(rawNext) || numPages < 1) {
                        setIsEditingPage(false);
                        setPageInput(String(page));
                        e.currentTarget.blur();
                        return;
                      }

                      if (rawNext < 1 || rawNext > numPages) {
                        setIsEditingPage(false);
                        setPageInput(String(page));
                        e.currentTarget.blur();
                        return;
                      }

                      onPageChange(rawNext);
                      setIsEditingPage(false);
                      setPageInput(String(rawNext));
                      e.currentTarget.blur();
                    }
                    if (e.key === 'Escape') {
                      setIsEditingPage(false);
                      setPageInput(String(page));
                      e.currentTarget.blur();
                    }
                  }}
                  inputMode="numeric"
                />
                <span className="">/</span>
                <span className="">{numPages}</span>
              </div>
              <div className="w-px h-3 bg-[#F1F5F9]" />

              <div ref={menuRef} className="relative">
                <button
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-[#5B718A0F] text-foreground"
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  title="缩放"
                >
                  <span className="text-xs">{label}</span>
                  <ChevronUpIcon />
                </button>
                {open ? (
                  <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-40 rounded-lg bg-white shadow-[0px_0px_16px_0px_#0F172A29] p-1 z-50">
                    <div className="px-2 py-[6px]">
                      <div className="flex items-center gap-1">
                        <input
                          className="w-[84px] h-8 rounded border border-border bg-white px-3 py-1 text-xs text-foreground outline-none focus:border-blue-400/80 focus:ring-4 focus:ring-blue-500/20"
                          value={inputValue}
                          onChange={(e) => setInputValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitInput();
                            if (e.key === 'Escape') setOpen(false);
                          }}
                          inputMode="numeric"
                        />
                        <button
                          className="flex items-center justify-center w-6 h-6 rounded text-foreground hover:bg-muted"
                          type="button"
                          onClick={zoomOutPreset}
                          title="缩小"
                        >
                          <ZoomOutIcon />
                        </button>
                        <button
                          className="flex items-center justify-center w-6 h-6 rounded text-foreground hover:bg-muted"
                          type="button"
                          onClick={zoomInPreset}
                          title="放大"
                        >
                          <ZoomInIcon />
                        </button>
                      </div>

                      <div className="mt-2 overflow-hidden rounded-lg">
                        <button
                          className={`w-full text-left px-2 py-2 text-xs text-foreground hover:bg-muted rounded-md ${fitWidth ? 'bg-muted' : ''}`}
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            selectPageFit();
                          }}
                        >
                          Page fit
                        </button>
                        {presetPercents.map((p) => {
                          const active = !fitWidth && p === percent;
                          return (
                            <button
                              key={p}
                              className={`w-full text-left px-2 py-2 text-xs text-foreground hover:bg-muted rounded-md ${!fitWidth && p === percent ? 'bg-muted' : ''}`}
                              type="button"
                              onClick={() => {
                                setOpen(false);
                                setZoomPercent(p);
                              }}
                            >
                              {p}%
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="w-[96px] justify-self-end flex items-center">
          <IconButton title="Rotate clockwise" onClick={rotateRight}>
            <div
              className="transition-transform duration-300 ease-in-out will-change-transform"
              style={{ transform: `rotate(${iconRotate}deg)` }}
            >
              <RotateRightIcon />
            </div>
          </IconButton>
          <IconButton
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </IconButton>
          <IconButton title="Download" onClick={onDownload} disabled={!onDownload}>
            <DownloadIcon />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
