import type { HighlightArea } from '../types/highlight';

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function detectBboxUnit(bbox: [number, number, number, number]) {
  const values = bbox.map((n) => Number(n));
  const max = Math.max(...values.map((n) => Math.abs(n)));
  if (!Number.isFinite(max)) return { kind: 'unknown' as const };
  // Common formats:
  // - normalized: [0..1000]
  // - pdf/page points: typically much larger (e.g. width ~595, height ~842, but can exceed 1000)
  if (max <= 1000) return { kind: 'normalized' as const, base: 1000 };
  return { kind: 'page' as const };
}

function bboxToPageRect(opts: {
  bbox: [number, number, number, number];
  originalWidth: number;
  originalHeight: number;
}) {
  const { bbox, originalWidth, originalHeight } = opts;

  const x0 = Number(bbox[0]);
  const y0 = Number(bbox[1]);
  const x1 = Number(bbox[2]);
  const y1 = Number(bbox[3]);
  if (![x0, y0, x1, y1].every((n) => Number.isFinite(n))) return null;

  const unit = detectBboxUnit(bbox);
  if (unit.kind === 'unknown') return null;

  if (unit.kind === 'normalized') {
    const base = unit.base;
    return {
      left: Math.min(x0, x1) * (originalWidth / base),
      right: Math.max(x0, x1) * (originalWidth / base),
      top: Math.min(y0, y1) * (originalHeight / base),
      bottom: Math.max(y0, y1) * (originalHeight / base),
    };
  }

  return {
    left: Math.min(x0, x1),
    right: Math.max(x0, x1),
    top: Math.min(y0, y1),
    bottom: Math.max(y0, y1),
  };
}

export function bboxToScrollOffsetTopPx(opts: {
  bbox: [number, number, number, number];
  originalHeight: number;
  scale: number;
}) {
  const { bbox, originalHeight, scale } = opts;
  if (!(originalHeight > 0)) return 0;
  if (!(typeof scale === 'number' && Number.isFinite(scale) && scale > 0)) return 0;

  const unit = detectBboxUnit(bbox);
  const y0 = Number(bbox[1]);
  const y1 = Number(bbox[3]);
  if (![y0, y1].every((n) => Number.isFinite(n))) return 0;

  const top = Math.min(y0, y1);
  if (unit.kind === 'normalized') {
    return Math.max(0, top * (originalHeight / unit.base) * scale);
  }
  return Math.max(0, top * scale);
}

export function bboxToHighlightArea(opts: {
  id: string;
  pageNumber: number;
  bbox: [number, number, number, number];
  originalWidth: number;
  originalHeight: number;
  color: string;
  border?: string;
  opacity?: number;
}): HighlightArea | null {
  const { id, pageNumber, bbox, originalWidth, originalHeight, color, border, opacity } = opts;

  if (!(typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber >= 1)) return null;
  if (!(originalWidth > 0 && originalHeight > 0)) return null;

  const rect = bboxToPageRect({ bbox, originalWidth, originalHeight });
  if (!rect) return null;

  const x = clampPct((rect.left / originalWidth) * 100);
  const width = clampPct(((rect.right - rect.left) / originalWidth) * 100);
  const y = clampPct((rect.top / originalHeight) * 100);
  const height = clampPct(((rect.bottom - rect.top) / originalHeight) * 100);

  return {
    id,
    pageNumber,
    x,
    y,
    width,
    height,
    color,
    border,
    opacity,
  };
}
