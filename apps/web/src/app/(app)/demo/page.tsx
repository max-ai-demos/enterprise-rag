'use client'
import { useEffect, useState } from 'react'
import { ViewerPanel, type JumpLocation } from '@/components/ViewerPanel'
import { ChatPanel } from '@/components/ChatPanel'

interface Doc { document_id: string; filename: string; file_type: string; status: string; chunk_count: number }

export default function DemoPage() {
  const [userId, setUserId] = useState('')
  const [docs, setDocs] = useState<Doc[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [jumpLocation, setJumpLocation] = useState<JumpLocation | null>(null)
  const [mobileTab, setMobileTab] = useState<'doc' | 'chat'>('chat')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => setUserId(d.user_id))
    fetch('/api/demo-docs').then(r => r.json()).then(d => setDocs(Array.isArray(d) ? d : []))
  }, [])

  function handleJump(loc: JumpLocation) {
    setActiveDocId(loc.document_id)
    setJumpLocation(loc)
    setMobileTab('doc')
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      {/* Mobile tab bar */}
      <div className="flex border-b bg-white md:hidden shrink-0">
        <button
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${mobileTab === 'chat' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
        >
          对话
        </button>
        <button
          onClick={() => setMobileTab('doc')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${mobileTab === 'doc' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
        >
          文档
        </button>
      </div>

      {/* Desktop: side by side. Mobile: single panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* KB document sidebar — desktop only */}
        <aside className="hidden md:flex w-52 shrink-0 border-r bg-slate-50 flex-col gap-2 p-3 overflow-y-auto">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">知识库文档</p>
          {docs.length === 0 ? (
            <p className="text-xs text-slate-400">加载中…</p>
          ) : (
            docs.map(doc => (
              <div key={doc.document_id} className="bg-white rounded-lg border border-slate-200 p-2">
                <p className="text-xs font-medium text-slate-700 truncate" title={doc.filename}>{doc.filename}</p>
                <p className="text-xs text-slate-400 mt-0.5">{doc.file_type.toUpperCase()} · {doc.chunk_count ?? 0} 片段</p>
                <span className="inline-block mt-1 text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium">已索引</span>
              </div>
            ))
          )}
        </aside>

        <div className={`w-full md:w-[55%] md:shrink-0 min-w-0 ${mobileTab === 'doc' ? 'flex' : 'hidden'} flex-col md:flex`}>
          <ViewerPanel
            docs={docs.filter(d => d.status === 'ready')}
            activeDocId={activeDocId}
            jumpLocation={jumpLocation}
            mode="demo"
          />
        </div>
        <div className={`w-full md:flex-1 min-w-0 ${mobileTab === 'chat' ? 'flex' : 'hidden'} flex-col md:flex`}>
          {userId && (
            <ChatPanel
              userId={userId}
              sessionId={sessionId}
              mode="demo"
              onSessionCreated={sid => { if (sid) setSessionId(sid) }}
              onJumpToSource={handleJump}
            />
          )}
        </div>
      </div>
    </div>
  )
}
