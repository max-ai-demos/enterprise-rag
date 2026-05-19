import { useEffect } from 'react';
import { usePdfAction, usePdfState } from '../context/PdfContext';

/**
 * useAutoScale
 * 监听容器宽度变化，自动调整PDF显示比例
 */
export type UseAutoScaleParams = {
  enabled?: boolean;
};

export const useAutoScale = ({ enabled = true }: UseAutoScaleParams = {}) => {
  const { setScale } = usePdfAction();
  const { pdfPaneWidth, originalWidth, originalHeight, rotate, scale } = usePdfState();

  useEffect(() => {
    if (!enabled) return;
    const isRotated = rotate % 180 !== 0;
    const denom = isRotated ? originalHeight : originalWidth;
    if (!(pdfPaneWidth > 0 && denom > 0)) return;
    const next = pdfPaneWidth / denom;
    if (Math.abs(next - scale) < 0.002) return;
    setScale(next);
  }, [enabled, originalHeight, originalWidth, pdfPaneWidth, rotate, scale, setScale]);
};
