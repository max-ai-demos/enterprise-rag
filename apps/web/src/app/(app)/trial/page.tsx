'use client'
import { useEffect, useState } from 'react'
import { ViewerPanel, type JumpLocation } from '@/components/ViewerPanel'
import { ChatPanel } from '@/components/ChatPanel'

interface Doc { document_id: string; filename: string; file_type: string; status: string }

export default function TrialPage() {
  const [userId, setUserId] = useState('')
  const [docs, setDocs] = useState<Doc[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [jumpLocation, setJumpLocation] = useState<JumpLocation | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      setUserId(d.user_id)
      fetch(`/api/agent/documents?user_id=${d.user_id}`).then(r => r.json()).then(setDocs)
    })
  }, [])

  function refreshDocs() {
    fetch(`/api/agent/documents?user_id=${userId}`).then(r => r.json()).then(setDocs)
  }

  function handleJump(loc: JumpLocation) {
    setActiveDocId(loc.document_id)
    setJumpLocation(loc)
  }

  return (
    <div className="flex w-full h-full overflow-hidden">
      <div className="w-[55%] min-w-0 shrink-0">
        <ViewerPanel
          docs={docs}
          activeDocId={activeDocId}
          jumpLocation={jumpLocation}
          mode="chat"
          userId={userId}
          onUploaded={refreshDocs}
        />
      </div>
      <div className="flex-1 min-w-0">
        {userId && (
          <ChatPanel
            userId={userId}
            sessionId={sessionId}
            mode="upload"
            onSessionCreated={sid => { if (sid) setSessionId(sid) }}
            onJumpToSource={handleJump}
          />
        )}
      </div>
    </div>
  )
}
