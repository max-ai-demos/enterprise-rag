'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const PdfViewer = dynamic(
  () => import('./FileViewer/pdf-viewer/components/PDFViewer').then(m => m.PDFViewer),
  { ssr: false }
)
const WordViewer = dynamic(() => import('./FileViewer/WordViewer').then(m => m.WordViewer), { ssr: false })
const ExcelViewer = dynamic(() => import('./FileViewer/ExcelViewer').then(m => m.ExcelViewer), { ssr: false })
const TextViewer = dynamic(() => import('./FileViewer/TextViewer').then(m => m.TextViewer), { ssr: false })

export interface JumpLocation {
  document_id: string
  file_type: 'pdf' | 'docx' | 'xlsx' | 'txt'
  page_num?: number
  page_idx?: number
  bbox?: [number, number, number, number]
  paragraph_idx?: number
  sheet_name?: string
  row_start?: number
  chunk_text?: string
}

interface Doc {
  document_id: string
  filename: string
  file_type: string
  status: string
}

interface ViewerPanelProps {
  docs: Doc[]
  activeDocId: string | null
  jumpLocation: JumpLocation | null
  mode: 'demo' | 'chat'
  userId?: string
  onUploaded?: () => void
}

function fileIcon(type: string) {
  if (type === 'pdf') return '📄'
  if (type === 'docx') return '📝'
  if (type === 'xlsx') return '📊'
  return '📃'
}

function Viewer({ doc, jump }: { doc: Doc; jump: JumpLocation | null }) {
  const fileUrl = `/api/agent/documents/file/${doc.document_id}`
  // Pre-fetch PDF with credentials so pdfjs worker (cross-origin) receives data directly
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  useEffect(() => {
    if (doc.file_type !== 'pdf') return
    let revoke: string | null = null
    fetch(fileUrl)
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob)
        revoke = url
        setPdfBlobUrl(url)
      })
      .catch(() => setPdfBlobUrl(null))
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [fileUrl, doc.file_type])

  switch (doc.file_type) {
    case 'pdf':
      return (
        <PdfViewer
          file={pdfBlobUrl}
          scrollToPage={jump?.page_num}
          highlightText={jump?.chunk_text}
          highlightIndex={
            jump?.bbox
              ? {
                  indexId: Date.now(),
                  index: {
                    page_idx: jump.page_idx ?? jump.page_num ?? 1,
                    bbox: jump.bbox,
                  },
                }
              : undefined
          }
        />
      )
    case 'docx':
      return (
        <WordViewer
          fileUrl={fileUrl}
          paragraphIdx={jump?.paragraph_idx}
          highlightText={jump?.chunk_text}
        />
      )
    case 'xlsx':
      return (
        <ExcelViewer
          fileUrl={fileUrl}
          sheetName={jump?.sheet_name}
          rowStart={jump?.row_start}
        />
      )
    case 'txt':
      return <TextViewer fileUrl={fileUrl} highlightText={jump?.chunk_text} />
    default:
      return <div className="p-4 text-sm text-gray-500">不支持此格式预览</div>
  }
}

