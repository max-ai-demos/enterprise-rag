'use client'
import { useEffect, useState } from 'react'

interface TextViewerProps { fileUrl: string; highlightText?: string }

export function TextViewer({ fileUrl, highlightText }: TextViewerProps) {
  const [text, setText] = useState('')

  useEffect(() => {
    fetch(fileUrl).then(r => r.text()).then(setText)
  }, [fileUrl])

  const content = highlightText
    ? text.replace(
        new RegExp(highlightText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        match => `<mark class="bg-yellow-200">${match}</mark>`
      )
    : text

  return (
    <div
      className="p-6 overflow-auto h-full font-mono text-sm whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: content }}
    />
  )
}
