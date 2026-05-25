'use client'
import { useEffect, useState } from 'react'
import { ViewerPanel, type JumpLocation } from '@/components/ViewerPanel'
import { ChatPanel } from '@/components/ChatPanel'

interface Doc { document_id: string; filename: string; file_type: string; status: string }

export default function DemoPage() {
  const [userId, setUserId] = useState('')
  const [docs, setDocs] = useState<Doc[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [jumpLocation, setJumpLocation] = useState<JumpLocation | null>(null)
  const [mobileTab, setMobileTab] = useState<'doc' | 'chat'>('chat')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => setUserId(d.user_id))
    fetch('/api/agent/documents/demo').then(r => r.json()).then(d => setDocs(Array.isArray(d) ? d : []))
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