export function ViewerPanel({ docs, activeDocId, jumpLocation, mode, userId, onUploaded }: ViewerPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryProgress, setSummaryProgress] = useState<{ current: number; total: number } | null>(null)
  const [showSummary, setShowSummary] = useState(false)

  useEffect(() => {
    if (!selectedId && docs.length > 0) {
      const first = docs.find(d => d.status === 'ready') ?? docs[0]
      setSelectedId(first.document_id)
    }
  }, [docs, selectedId])

  useEffect(() => {
    if (activeDocId) setSelectedId(activeDocId)
  }, [activeDocId])

  useEffect(() => {
    setSummaryText(null)
    setShowSummary(false)
    setSummaryProgress(null)
  }, [selectedId])

  const selectedDoc = docs.find(d => d.document_id === selectedId) ?? null
  const activeJump = jumpLocation?.document_id === selectedId ? jumpLocation : null

  async function uploadFile(file: File) {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    // user_id is injected via x-user-id header by the proxy

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/agent/documents/upload')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        setUploadProgress(null)
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`Upload failed: ${xhr.status}`))
      }
      xhr.onerror = () => { setUploadProgress(null); reject(new Error('Upload error')) }
      xhr.send(form)
    })

    onUploaded?.()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }, [userId, onUploaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => setDragOver(false), [])

  async function fetchSummary() {
    if (!selectedDoc) return
    setShowSummary(true)
    if (summaryText) return
    setSummaryLoading(true)
    setSummaryText('')
    setSummaryProgress(null)
    try {
      const res = await fetch(`/api/agent/documents/${selectedDoc.document_id}/summary/stream`, {
        method: 'POST',
      })
      if (!res.ok) { setSummaryText('生成摘要失败，请重试。'); return }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; content?: string; current?: number; total?: number }
            if (event.type === 'progress') {
              setSummaryProgress({ current: event.current ?? 0, total: event.total ?? 1 })
            }
            if (event.type === 'delta') {
              setSummaryLoading(false)
              setSummaryProgress(null)
              setSummaryText(prev => (prev ?? '') + (event.content ?? ''))
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch {
      setSummaryText('网络错误，请重试。')
    } finally {
      setSummaryLoading(false)
      setSummaryProgress(null)
    }
  }

  return (
    <div
      className={`flex flex-col h-full border-r bg-white relative ${dragOver ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
      onDrop={mode === 'chat' ? handleDrop : undefined}
      onDragOver={mode === 'chat' ? handleDragOver : undefined}
      onDragLeave={mode === 'chat' ? handleDragLeave : undefined}
    >
      {dragOver && (
        <div className="absolute inset-0 z-20 bg-blue-50/80 flex items-center justify-center pointer-events-none">
          <p className="text-blue-600 font-medium text-sm">松开即可上传</p>
        </div>
      )}

      <div className="flex items-center gap-1 px-3 py-2 border-b bg-gray-50 overflow-x-auto shrink-0 min-h-[42px]">
        {docs.map(doc => (
          <button
            key={doc.document_id}
            onClick={() => setSelectedId(doc.document_id)}
            className={`flex items-center gap-1 px-3 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
              selectedId === doc.document_id
                ? 'bg-white border shadow-sm text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span>{fileIcon(doc.file_type)}</span>
            <span className="max-w-[120px] truncate">{doc.filename}</span>
            {doc.status === 'processing' && (
              <span className="text-[10px] text-orange-500 ml-1">处理中</span>
            )}
          </button>
        ))}
        {docs.length === 0 && (
          <span className="text-xs text-gray-400">暂无文档</span>
        )}
        {mode === 'chat' && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.xlsx,.txt"
              onChange={handleFileInput}
            />
            <button
              onClick={fetchSummary}
              disabled={!selectedDoc || selectedDoc.status !== 'ready'}
              className="ml-auto px-2 py-1 text-xs text-purple-600 hover:bg-purple-50 rounded whitespace-nowrap disabled:opacity-40 shrink-0"
            >
              总结
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadProgress !== null}
              className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded whitespace-nowrap disabled:opacity-50 shrink-0"
            >
              {uploadProgress !== null ? `上传中 ${uploadProgress}%` : '+ 上传'}
            </button>
          </>
        )}
      </div>

      {/* Upload progress bar */}
      {uploadProgress !== null && (
        <div className="w-full h-1 bg-gray-100 shrink-0">
          <div
            className="h-1 bg-blue-500 transition-all duration-200"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}

      {showSummary && (
        <div className="border-b bg-purple-50 px-4 py-3 shrink-0 max-h-56 overflow-y-auto relative">
          <button
            onClick={() => setShowSummary(false)}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-xs"
          >
            ✕
          </button>
          <p className="text-xs font-semibold text-purple-700 mb-2">文档摘要</p>
          {summaryLoading && !summaryProgress && (
            <p className="text-xs text-gray-500">初始化…</p>
          )}
          {summaryProgress && (
            <p className="text-xs text-gray-500">分析文档中 {summaryProgress.current}/{summaryProgress.total}…</p>
          )}
          {summaryText !== null && summaryText !== '' && (
            <div className="prose prose-xs max-w-none text-gray-700
              prose-headings:text-gray-800 prose-headings:font-semibold prose-headings:text-xs prose-headings:mt-2 prose-headings:mb-1
              prose-p:my-0.5 prose-p:text-xs prose-p:leading-relaxed
              prose-ul:my-0.5 prose-ul:pl-4 prose-li:my-0 prose-li:text-xs
              prose-strong:text-gray-900 prose-strong:font-semibold
            ">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryText}</ReactMarkdown>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {selectedDoc ? (
          <Viewer doc={selectedDoc} jump={activeJump} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-sm text-gray-400 gap-2">
            {mode === 'chat' ? (
              <>
                <p>点击右上角「+ 上传」或将文件拖拽至此</p>
                <p className="text-xs">支持 PDF、Word、Excel、TXT</p>
              </>
            ) : (
              <p>暂无演示文档</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
