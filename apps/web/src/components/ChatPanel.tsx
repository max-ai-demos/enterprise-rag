'use client'
import { useEffect, useRef, useState } from 'react'
import { SourceCard, type Source } from './SourceCard'
import type { JumpLocation } from './ViewerPanel'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
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
  const bottomRef = useRef<HTMLDivElement>(null)
  const currentSessionRef = useRef<string | null>(sessionId)

  useEffect(() => {
    currentSessionRef.current = sessionId
    if (sessionId) loadHistory(sessionId)
    else setMessages([])
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadHistory(sid: string) {
    const res = await fetch(`/api/agent/sessions/${sid}/messages?user_id=${userId}`)
    if (!res.ok) return
    const data = await res.json()
    setMessages(data.map((m: { id: string; role: 'user' | 'assistant'; content: string; sources?: Source[] }) => ({
      id: m.id, role: m.role, content: m.content, sources: m.sources ?? [],
    })))
  }

  async function sendMessage() {
    if (!input.trim() || loading) return
    const query = input.trim()
    setInput('')
    setLoading(true)

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: query }
    setMessages(prev => [...prev, userMsg])

    try {
      const res = await fetch('/api/agent/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          user_id: userId,
          session_id: currentSessionRef.current,
          mode,
        }),
      })
      const data = await res.json()

      if (data.session_id && !currentSessionRef.current) {
        currentSessionRef.current = data.session_id
        onSessionCreated?.(data.session_id)
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.answer ?? '出错了，请重试',
        sources: data.sources ?? [],
      }])
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '请求失败，请重试',
        sources: [],
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-white shrink-0">
        <span className="text-sm font-medium text-gray-700">
          {mode === 'demo' ? 'Feature Demo' : '知识库问答'}
        </span>
        <button
          onClick={() => {
            currentSessionRef.current = null
            setMessages([])
            onSessionCreated?.('')
          }}
          className="text-xs text-gray-500 hover:text-blue-600 px-2 py-1 rounded hover:bg-gray-100"
        >
          ↺ 新对话
        </button>
      </div>
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
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                <SourceCard sources={msg.sources} onJump={loc => onJumpToSource?.(loc)} />
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
  )
}
