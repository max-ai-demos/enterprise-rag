'use client'
import { useEffect, useRef, useState } from 'react'
import { SourceCard, type Source } from './SourceCard'
import { MarkdownMessage } from './MarkdownMessage'
import type { JumpLocation } from './ViewerPanel'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}

interface Session {
  id: string
  title: string
  updated_at: string
}

interface ChatPanelProps {
  userId: string
  sessionId: string | null
  mode: 'upload' | 'demo'
  onSessionCreated?: (sessionId: string) => void
  onJumpToSource?: (loc: JumpLocation) => void
}

export function ChatPanel({ userId, sessionId, mode, onSessionCreated, onJumpToSource }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId)
  const [showSidebar, setShowSidebar] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeSessionRef = useRef<string | null>(sessionId)
  // Prevent loadHistory from overwriting in-flight streaming messages
  const streamingRef = useRef(false)

  useEffect(() => {
    activeSessionRef.current = sessionId
    setActiveSessionId(sessionId)
    // Don't clobber in-flight streaming messages when a new session is being created
    if (sessionId && !streamingRef.current) loadHistory(sessionId)
    else if (!sessionId) setMessages([])
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (userId && mode === 'upload') loadSessions()
  }, [userId, mode])

  async function loadSessions() {
    const res = await fetch(`/api/agent/sessions?user_id=${userId}`)
    if (res.ok) setSessions(await res.json())
  }

  async function loadHistory(sid: string) {
    const res = await fetch(`/api/agent/sessions/${sid}/messages?user_id=${userId}`)
    if (!res.ok) return
    const data = await res.json()
    setMessages(data.map((m: { id: string; role: 'user' | 'assistant'; content: string; sources?: Source[] }) => ({
      id: m.id, role: m.role, content: m.content, sources: m.sources ?? [],
    })))
  }

  function startNewConversation() {
    activeSessionRef.current = null
    setActiveSessionId(null)
    setMessages([])
    onSessionCreated?.('')
    setShowSidebar(false)
  }

  async function switchSession(sid: string) {
    activeSessionRef.current = sid
    setActiveSessionId(sid)
    setShowSidebar(false)
    await loadHistory(sid)
    onSessionCreated?.(sid)
  }

  async function sendMessage() {
    if (!input.trim() || loading) return
    const query = input.trim()
    setInput('')
    setLoading(true)

    const userMsg: Message = { id: `user-${Date.now()}`, role: 'user', content: query }
    const assistantId = `asst-${Date.now()}`
    const placeholder: Message = { id: assistantId, role: 'assistant', content: '', sources: [] }

    setMessages(prev => [...prev, userMsg, placeholder])
    streamingRef.current = true

    try {
      // Use streaming endpoint
      const streamRes = await fetch('/api/agent/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          user_id: userId,
          session_id: activeSessionRef.current ?? undefined,
          mode,
        }),
      })
      if (!streamRes.ok) throw new Error('Stream request failed')

      const reader = streamRes.body!.getReader()
      const decoder = new TextDecoder()

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; session_id?: string; sources?: Source[]; content?: string; message?: string }
            if (event.type === 'sources') {
              if (!activeSessionRef.current && event.session_id) {
                activeSessionRef.current = event.session_id
                setActiveSessionId(event.session_id)
                onSessionCreated?.(event.session_id)
                loadSessions()
              }
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, sources: event.sources ?? [] } : m))
            }
            if (event.type === 'delta') {
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + (event.content ?? '') } : m))
            }
            if (event.type === 'error') {
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: event.message ?? '出错了，请重试' } : m))
            }
          } catch { /* skip malformed SSE line */ }
        }
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: '请求失败，请重试' } : m))
    } finally {
      streamingRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full">
      {/* Session sidebar — only in upload mode */}
      {mode === 'upload' && showSidebar && (
        <div className="w-56 border-r bg-gray-50 flex flex-col shrink-0">
          <div className="p-3 border-b flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600">历史对话</span>
            <button onClick={() => setShowSidebar(false)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
          </div>
          <button
            onClick={startNewConversation}
            className="mx-2 mt-2 mb-1 px-3 py-2 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 text-left font-medium"
          >
            + 新对话
          </button>
          <div className="flex-1 overflow-y-auto">
            {sessions.map(s => (
              <button
                key={s.id}
                onClick={() => switchSession(s.id)}
                className={`w-full text-left px-3 py-2 text-xs truncate transition-colors ${
                  s.id === activeSessionId
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {s.title || '新对话'}
              </button>
            ))}
            {sessions.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">暂无历史对话</p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-white shrink-0">
          <div className="flex items-center gap-2">
            {mode === 'upload' && (
              <button
                onClick={() => setShowSidebar(v => !v)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
                title="历史对话"
              >
                ☰
              </button>
            )}
            <span className="text-sm font-medium text-gray-700">
              {mode === 'demo' ? 'Feature Demo' : '知识库问答'}
            </span>
          </div>
          <button
            onClick={startNewConversation}
            className="text-xs text-gray-500 hover:text-blue-600 px-2 py-1 rounded hover:bg-gray-100 flex items-center gap-1"
          >
            <span>＋</span> 新对话
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-400">提问即可开始对话</p>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm shadow-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border text-gray-800'
              }`}>
                {msg.role === 'assistant' ? (
                  <>
                    <MarkdownMessage
                      content={msg.content}
                      sources={msg.sources ?? []}
                      onJump={loc => onJumpToSource?.(loc)}
                    />
                    {msg.sources && msg.sources.length > 0 && (
                      <SourceCard sources={msg.sources} onJump={loc => onJumpToSource?.(loc)} />
                    )}
                  </>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border rounded-xl px-4 py-3 text-sm shadow-sm text-gray-500">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t bg-white p-4 shrink-0">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="输入问题，按 Enter 发送..."
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              disabled={loading}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
