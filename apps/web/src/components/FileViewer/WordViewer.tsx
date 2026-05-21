'use client'
import { useEffect, useRef, useState } from 'react'
import mammoth from 'mammoth'

interface WordViewerProps {
  fileUrl: string
  paragraphIdx?: number
  highlightText?: string
}

export function WordViewer({ fileUrl, paragraphIdx, highlightText }: WordViewerProps) {
  const [html, setHtml] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  // Track which jump has been applied to avoid infinite retrigger
  const appliedJumpRef = useRef<string>('')

  useEffect(() => {
    fetch(fileUrl)
      .then(r => r.arrayBuffer())
      .then(buf => mammoth.convertToHtml({ arrayBuffer: buf }))
      .then(result => setHtml(result.value))
  }, [fileUrl])

  useEffect(() => {
    if (!containerRef.current || !html) return

    // Build a stable key so the same jump doesn't re-fire
    const jumpKey = `${highlightText ?? ''}::${paragraphIdx ?? ''}`
    if (!jumpKey.replace(/::/g, '') || appliedJumpRef.current === jumpKey) return
    appliedJumpRef.current = jumpKey

    // Clear previous highlights
    containerRef.current.querySelectorAll('[data-rag-highlight]').forEach(el => {
      el.removeAttribute('style')
      el.removeAttribute('data-rag-highlight')
    })

    // Strategy 1: text search — find the element whose text best matches chunk_text
    if (highlightText && highlightText.trim().length > 3) {
      const needle = highlightText.trim().substring(0, 60).toLowerCase()
      let bestEl: Element | null = null
      let bestScore = 0
      containerRef.current.querySelectorAll('p, td, li, h1, h2, h3, h4').forEach(el => {
        const elText = (el.textContent ?? '').toLowerCase()
        if (elText.length === 0) return
        // Count matching characters as simple overlap score
        let matches = 0
        for (const ch of needle) {
          if (elText.includes(ch)) matches++
        }
        const score = matches / needle.length
        if (score > bestScore && score > 0.5) {
          bestScore = score
          bestEl = el
        }
      })
      if (bestEl) {
        ;(bestEl as HTMLElement).style.backgroundColor = '#fef08a'
        ;(bestEl as HTMLElement).setAttribute('data-rag-highlight', '1')
        ;(bestEl as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }

    // Strategy 2: fall back to paragraph index
    if (paragraphIdx !== undefined) {
      const paras = containerRef.current.querySelectorAll('p')
      const target = paras[paragraphIdx] as HTMLElement | undefined
      if (target) {
        target.style.backgroundColor = '#fef08a'
        target.setAttribute('data-rag-highlight', '1')
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [html, highlightText, paragraphIdx])

  return (
    <div
      ref={containerRef}
      className="p-6 overflow-auto h-full prose max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
