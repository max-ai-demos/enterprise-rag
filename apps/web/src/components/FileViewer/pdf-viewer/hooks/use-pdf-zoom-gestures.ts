import { useEffect, useLayoutEffect, useRef } from 'react';
import { clamp } from '../utils/number';

type WebkitGestureEvent = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};

export type UsePdfZoomGesturesParams = {
  containerRef: React.RefObject<HTMLElement | null>;
  effectiveScale: number;
  setFitWidth: (next: boolean) => void;
  setScale: (next: number) => void;
  minScale?: number;
  maxScale?: number;
  enabled?: boolean;
};

type PendingRestore = {
  kind: 'page' | 'root' | 'scroll';
  pageNumber?: number;
  localX: number;
  localY: number;
  px: number;
  py: number;
  prevScale: number;
  nextScale: number;
};

export function usePdfZoomGestures({
  containerRef,
  effectiveScale,
  setFitWidth,
  setScale,
  minScale = 0.25,
  maxScale = 3,
  enabled = true,
}: UsePdfZoomGesturesParams) {
  'use no memo';
  const lastPointerClientRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const wheelAccumRef = useRef(0);
  const wheelClientRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const wheelRafRef = useRef<number | null>(null);
  const renderedScaleRef = useRef(effectiveScale);
  const desiredScaleRef = useRef(effectiveScale);
  const gestureStartScaleRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingRestore | null>(null);

  renderedScaleRef.current = effectiveScale; // eslint-disable-line react-hooks/refs
  desiredScaleRef.current = effectiveScale; // eslint-disable-line react-hooks/refs

  useEffect(() => {
    if (!enabled) return;

    const update = (clientX: number, clientY: number) => {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
      lastPointerClientRef.current = { clientX, clientY };
    };

    const onPointerMove = (e: PointerEvent) => update(e.clientX, e.clientY);
    const onMouseMove = (e: MouseEvent) => update(e.clientX, e.clientY);

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [enabled]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const pending = pendingRef.current;
    if (!pending) return;
    if (Math.abs(effectiveScale - pending.nextScale) > 1e-4) return;

    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const viewW = el.clientWidth || rect.width;
    const viewH = el.clientHeight || rect.height;
    const maxLeft = Math.max(0, el.scrollWidth - viewW);
    const maxTop = Math.max(0, el.scrollHeight - viewH);

    const ratio = pending.prevScale > 0 ? pending.nextScale / pending.prevScale : 1;

    const containerLeft = rect.left + el.clientLeft;
    const containerTop = rect.top + el.clientTop;

    let anchorLeftS = 0;
    let anchorTopS = 0;

    if (pending.kind === 'page') {
      const pageEl =
        pending.pageNumber && pending.pageNumber > 0
          ? el.querySelector<HTMLElement>(`[data-pdf-page='${pending.pageNumber}']`)
          : null;
      if (pageEl) {
        const pageRect = pageEl.getBoundingClientRect();
        anchorLeftS = pageRect.left - containerLeft + el.scrollLeft;
        anchorTopS = pageRect.top - containerTop + el.scrollTop;
      } else {
        pendingRef.current = null;
        return;
      }
    } else if (pending.kind === 'root') {
      const rootEl = el.querySelector<HTMLElement>('.pdf-viewer');
      if (rootEl) {
        const rootRect = rootEl.getBoundingClientRect();
        anchorLeftS = rootRect.left - containerLeft + el.scrollLeft;
        anchorTopS = rootRect.top - containerTop + el.scrollTop;
      } else {
        pendingRef.current = null;
        return;
      }
    }

    const targetLeft = anchorLeftS + pending.localX * ratio - pending.px;
    const targetTop = anchorTopS + pending.localY * ratio - pending.py;

    el.scrollLeft = clamp(targetLeft, 0, maxLeft);
    el.scrollTop = clamp(targetTop, 0, maxTop);

    pendingRef.current = null;
  }, [containerRef, effectiveScale, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    const applyZoomAt = (nextScale: number, clientXRaw: number, clientYRaw: number) => {
      const rect = el.getBoundingClientRect();
      const viewW = el.clientWidth || rect.width;
      const viewH = el.clientHeight || rect.height;

      const containerLeft = rect.left + el.clientLeft;
      const containerTop = rect.top + el.clientTop;

      const isPointInsideContainer = (clientX: number, clientY: number) => {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const hit = document.elementFromPoint(clientX, clientY);
        return hit instanceof Element && el.contains(hit);
      };

      const fallbackClientX = lastPointerClientRef.current?.clientX ?? NaN;
      const fallbackClientY = lastPointerClientRef.current?.clientY ?? NaN;

      const pickClientPoint = () => {
        if (isPointInsideContainer(fallbackClientX, fallbackClientY))
          return { clientX: fallbackClientX, clientY: fallbackClientY };
        if (isPointInsideContainer(clientXRaw, clientYRaw)) return { clientX: clientXRaw, clientY: clientYRaw };
        return { clientX: containerLeft + viewW / 2, clientY: containerTop + viewH / 2 };
      };

      const { clientX, clientY } = pickClientPoint();

      const toPxPy = (clientXIn: number, clientYIn: number) => {
        const localX = Number.isFinite(clientXIn) ? clientXIn - containerLeft : NaN;
        const localY = Number.isFinite(clientYIn) ? clientYIn - containerTop : NaN;

        const px = Number.isFinite(localX) && viewW > 0 ? clamp(localX, 0, viewW) : viewW > 0 ? viewW / 2 : 0;
        const py = Number.isFinite(localY) && viewH > 0 ? clamp(localY, 0, viewH) : viewH > 0 ? viewH / 2 : 0;

        const inBounds =
          Number.isFinite(localX) &&
          Number.isFinite(localY) &&
          localX >= 0 &&
          localX <= viewW &&
          localY >= 0 &&
          localY <= viewH;

        return { px, py, inBounds };
      };

      const { px, py } = toPxPy(clientX, clientY);

      const prevScrollTop = el.scrollTop;
      const prevScrollLeft = el.scrollLeft;
      const prevRenderedScale = renderedScaleRef.current;

      const viewX = prevScrollLeft + px;
      const viewY = prevScrollTop + py;

      const elAtPoint =
        Number.isFinite(clientX) && Number.isFinite(clientY) ? document.elementFromPoint(clientX, clientY) : null;
      const within = elAtPoint instanceof Element && el.contains(elAtPoint);
      const closestPage = within ? (elAtPoint as Element).closest<HTMLElement>('[data-pdf-page]') : null;
      const pageNumber = closestPage ? Number(closestPage.getAttribute('data-pdf-page') ?? '') : NaN;

      const anchorEl =
        closestPage && Number.isFinite(pageNumber) && pageNumber > 0
          ? closestPage
          : el.querySelector<HTMLElement>('.pdf-viewer');

      if (anchorEl) {
        const anchorRect = anchorEl.getBoundingClientRect();
        const pointerInsideAnchor =
          Number.isFinite(clientX) &&
          Number.isFinite(clientY) &&
          clientX >= anchorRect.left &&
          clientX <= anchorRect.right &&
          clientY >= anchorRect.top &&
          clientY <= anchorRect.bottom;

        if (pointerInsideAnchor) {
          const anchorLeftS = anchorRect.left - containerLeft + prevScrollLeft;
          const anchorTopS = anchorRect.top - containerTop + prevScrollTop;

          pendingRef.current = {
            kind: closestPage && Number.isFinite(pageNumber) && pageNumber > 0 ? 'page' : 'root',
            pageNumber: closestPage && Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined,
            localX: viewX - anchorLeftS,
            localY: viewY - anchorTopS,
            px,
            py,
            prevScale: prevRenderedScale,
            nextScale,
          };

          (el as unknown as { __sprSkipScaleSyncForScale?: number }).__sprSkipScaleSyncForScale = nextScale;
          setFitWidth(false);
          setScale(nextScale);
          desiredScaleRef.current = nextScale;
          return;
        }
      }

      pendingRef.current = {
        kind: 'scroll',
        localX: viewX,
        localY: viewY,
        px,
        py,
        prevScale: prevRenderedScale,
        nextScale,
      };

      (el as unknown as { __sprSkipScaleSyncForScale?: number }).__sprSkipScaleSyncForScale = nextScale;
      setFitWidth(false);
      setScale(nextScale);
      desiredScaleRef.current = nextScale;
    };

    const onWheel = (e: WheelEvent) => {
      const isZoomGesture = e.ctrlKey || e.metaKey;
      if (!isZoomGesture) return;

      e.preventDefault();
      e.stopPropagation();

      let deltaY = e.deltaY;
      if (e.deltaMode === 1) deltaY *= 16;
      else if (e.deltaMode === 2) deltaY *= 800;

      // Coalesce wheel events to one zoom update per animation frame for smoother zooming.
      wheelAccumRef.current += deltaY;
      wheelClientRef.current = { clientX: e.clientX, clientY: e.clientY };

      if (wheelRafRef.current != null) return;
      wheelRafRef.current = window.requestAnimationFrame(() => {
        wheelRafRef.current = null;

        const prevDesiredScale = desiredScaleRef.current;
        const MAX_DELTA_PX = 320;
        const ZOOM_SPEED = 0.012;
        const delta = clamp(wheelAccumRef.current, -MAX_DELTA_PX, MAX_DELTA_PX);
        wheelAccumRef.current = 0;

        const factor = Math.exp(-delta * ZOOM_SPEED);
        const nextScale = clamp(prevDesiredScale * factor, minScale, maxScale);
        if (!Number.isFinite(nextScale) || Math.abs(nextScale - prevDesiredScale) < 1e-8) return;

        const client = wheelClientRef.current;
        applyZoomAt(nextScale, client?.clientX ?? NaN, client?.clientY ?? NaN);
      });
    };

    const onGestureStart = (e: Event) => {
      const ge = e as WebkitGestureEvent;
      if (!Number.isFinite(ge.scale)) return;
      gestureStartScaleRef.current = desiredScaleRef.current;
      e.preventDefault();
      e.stopPropagation();
    };

    const onGestureChange = (e: Event) => {
      const ge = e as WebkitGestureEvent;
      const base = gestureStartScaleRef.current ?? desiredScaleRef.current;
      const gestureScale = Number.isFinite(ge.scale) ? ge.scale : 1;
      const nextScale = clamp(base * gestureScale, minScale, maxScale);
      if (!Number.isFinite(nextScale) || Math.abs(nextScale - desiredScaleRef.current) < 1e-8) return;
      e.preventDefault();
      e.stopPropagation();
      applyZoomAt(nextScale, ge.clientX, ge.clientY);
    };

    const onGestureEnd = (e: Event) => {
      gestureStartScaleRef.current = null;
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });

    return () => {
      el.removeEventListener('wheel', onWheel as EventListener);
      if (wheelRafRef.current != null) {
        window.cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
      el.removeEventListener('gestureend', onGestureEnd as EventListener);
    };
  }, [containerRef, enabled, maxScale, minScale, setFitWidth, setScale]);
}
