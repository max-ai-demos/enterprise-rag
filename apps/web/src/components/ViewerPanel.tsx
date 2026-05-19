'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'

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
  switch (doc.file_type) {
    case 'pdf':
      return (
        <PdfViewer
          file={fileUrl}
          scrollToPage={jump?.page_num}
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
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!selectedId && docs.length > 0) {
      const first = docs.find(d => d.status === 'ready') ?? docs[0]
      setSelectedId(first.document_id)
    }
  }, [docs, selectedId])

  useEffect(() => {
    if (activeDocId) setSelectedId(activeDocId)
  }, [activeDocId])

  const selectedDoc = docs.find(d => d.document_id === selectedId) ?? null
  const activeJump = jumpLocation?.document_id === selectedId ? jumpLocation : null

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !userId) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('user_id', userId)
    await fetch('/api/agent/documents/upload', { method: 'POST', body: form })
    setUploading(false)
    onUploaded?.()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="flex flex-col h-full border-r bg-white">
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
              onChange={handleUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="ml-auto px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded whitespace-nowrap disabled:opacity-50 shrink-0"
            >
              {uploading ? '上传中...' : '+ 上传'}
            </button>
          </>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        {selectedDoc ? (
          <Viewer doc={selectedDoc} jump={activeJump} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            {mode === 'chat' ? '点击右上角「+ 上传」添加文档' : '暂无演示文档'}
          </div>
        )}
      </div>
    </div>
  )
}
