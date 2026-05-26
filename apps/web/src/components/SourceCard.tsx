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

export function sourceToJump(s: Source): JumpLocation {
  return {
    document_id: s.document_id,
    file_type: s.file_type,
    page_num: s.page_num,
    page_idx: s.page_idx,
    bbox: s.bbox,
    paragraph_idx: s.paragraph_idx,
    sheet_name: s.sheet_name,
    row_start: s.row_start,
    chunk_text: s.chunk_text,
  }
}

function sourceLabel(s: Source): string {
  if (s.file_type === 'pdf' && s.page_num) return `第${s.page_num}页`
  if (s.file_type === 'docx' && s.paragraph_idx !== undefined) return `第${s.paragraph_idx + 1}段`
  if (s.file_type === 'xlsx' && s.sheet_name) return `${s.sheet_name} 第${s.row_start}行`
  return ''
}

interface SourceCardProps {
  sources: Source[]
  onJump: (loc: JumpLocation) => void
}

export function SourceCard({ sources, onJump }: SourceCardProps) {
  if (!sources.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100">
      {sources.map((s, i) => (
        <button
          key={i}
          onClick={() => onJump(sourceToJump(s))}
          className="inline-flex items-center gap-1.5 px-2 py-1 bg-gray-50 text-gray-600 text-xs rounded-md border border-gray-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors"
        >
          <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-orange-500 text-white text-[10px] font-bold shrink-0">
            R
          </span>
          <span className="max-w-[100px] truncate">{s.filename}</span>
          {sourceLabel(s) && <span className="text-slate-500 shrink-0">{sourceLabel(s)}</span>}
        </button>
      ))}
    </div>
  )
}

/** Inline chip rendered inside message text at [来源N] positions */
interface InlineRefProps {
  index: number
  source: Source
  onJump: (loc: JumpLocation) => void
}

export function InlineRef({ index, source, onJump }: InlineRefProps) {
  return (
    <button
      onClick={() => onJump(sourceToJump(source))}
      title={`${source.filename} ${sourceLabel(source)}`}
      className="inline-flex items-center justify-center w-5 h-5 rounded bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-bold align-middle mx-0.5 transition-colors cursor-pointer shrink-0"
      style={{ verticalAlign: 'super', fontSize: '10px', lineHeight: '1' }}
    >
      {index}
    </button>
  )
}

/** Parse message content and replace [来源N] with inline ref chips */
export function renderWithInlineRefs(
  content: string,
  sources: Source[],
  onJump: (loc: JumpLocation) => void
): React.ReactNode[] {
  // Matches [来源1], [来源2], etc.
  const parts = content.split(/(\[来源\d+\])/g)
  return parts.map((part, i) => {
    const m = part.match(/^\[来源(\d+)\]$/)
    if (m) {
      const idx = parseInt(m[1], 10)
      const source = sources[idx - 1]
      if (source) {
        return <InlineRef key={i} index={idx} source={source} onJump={onJump} />
      }
      // Source not yet loaded (still streaming), show placeholder chip
      return (
        <span
          key={i}
          className="inline-flex items-center justify-center w-5 h-5 rounded bg-orange-300 text-white text-[10px] font-bold align-middle mx-0.5"
          style={{ verticalAlign: 'super', fontSize: '10px', lineHeight: '1' }}
        >
          {idx}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

// Re-export React for renderWithInlineRefs
import React from 'react'
