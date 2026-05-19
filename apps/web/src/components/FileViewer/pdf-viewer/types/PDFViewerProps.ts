/**
 * PDFViewer 组件的属性接口定义
 * 用于配置和控制PDF文档的显示、交互和行为
 */
export interface PDFViewerProps {
  /**
   * PDF文件的URL或Base64字符串
   * 当提供此属性时，PDFViewer将加载并显示指定的PDF文档
   * @example "https://example.com/document.pdf" 或 "data:application/pdf;base64,xxx"
   */
  file: string | null;

  /**
   * 当前选中的文档ID
   * 用于标识当前正在查看的PDF文档，在多文档场景中使用
   */
  selectedId?: number;

  /**
   * PDF文档加载成功的回调函数
   * 当PDF文档加载完成并获取到总页数后触发
   * @param numPages - PDF文档的总页数
   */
  onDocumentLoadSuccess?: (numPages: number) => void;

  /**
   * 文件选择回调函数
   * 当用户通过界面选择PDF文件时触发
   * @param file - 用户选择的File对象
   */
  onFileSelect?: (file: File) => void;

  /**
   * 附加的CSS类名
   * 用于自定义PDFViewer组件的样式
   */
  className?: string;

  /**
   * 需要高亮显示的文本内容
   * PDFViewer会自动搜索并高亮显示匹配的文本
   */
  highlightText?: string;

  /**
   * 外部传入的索引高亮（按 bbox + page_idx 定位，page_idx 从 1 开始）
   *
   * bbox 格式：[x0, y0, x1, y1]，其中 (x0,y0) 为左上角、(x1,y1) 为右下角（原点左上，y 向下）
   */
  highlightIndex?: {
    indexId: number;
    documentId?: number;
    type?: string;
    title?: string;
    index: {
      bbox: [number, number, number, number];
      type?: string;
      page_idx: number;
    };
    content?: string;
    imageUrl?: string | null;
  } | null;

  /**
   * 跳转到指定页面
   * 设置此属性将使PDFViewer滚动到指定页面
   */
  scrollToPage?: number;

  /**
   * 页面跳转变化的回调函数
   * 当页面跳转操作完成时触发
   * @param page - 实际跳转到的页面号
   */
  onScrollToPageChange?: (page: number) => void;

  /**
   * 当前页面变化的回调函数
   * 当用户滚动或跳转导致当前页面变化时触发
   * @param page - 当前所在的页面号
   */
  onCurrentPageChange?: (page: number) => void;

  /**
   * 划词后点击「问Chat」
   */
  onSelectionAskChat?: (payload: { pageNumber: number; text: string }) => void;

  /**
   * 划词后点击「翻译」
   */
  onSelectionTranslate?: (payload: { pageNumber: number; text: string }) => void;

  /**
   * 划词后点击「加入FlowNote」
   */
  onSelectionAddFlowNote?: (payload: { pageNumber: number; text: string }) => void;

  /**
   * 划词后点击「高亮」
   */
  onSelectionHighlight?: (payload: { pageNumber: number; text: string }) => void;
}
