'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

interface NavBarProps { username: string }

export function NavBar({ username }: NavBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [version, setVersion] = useState('')

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => setVersion(d.version ?? '')).catch(() => {})
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const linkClass = (path: string) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      pathname.startsWith(path)
        ? 'bg-blue-100 text-blue-700'
        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
    }`

  return (
    <nav className="border-b bg-white px-3 md:px-6 py-2 md:py-3 flex items-center justify-between shrink-0 gap-2">
      <div className="flex items-center gap-2 md:gap-6 min-w-0">
        <div className="flex items-baseline gap-1 shrink-0">
          <span className="font-semibold text-gray-900 text-sm md:text-base">企业知识库</span>
          {version && <span className="text-[10px] text-gray-400 hidden md:inline">v{version}</span>}
        </div>
        <Link href="/demo" className={linkClass('/demo') + ' text-xs md:text-sm px-2 md:px-3'}>Demo</Link>
        <Link href="/chat" className={linkClass('/chat') + ' text-xs md:text-sm px-2 md:px-3'}>我的知识库</Link>
      </div>
      <div className="flex items-center gap-2 md:gap-3 text-sm text-gray-600 shrink-0">
        <span className="text-xs md:text-sm truncate max-w-[60px] md:max-w-none">{username}</span>        <a href="https://demo.luyaxiang.com" className="text-xs text-gray-400 hover:text-blue-600 whitespace-nowrap hidden sm:inline">← 演示平台</a>

        <button onClick={logout} className="text-gray-500 hover:text-red-500 text-xs md:text-sm whitespace-nowrap">退出</button>
      </div>
    </nav>
  )
}
