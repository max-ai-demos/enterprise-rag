'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

interface NavBarProps { username: string }

export function NavBar({ username }: NavBarProps) {
  const pathname = usePathname()
  const router = useRouter()

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
    <nav className="border-b bg-white px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <span className="font-semibold text-gray-900">企业知识库</span>
        <Link href="/demo" className={linkClass('/demo')}>Feature Demo</Link>
        <Link href="/chat" className={linkClass('/chat')}>我的知识库</Link>
      </div>
      <div className="flex items-center gap-3 text-sm text-gray-600">
        <span>{username}</span>
        <button onClick={logout} className="text-gray-500 hover:text-red-500">退出</button>
      </div>
    </nav>
  )
}
