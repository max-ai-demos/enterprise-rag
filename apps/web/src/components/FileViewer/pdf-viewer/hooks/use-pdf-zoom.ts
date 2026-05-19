import { useCallback, useMemo } from 'react';
import { clamp } from '../utils/number';

export type UsePdfZoomParams = {
  effectiveScale: number;
  fitWidth: boolean;
  setFitWidth: (next: boolean) => void;
  setScale: (next: number) => void;
  minScale?: number;
  maxScale?: number;
  presetScales?: number[];
  stepPercent?: number;
};

const DEFAULT_PRESET_SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function usePdfZoom({
  effectiveScale,
  fitWidth,
  setFitWidth,
  setScale,
  minScale = 0.25,
  maxScale = 3,
  presetScales = DEFAULT_PRESET_SCALES,
  stepPercent = 10,
}: UsePdfZoomParams) {
  const presets = useMemo(() => {
    const uniq = Array.from(new Set(presetScales)).sort((a, b) => a - b);
    return uniq.filter((s) => s >= minScale && s <= maxScale);
  }, [maxScale, minScale, presetScales]);

  const currentScale = effectiveScale;

  const setZoomScale = useCallback(
    (next: number) => {
      setFitWidth(false);
      setScale(clamp(next, minScale, maxScale));
    },
    [maxScale, minScale, setFitWidth, setScale],
  );

  const setZoomPercent = useCallback(
    (percent: number) => {
      setZoomScale(percent / 100);
    },
    [setZoomScale],
  );

  const selectPageFit = useCallback(() => {
    setFitWidth(true);
  }, [setFitWidth]);

  const stepByPercent = useCallback(
    (direction: -1 | 1) => {
      const step = Number.isFinite(stepPercent) && stepPercent > 0 ? stepPercent : 10;
      const currentPercent = Math.round(currentScale * 100);
      const nextPercent = clamp(currentPercent + direction * step, minScale * 100, maxScale * 100);
      setZoomPercent(nextPercent);
    },
    [currentScale, maxScale, minScale, setZoomPercent, stepPercent],
  );

  const zoomInPreset = useCallback(() => stepByPercent(1), [stepByPercent]);
  const zoomOutPreset = useCallback(() => stepByPercent(-1), [stepByPercent]);

  const percent = Math.round(currentScale * 100);

  return {
    presets,
    presetPercents: presets.map((s) => Math.round(s * 100)),
    percent,
    setZoomScale,
    setZoomPercent,
    selectPageFit,
    zoomInPreset,
    zoomOutPreset,
  };
}
