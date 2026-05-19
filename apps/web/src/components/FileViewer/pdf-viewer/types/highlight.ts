export interface HighlightArea {
  /**
   * Highlight area ID.
   */
  id: string;
  /**
   * Page number.
   */
  pageNumber: number;
  /**
   * Highlight area position percent
   */
  x: number;
  /**
   * Highlight area position percent.
   */
  y: number;
  /**
   * Highlight area width percent.
   */
  width: number;
  /**
   * Highlight area height percent.
   */
  height: number;
  /**
   * Highlight area color.
   */
  color: string;
  /**
   * Optional border style, e.g. "2px solid #FFD700".
   */
  border?: string;
  /**
   * Highlight area opacity.
   */
  opacity?: number;
}
