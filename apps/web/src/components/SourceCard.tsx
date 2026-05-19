import type { JumpLocation } from './ViewerPanel'

export interface Source {
  document_id: string
  filename: string
  file_type: 'pdf' | 'docx' | 'xlsx' | 'txt'
  page_num?: number
  page_idx?: number
  bbox?: [number, number, number, number]
  paragraph_idx?: number
  sheet_name?: string
  row_start?: number
  chunk_text: string
  score: number
}

interface SourceCardProps {
  sources: Source[]
  onJump: (loc: JumpLocation) => void
}

function sourceLabel(s: Source): string {
  if (s.file_type === 'pdf' && s.page_num) return `第${s.page_num}页`
  if (s.file_type === 'docx' && s.paragraph_idx !== undefined) return `第${s.paragraph_idx + 1}段`
  if (s.file_type === 'xlsx' && s.sheet_name) return `${s.sheet_name} 第${s.row_start}行`
  return ''
}

export function SourceCard({ sources, onJump }: SourceCardProps) {
  if (!sources.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {sources.map((s, i) => (
        <button
          key={i}
          onClick={() => onJump({
            document_id: s.document_id,
            file_type: s.file_type,
            page_num: s.page_num,
            page_idx: s.page_idx,
            bbox: s.bbox,
            paragraph_idx: s.paragraph_idx,
            sheet_name: s.sheet_name,
            row_start: s.row_start,
            chunk_text: s.chunk_text,
          })}
          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md border border-blue-200 hover:bg-blue-100 transition-colors"
        >
          <span>📎</span>
          <span className="max-w-[120px] truncate">{s.filename}</span>
          {sourceLabel(s) && <span className="text-blue-400 shrink-0">{sourceLabel(s)}</span>}
          <span className="text-blue-400 shrink-0">→</span>
        </button>
      ))}
    </div>
  )
}
