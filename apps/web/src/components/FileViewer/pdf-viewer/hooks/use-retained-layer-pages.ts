/* eslint-disable react-hooks/refs */
import { useRef } from 'react';

/**
 * 保持已激活的 TextLayer/AnnotationLayer 不被立即卸载，
 * 避免 pdfjs AbortException: "TextLayer task cancelled" 警告。
 *
 * 当页面滚出可见范围时，其 Layer 不会立即卸载（这会取消进行中的渲染任务并触发警告），
 * 而是保留直到页面远离可视区域（渲染必然已完成），此时卸载是安全的。
 */
export function useRetainedLayerPages(visiblePageIndices: number[], retainDistance: number = 5): Set<number> {
  'use no memo';
  const retainedRef = useRef<Set<number>>(new Set());

  // 添加当前可见页到保留集合
  for (const idx of visiblePageIndices) {
    retainedRef.current.add(idx);
  }

  // 清理远离可视区域的页面
  if (visiblePageIndices.length > 0) {
    const minVisible = Math.min(...visiblePageIndices);
    const maxVisible = Math.max(...visiblePageIndices);
    for (const idx of retainedRef.current) {
      if (idx < minVisible - retainDistance || idx > maxVisible + retainDistance) {
        retainedRef.current.delete(idx);
      }
    }
  }

  return retainedRef.current;
}
