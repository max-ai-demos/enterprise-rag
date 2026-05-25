'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

interface NavBarProps {
  username: string
  showTrialTab?: boolean
  trialLabel?: string
}

export function NavBar({ username, showTrialTab = false, trialLabel = '试用' }: NavBarProps) {
  const pathname = usePathname()
  const [version, setVersion] = useState('')

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => setVersion(d.version ?? '')).catch(() => {})
  }, [])

  const tabClass = (path: string) => {
    const active = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(path + '/')
    return `flex items-center px-3.5 h-[52px] text-sm border-b-2 whitespace-nowrap transition-colors ${
      active
        ? 'border-blue-600 text-blue-600 font-medium'
        : 'border-transparent text-slate-500 hover:text-slate-700'
    }`
  }

  return (
    <nav className="h-[52px] bg-white border-b border-slate-200 shadow-[0_1px_4px_rgba(0,0,0,0.05)] flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-3">
        <span className="font-bold text-sm text-slate-900">企业知识库</span>
        {version && (
          <span className="text-[10px] font-medium bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
            v{version}
          </span>
        )}
        <div className="w-px h-5 bg-slate-200 mx-0.5" />
        <div className="flex items-stretch h-[52px]">
          <Link href="/" className={tabClass('/')}>应用场景</Link>
          <Link href="/demo" className={tabClass('/demo')}>Demo</Link>
          {showTrialTab && (
            <Link href="/trial" className={tabClass('/trial')}>{trialLabel}</Link>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-[26px] h-[26px] rounded-full bg-blue-50 flex items-center justify-center text-[11px] font-bold text-blue-600 shrink-0">
          {username.charAt(0).toUpperCase()}
        </div>
        <span className="text-xs text-slate-500 hidden sm:inline">{username}</span>
        <a
          href="https://demo.luyaxiang.com"
          className="border border-slate-200 px-3 py-1 rounded-md text-xs text-slate-500 hover:border-blue-500 hover:text-blue-600 transition-colors whitespace-nowrap"
        >
          ← 演示平台
        </a>
      </div>
    </nav>
  )
}
