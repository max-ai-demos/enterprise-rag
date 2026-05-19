'use client'
import { useEffect, useRef, useState } from 'react'
import mammoth from 'mammoth'

interface WordViewerProps {
  fileUrl: string
  paragraphIdx?: number
  highlightText?: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function WordViewer({ fileUrl, paragraphIdx, highlightText }: WordViewerProps) {
  const [html, setHtml] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(fileUrl)
      .then(r => r.arrayBuffer())
      .then(buf => mammoth.convertToHtml({ arrayBuffer: buf }))
      .then(result => setHtml(result.value))
  }, [fileUrl])

  useEffect(() => {
    if (!containerRef.current || paragraphIdx === undefined) return
    const paras = containerRef.current.querySelectorAll('p')
    const target = paras[paragraphIdx]
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('bg-yellow-100')
    }
  }, [html, paragraphIdx])

  return (
    <div
      ref={containerRef}
      className="p-6 overflow-auto h-full prose max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
