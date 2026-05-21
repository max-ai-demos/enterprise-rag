'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import React from 'react'
import { InlineRef, type Source } from './SourceCard'
import type { JumpLocation } from './ViewerPanel'

interface MarkdownMessageProps {
  content: string
  sources: Source[]
  onJump: (loc: JumpLocation) => void
}

/** Split text at [来源N] markers and return mixed text+chip nodes */
function injectRefs(text: string, sources: Source[], onJump: (loc: JumpLocation) => void): React.ReactNode[] {
  const parts = text.split(/(\[来源\d+\])/g)
  return parts.map((part, i) => {
    const m = part.match(/^\[来源(\d+)\]$/)
    if (m) {
      const idx = parseInt(m[1], 10)
      const src = sources[idx - 1]
      if (src) return <InlineRef key={i} index={idx} source={src} onJump={onJump} />
      return (
        <span
          key={i}
          className="inline-flex items-center justify-center w-5 h-5 rounded bg-orange-300 text-white text-[10px] font-bold mx-0.5"
          style={{ verticalAlign: 'super', lineHeight: '1' }}
        >
          {idx}
        </span>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}

/** Wrap any ReactMarkdown text-children to inject R chips */
function wrapChildren(children: React.ReactNode, sources: Source[], onJump: (loc: JumpLocation) => void): React.ReactNode {
  return React.Children.map(children, child => {
    if (typeof child === 'string') {
      const parts = injectRefs(child, sources, onJump)
      // If no chips found, return string as-is
      if (parts.every(p => typeof p === 'string' || (React.isValidElement(p) && p.type === React.Fragment))) return child
      return <>{parts}</>
    }
    return child
  })
}

export function MarkdownMessage({ content, sources, onJump }: MarkdownMessageProps) {
  const hasSources = sources.length > 0

  return (
    <div className="prose prose-sm max-w-none text-gray-800
      prose-headings:text-gray-800 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
      prose-p:my-1 prose-p:leading-relaxed
      prose-ul:my-1 prose-ul:pl-4 prose-li:my-0.5
      prose-ol:my-1 prose-ol:pl-4
      prose-strong:text-gray-900 prose-strong:font-semibold
      prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded prose-code:text-xs
      prose-table:text-xs prose-table:border-collapse
      prose-th:border prose-th:border-gray-200 prose-th:px-2 prose-th:py-1 prose-th:bg-gray-50
      prose-td:border prose-td:border-gray-200 prose-td:px-2 prose-td:py-1
    ">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Inject R chips into paragraph text nodes
          p: ({ children }) => (
            <p className="my-1 leading-relaxed">
              {hasSources ? wrapChildren(children, sources, onJump) : children}
            </p>
          ),
          // Inject into list items too
          li: ({ children }) => (
            <li>{hasSources ? wrapChildren(children, sources, onJump) : children}</li>
          ),
          // Don't render bare hrefs as links — just text
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{children}</a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
