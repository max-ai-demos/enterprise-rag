import React from 'react';
import { createPortal } from 'react-dom';

type TooltipSide = 'top' | 'bottom' | 'left' | 'right';
type TooltipAlign = 'start' | 'center' | 'end';
export type TooltipPlacement = TooltipSide | `${TooltipSide}-start` | `${TooltipSide}-center` | `${TooltipSide}-end`;

export type IconButtonProps = {
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  tooltipPlacement?: TooltipPlacement;
  tooltipOffset?: number;
  children: React.ReactNode;
};

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

function parsePlacement(placement: TooltipPlacement): { side: TooltipSide; align: TooltipAlign } {
  const [side, rawAlign] = placement.split('-') as [TooltipSide, TooltipAlign | undefined];
  return { side, align: rawAlign ?? 'center' };
}

function flipPlacement(placement: TooltipPlacement): TooltipPlacement {
  const { side, align } = parsePlacement(placement);
  switch (side) {
    case 'top':
      return `bottom-${align}`;
    case 'bottom':
      return `top-${align}`;
    case 'left':
      return `right-${align}`;
    case 'right':
      return `left-${align}`;
    default:
      return placement;
  }
}

function getCoords({
  rect,
  tooltipSize,
  placement,
  offset,
}: {
  rect: DOMRect;
  tooltipSize: { width: number; height: number };
  placement: TooltipPlacement;
  offset: number;
}): { left: number; top: number } {
  const { side, align } = parsePlacement(placement);
  const w = tooltipSize.width;
  const h = tooltipSize.height;

  if (side === 'top' || side === 'bottom') {
    const top = side === 'top' ? rect.top - offset - h : rect.bottom + offset;
    const left = align === 'start' ? rect.left : align === 'end' ? rect.right - w : rect.left + rect.width / 2 - w / 2;
    return { left, top };
  }

  const left = side === 'left' ? rect.left - offset - w : rect.right + offset;
  const top = align === 'start' ? rect.top : align === 'end' ? rect.bottom - h : rect.top + rect.height / 2 - h / 2;
  return { left, top };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function computeTooltipPosition({
  rect,
  tooltipSize,
  placement,
  offset,
  margin,
  viewport,
}: {
  rect: DOMRect;
  tooltipSize: { width: number; height: number };
  placement: TooltipPlacement;
  offset: number;
  margin: number;
  viewport: { width: number; height: number };
}): { left: number; top: number; placement: TooltipPlacement } {
  const w = tooltipSize.width;
  const h = tooltipSize.height;

  const overflowFor = (p: TooltipPlacement) => {
    const { left, top } = getCoords({ rect, tooltipSize, placement: p, offset });
    return {
      left: left < margin,
      right: left + w > viewport.width - margin,
      top: top < margin,
      bottom: top + h > viewport.height - margin,
      coords: { left, top },
    };
  };

  let nextPlacement = placement;
  if (w > 0 && h > 0) {
    const { side } = parsePlacement(placement);
    const o = overflowFor(placement);
    if (side === 'top' || side === 'bottom') {
      const spaceAbove = rect.top - offset - margin;
      const spaceBelow = viewport.height - rect.bottom - offset - margin;
      if (side === 'bottom' && o.bottom && spaceAbove >= h) nextPlacement = flipPlacement(placement);
      if (side === 'top' && o.top && spaceBelow >= h) nextPlacement = flipPlacement(placement);
    } else {
      const spaceLeft = rect.left - offset - margin;
      const spaceRight = viewport.width - rect.right - offset - margin;
      if (side === 'right' && o.right && spaceLeft >= w) nextPlacement = flipPlacement(placement);
      if (side === 'left' && o.left && spaceRight >= w) nextPlacement = flipPlacement(placement);
    }
  }

  const { left: rawLeft, top: rawTop } = getCoords({ rect, tooltipSize, placement: nextPlacement, offset });
  const left = clamp(rawLeft, margin, Math.max(margin, viewport.width - w - margin));
  const top = clamp(rawTop, margin, Math.max(margin, viewport.height - h - margin));
  return { left, top, placement: nextPlacement };
}

export function IconButton({
  title,
  onClick,
  disabled,
  active,
  tooltipPlacement = 'bottom-start',
  tooltipOffset = 6,
  children,
}: IconButtonProps) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ left: number; top: number; placement: TooltipPlacement }>({
    left: 0,
    top: 0,
    placement: tooltipPlacement,
  });

  const recompute = React.useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const tooltipRect = tooltipRef.current?.getBoundingClientRect();
    const tooltipSize = { width: tooltipRect?.width ?? 0, height: tooltipRect?.height ?? 0 };
    const next = computeTooltipPosition({
      rect,
      tooltipSize,
      placement: tooltipPlacement,
      offset: tooltipOffset,
      margin: 8,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    setPos(next);
  }, [tooltipOffset, tooltipPlacement]);

  const showTooltip = React.useCallback(() => {
    if (!title) return;
    recompute();
    setOpen(true);
  }, [recompute, title]);

  const hideTooltip = React.useCallback(() => {
    setOpen(false);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onScroll = () => recompute();
    const onResize = () => recompute();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, recompute]);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    recompute();
  }, [open, recompute, title]);

  const portalTarget = typeof document === 'undefined' ? null : (document.fullscreenElement ?? document.body);

  return (
    <span
      className="inline-flex"
      onPointerEnter={showTooltip}
      onPointerLeave={hideTooltip}
      onFocusCapture={showTooltip}
      onBlurCapture={hideTooltip}
    >
      <button
        ref={buttonRef}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-md text-foreground disabled:opacity-50 disabled:cursor-not-allowed ${active ? 'bg-[#5B718A0F]' : 'hover:bg-[#5B718A0F]'}`}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
      >
        {children}
      </button>
      {title && portalTarget && open
        ? createPortal(
            <div
              className={[
                'fixed left-0 top-0 z-[40] pointer-events-none transition-opacity duration-150',
                open ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
              style={{
                transform: `translate3d(${pos.left}px, ${pos.top}px, 0)`,
              }}
            >
              <div
                ref={tooltipRef}
                className="whitespace-nowrap rounded-md bg-black px-3 py-1 text-sm text-white shadow-sm leading-[22px]"
              >
                {title}
              </div>
            </div>,
            portalTarget,
          )
        : null}
    </span>
  );
}
