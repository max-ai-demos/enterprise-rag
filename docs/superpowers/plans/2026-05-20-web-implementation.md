# Web Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js 14 web app with login, Feature Demo, and personal knowledge base chat — all backed by the Python agent via plain JSON responses.

**Architecture:** Next.js App Router. API Routes handle auth (JWT/httpOnly cookie) and proxy all agent calls. `better-sqlite3` reads the shared SQLite DB for user verification. Pages: `/login`, `/demo`, `/chat`. Split-screen layout: left 55% = `ViewerPanel` (document viewer with file tabs + upload); right 45% = `ChatPanel` (chat with source jump cards). No streaming — chat uses simple `POST → JSON`. PDF viewer copied from xxx-ai-frontend — uses `highlightIndex` (bbox-based canvas overlay rectangle) for exact source highlighting, plus `scrollToPage` for navigation. Word/Excel rendered client-side with mammoth.js/SheetJS.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, better-sqlite3, jose (JWT), mammoth.js, SheetJS (xlsx)

**Prerequisites:** Agent is running on `localhost:8000`, database initialized via `scripts/init_db.py`.

---

## File Map

```
apps/web/
  package.json
  tsconfig.json
  tailwind.config.ts
  next.config.ts
  middleware.ts                      ← JWT cookie check, redirect /login
  .env.local.example
  src/
    lib/
      db.ts                          ← better-sqlite3 singleton
      auth.ts                        ← JWT sign/verify with jose
      agent.ts                       ← fetch helpers for agent API
    app/
      layout.tsx                     ← root layout, fonts
      (auth)/
        login/
          page.tsx                   ← login form
      (app)/
        layout.tsx                   ← app shell with nav bar
        demo/
          page.tsx                   ← Feature Demo page
        chat/
          page.tsx                   ← Personal knowledge base page
    api/
      auth/
        login/route.ts               ← POST /api/auth/login
        logout/route.ts              ← POST /api/auth/logout
        me/route.ts                  ← GET /api/auth/me
      agent/
        [...path]/route.ts           ← Proxy all /api/agent/* → agent:8000
    components/
      NavBar.tsx                     ← top navigation bar
      ViewerPanel.tsx                ← left panel: file tabs + viewer dispatch + upload
      ChatPanel.tsx                  ← right panel: messages + input (plain JSON, no SSE)
      SourceCard.tsx                 ← citation chips with jump callback
      FileViewer/
        PdfViewer.tsx                ← copied from xxx-ai-frontend
        WordViewer.tsx               ← mammoth.js → HTML + paragraph highlight
        ExcelViewer.tsx              ← SheetJS → table + row highlight
        TextViewer.tsx               ← plain text with highlight
```

---

## Task 1: Next.js scaffold

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/.env.local.example`

- [ ] **Step 1.1: Scaffold Next.js project**

```bash
cd apps/web
npx create-next-app@14 . --typescript --tailwind --app --no-src-dir --import-alias "@/*"
# When asked "Would you like to use src/ directory?" → No
# Restructure: move generated app/ into src/app/
mkdir -p src
mv app src/
mv components src/ 2>/dev/null || true
```

- [ ] **Step 1.2: Install additional dependencies**

```bash
npm install better-sqlite3 jose mammoth xlsx
npm install -D @types/better-sqlite3 @types/node
```

- [ ] **Step 1.3: Create .env.local.example**

```bash
# apps/web/.env.local.example
# AGENT_URL: update to match running agent port (start-local-agent.sh writes port to .runtime/local-agent-port)
# Default 8001; smart-agriculture owns 8000 so agent never runs there.
AGENT_URL=http://localhost:8001
JWT_SECRET=enterprise-rag-secret-2026
DATABASE_PATH=../../data/enterprise_rag.db
```

```bash
cp .env.local.example .env.local
# If agent is on a different port, update AGENT_URL in .env.local accordingly
```

- [ ] **Step 1.4: Update next.config.ts**

```typescript
// apps/web/next.config.ts
// output:'standalone' bundles everything needed to run without node_modules
// required by start-local-web.sh which runs .next/standalone/server.js
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: { serverComponentsExternalPackages: ['better-sqlite3'] },
}

export default nextConfig
```

- [ ] **Step 1.4b: Update package.json scripts**

Add `copy:standalone-assets` and `start` (same pattern as smart-agriculture):

```json
"scripts": {
  "dev": "next dev -H 0.0.0.0 -p 3001",
  "build": "next build",
  "copy:standalone-assets": "mkdir -p .next/standalone/.next && rm -rf .next/standalone/.next/static && cp -R .next/static .next/standalone/.next/static && if [ -d public ]; then rm -rf .next/standalone/public && cp -R public .next/standalone/public; fi",
  "start": "npm run copy:standalone-assets && HOSTNAME=0.0.0.0 PORT=3001 node .next/standalone/server.js"
}
```

Note: uses port **3001** to avoid conflict when smart-agriculture runs on 3000.

- [ ] **Step 1.5: Verify dev server starts**

```bash
npm run dev
# Visit http://localhost:3000
# Expected: Next.js default page loads
```

- [ ] **Step 1.6: Commit**

```bash
git add apps/web/
git commit -m "feat(web): Next.js 14 project scaffold"
```

---

## Task 2: Auth utilities

**Files:**
- Create: `apps/web/src/lib/db.ts`
- Create: `apps/web/src/lib/auth.ts`

- [ ] **Step 2.1: Create db.ts**

```typescript
// apps/web/src/lib/db.ts
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.resolve(process.cwd(), process.env.DATABASE_PATH ?? '../../data/enterprise_rag.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: false })
    _db.pragma('journal_mode = WAL')
  }
  return _db
}

export interface DbUser {
  id: string
  username: string
  password_hash: string
  role: string
  is_active: number
}

export function getUserByUsername(username: string): DbUser | undefined {
  return getDb()
    .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
    .get(username) as DbUser | undefined
}
```

- [ ] **Step 2.2: Create auth.ts**

```typescript
// apps/web/src/lib/auth.ts
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'enterprise-rag-secret-2026'
)
const COOKIE_NAME = 'rag_token'
const EXPIRES_IN = '7d'

export interface JwtPayload {
  user_id: string
  username: string
  role: string
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(SECRET)
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as JwtPayload
  } catch {
    return null
  }
}

export async function getSession(): Promise<JwtPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  }
}

export { COOKIE_NAME }
```

- [ ] **Step 2.3: Commit**

```bash
git add apps/web/src/lib/
git commit -m "feat(web): database access and JWT auth utilities"
```

---

## Task 3: Auth API routes

**Files:**
- Create: `apps/web/src/app/api/auth/login/route.ts`
- Create: `apps/web/src/app/api/auth/logout/route.ts`
- Create: `apps/web/src/app/api/auth/me/route.ts`

- [ ] **Step 3.1: Create login route**

```typescript
// apps/web/src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getUserByUsername } from '@/lib/db'
import { signToken, cookieOptions, COOKIE_NAME } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()

  if (!username || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
  }

  const user = getUserByUsername(username)
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = await signToken({
    user_id: user.id,
    username: user.username,
    role: user.role,
  })

  const res = NextResponse.json({ username: user.username, role: user.role })
  res.cookies.set(COOKIE_NAME, token, cookieOptions())
  return res
}
```

> Note: install bcryptjs: `npm install bcryptjs && npm install -D @types/bcryptjs`

- [ ] **Step 3.2: Create logout and me routes**

```typescript
// apps/web/src/app/api/auth/logout/route.ts
import { NextResponse } from 'next/server'
import { COOKIE_NAME } from '@/lib/auth'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
  return res
}
```

```typescript
// apps/web/src/app/api/auth/me/route.ts
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ user_id: session.user_id, username: session.username, role: session.role })
}
```

- [ ] **Step 3.3: Install bcryptjs and test login**

```bash
npm install bcryptjs && npm install -D @types/bcryptjs
npm run dev

curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@2026"}'
# Expected: {"username":"admin","role":"admin"} + Set-Cookie header

curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"wrong"}'
# Expected: 401 {"error":"Invalid credentials"}
```

- [ ] **Step 3.4: Commit**

```bash
git add apps/web/src/app/api/auth/
git commit -m "feat(web): login, logout, and me API routes"
```

---

## Task 4: Middleware (route protection)

**Files:**
- Create: `apps/web/middleware.ts`

- [ ] **Step 4.1: Create middleware.ts**

```typescript
// apps/web/middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

const PUBLIC_PATHS = ['/login', '/api/auth/login']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const payload = await verifyToken(token)
  if (!payload) {
    const res = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 4.2: Test protection**

```bash
# Without cookie → should redirect to /login
curl -L http://localhost:3000/demo
# Expected: redirected to login page HTML
```

- [ ] **Step 4.3: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat(web): JWT middleware protecting all routes"
```

---

## Task 5: Agent proxy and lib

**Files:**
- Create: `apps/web/src/lib/agent.ts`
- Create: `apps/web/src/app/api/agent/[...path]/route.ts`

- [ ] **Step 5.1: Create agent.ts**

```typescript
// apps/web/src/lib/agent.ts
const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8000'

export async function agentFetch(path: string, init?: RequestInit) {
  const url = `${AGENT_URL}${path}`
  const res = await fetch(url, init)
  return res
}
```

- [ ] **Step 5.2: Create agent proxy route**

```typescript
// apps/web/src/app/api/agent/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8000'

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path } = await params
  const agentPath = '/' + path.join('/')
  const url = new URL(req.url)
  const agentUrl = `${AGENT_URL}${agentPath}${url.search}`

  const headers = new Headers(req.headers)
  headers.set('x-user-id', session.user_id)

  const body = req.method !== 'GET' && req.method !== 'HEAD'
    ? req.body
    : undefined

  const agentRes = await fetch(agentUrl, {
    method: req.method,
    headers,
    body,
    // @ts-ignore
    duplex: 'half',
  })

  return new NextResponse(agentRes.body, {
    status: agentRes.status,
    headers: agentRes.headers,
  })
}

export const GET = proxy
export const POST = proxy
export const DELETE = proxy
```

- [ ] **Step 5.3: Test proxy**

```bash
# With valid cookie:
curl http://localhost:3000/api/agent/health \
  -H "Cookie: rag_token=<your_token>"
# Expected: {"status":"ok"}
```

- [ ] **Step 5.4: Commit**

```bash
git add apps/web/src/lib/ apps/web/src/app/api/agent/
git commit -m "feat(web): agent proxy route and fetch helper"
```

---

## Task 6: Login page

**Files:**
- Create: `apps/web/src/app/(auth)/login/page.tsx`

- [ ] **Step 6.1: Create login page**

```tsx
// apps/web/src/app/(auth)/login/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (res.ok) {
        router.push('/demo')
      } else {
        const data = await res.json()
        setError(data.error ?? '登录失败')
      }
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-center mb-6">企业知识库</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="请输入用户名"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="请输入密码"
              required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 6.2: Create root redirect**

```tsx
// apps/web/src/app/page.tsx
import { redirect } from 'next/navigation'
export default function Home() { redirect('/demo') }
```

- [ ] **Step 6.3: Test login flow**

```
1. Visit http://localhost:3000 → redirected to /login (middleware)
2. Enter admin / Admin@2026 → redirected to /demo
3. Enter wrong password → error message shown
```

- [ ] **Step 6.4: Commit**

```bash
git add apps/web/src/app/
git commit -m "feat(web): login page with JWT cookie auth"
```

---

## Task 7: App layout and NavBar

**Files:**
- Create: `apps/web/src/app/(app)/layout.tsx`
- Create: `apps/web/src/components/NavBar.tsx`

- [ ] **Step 7.1: Create NavBar**

```tsx
// apps/web/src/components/NavBar.tsx
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
```

- [ ] **Step 7.2: Create app layout**

```tsx
// apps/web/src/app/(app)/layout.tsx
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { NavBar } from '@/components/NavBar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <NavBar username={session.username} />
      <main className="flex-1 flex overflow-hidden">{children}</main>
    </div>
  )
}
```

- [ ] **Step 7.3: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): app shell layout with navigation bar"
```

---

## Task 8: File viewers

**Files:**
- Create: `apps/web/src/components/FileViewer/PdfViewer.tsx`
- Create: `apps/web/src/components/FileViewer/WordViewer.tsx`
- Create: `apps/web/src/components/FileViewer/ExcelViewer.tsx`
- Create: `apps/web/src/components/FileViewer/TextViewer.tsx`
- Create: `apps/web/src/components/FileViewer/index.tsx`

- [ ] **Step 8.1: Copy PDF viewer from xxx-ai-frontend**

```bash
cp -r /Users/mac/Desktop/code/web/xxx-ai-frontend/src/features/documents/pdf-viewer \
  apps/web/src/components/FileViewer/pdf-viewer

# The PDFViewer component lives at:
# pdf-viewer/components/PDFViewer/index.tsx
#
# Key props (see xxx-ai-frontend/src/features/documents/pdf-viewer/types/PDFViewerProps.ts):
#   file: string (URL)
#   scrollToPage: number (1-based, scrolls to page when changed)
#   highlightIndex: { indexId: number, index: { page_idx: number, bbox: [x0,y0,x1,y1] } }
#     → draws a gold canvas overlay rectangle at the exact bbox position
#     → page_idx must be 1-based
#     → bbox values are normalized 0-1000 (xxx convention)
#
# Reference: xxx-ai-frontend/src/features/documents/pdf-viewer/utils/highlightIndex.ts
#   bboxToHighlightArea() converts 0-1000 normalized bbox → x/y/width/height percentages
#   detectBboxUnit: if max value ≤ 1000 → treats as normalized; else as PDF points
```

- [ ] **Step 8.2: Create WordViewer.tsx**

```tsx
// apps/web/src/components/FileViewer/WordViewer.tsx
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

  useEffect(() => {
    fetch(fileUrl)
      .then(r => r.arrayBuffer())
      .then(buf => mammoth.convertToHtml({ arrayBuffer: buf }))
      .then(result => setHtml(result.value))
  }, [fileUrl])

  useEffect(() => {
    if (!containerRef.current || paragraphIdx === undefined) return
    const paras = containerRef.current.querySelectorAll('p')
    const target = paras[paragraphIdx]
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('bg-yellow-100')
    }
  }, [html, paragraphIdx])

  return (
    <div
      ref={containerRef}
      className="p-6 overflow-auto h-full prose max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
```

- [ ] **Step 8.3: Create ExcelViewer.tsx**

```tsx
// apps/web/src/components/FileViewer/ExcelViewer.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'

interface ExcelViewerProps {
  fileUrl: string
  sheetName?: string
  rowStart?: number
}

export function ExcelViewer({ fileUrl, sheetName, rowStart }: ExcelViewerProps) {
  const [sheets, setSheets] = useState<Record<string, string[][]>>({})
  const [activeSheet, setActiveSheet] = useState<string>('')
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  useEffect(() => {
    fetch(fileUrl)
      .then(r => r.arrayBuffer())
      .then(buf => {
        const wb = XLSX.read(buf, { type: 'array' })
        const result: Record<string, string[][]> = {}
        wb.SheetNames.forEach(name => {
          const ws = wb.Sheets[name]
          result[name] = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][]
        })
        setSheets(result)
        setActiveSheet(sheetName ?? wb.SheetNames[0])
      })
  }, [fileUrl, sheetName])

  useEffect(() => {
    if (rowStart !== undefined && rowRefs.current[rowStart]) {
      rowRefs.current[rowStart]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [sheets, rowStart])

  const rows = sheets[activeSheet] ?? []

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 px-4 py-2 border-b bg-white">
        {Object.keys(sheets).map(name => (
          <button
            key={name}
            onClick={() => setActiveSheet(name)}
            className={`px-3 py-1 text-sm rounded ${activeSheet === name ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="overflow-auto flex-1 p-4">
        <table className="text-sm border-collapse w-full">
          <tbody>
            {rows.map((row, rIdx) => (
              <tr
                key={rIdx}
                ref={el => { rowRefs.current[rIdx + 1] = el }}
                className={rIdx + 1 === rowStart ? 'bg-yellow-100' : rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                {(row as string[]).map((cell, cIdx) => (
                  <td key={cIdx} className="border px-2 py-1 whitespace-nowrap">
                    {String(cell ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 8.4: Create TextViewer.tsx**

```tsx
// apps/web/src/components/FileViewer/TextViewer.tsx
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
```

- [ ] **Step 8.5: Create ViewerPanel.tsx**

```tsx
// apps/web/src/components/ViewerPanel.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'

const PdfViewer = dynamic(
  () => import('./FileViewer/pdf-viewer/components/PDFViewer').then(m => m.PDFViewer),
  { ssr: false }
)
const WordViewer = dynamic(() => import('./FileViewer/WordViewer').then(m => m.WordViewer), { ssr: false })
const ExcelViewer = dynamic(() => import('./FileViewer/ExcelViewer').then(m => m.ExcelViewer), { ssr: false })
const TextViewer = dynamic(() => import('./FileViewer/TextViewer').then(m => m.TextViewer), { ssr: false })

export interface JumpLocation {
  document_id: string
  file_type: 'pdf' | 'docx' | 'xlsx' | 'txt'
  page_num?: number
  page_idx?: number        // 1-based page for highlightIndex.index.page_idx; equals page_num for PDFs
  bbox?: [number, number, number, number]  // normalized 0-1000, from PyMuPDF ingestion
  paragraph_idx?: number
  sheet_name?: string
  row_start?: number
  chunk_text?: string
}

interface Doc {
  document_id: string
  filename: string
  file_type: string
  status: string
}

interface ViewerPanelProps {
  docs: Doc[]
  activeDocId: string | null
  jumpLocation: JumpLocation | null
  mode: 'demo' | 'chat'
  userId?: string
  onUploaded?: () => void
}

function fileIcon(type: string) {
  if (type === 'pdf') return '📄'
  if (type === 'docx') return '📝'
  if (type === 'xlsx') return '📊'
  return '📃'
}

function Viewer({ doc, jump }: { doc: Doc; jump: JumpLocation | null }) {
  const fileUrl = `/api/agent/documents/file/${doc.document_id}`
  switch (doc.file_type) {
    case 'pdf':
      // Reference: xxx-ai-frontend/src/features/documents/pdf-viewer/components/PDFViewer/index.tsx
      // highlightIndex renders a gold canvas rectangle at the exact bbox position (no text-search needed)
      // page_idx is 1-based; bbox is normalized 0-1000 by PyMuPDF ingestion
      return (
        <PdfViewer
          file={fileUrl}
          scrollToPage={jump?.page_num}
          highlightIndex={
            jump?.bbox
              ? {
                  indexId: Date.now(),
                  index: {
                    page_idx: jump.page_idx ?? jump.page_num ?? 1,
                    bbox: jump.bbox,
                  },
                }
              : undefined
          }
        />
      )
    case 'docx':
      return (
        <WordViewer
          fileUrl={fileUrl}
          paragraphIdx={jump?.paragraph_idx}
          highlightText={jump?.chunk_text}
        />
      )
    case 'xlsx':
      return (
        <ExcelViewer
          fileUrl={fileUrl}
          sheetName={jump?.sheet_name}
          rowStart={jump?.row_start}
        />
      )
    case 'txt':
      return <TextViewer fileUrl={fileUrl} highlightText={jump?.chunk_text} />
    default:
      return <div className="p-4 text-sm text-gray-500">不支持此格式预览</div>
  }
}

export function ViewerPanel({ docs, activeDocId, jumpLocation, mode, userId, onUploaded }: ViewerPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-select first ready doc when docs load
  useEffect(() => {
    if (!selectedId && docs.length > 0) {
      const first = docs.find(d => d.status === 'ready') ?? docs[0]
      setSelectedId(first.document_id)
    }
  }, [docs])

  // Switch to doc when source card is clicked
  useEffect(() => {
    if (activeDocId) setSelectedId(activeDocId)
  }, [activeDocId])

  const selectedDoc = docs.find(d => d.document_id === selectedId) ?? null
  // Only apply jump if it targets the current doc
  const activeJump = jumpLocation?.document_id === selectedId ? jumpLocation : null

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !userId) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('user_id', userId)
    await fetch('/api/agent/documents/upload', { method: 'POST', body: form })
    setUploading(false)
    onUploaded?.()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="flex flex-col h-full border-r bg-white">
      {/* File tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b bg-gray-50 overflow-x-auto shrink-0 min-h-[42px]">
        {docs.map(doc => (
          <button
            key={doc.document_id}
            onClick={() => setSelectedId(doc.document_id)}
            className={`flex items-center gap-1 px-3 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
              selectedId === doc.document_id
                ? 'bg-white border shadow-sm text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span>{fileIcon(doc.file_type)}</span>
            <span className="max-w-[120px] truncate">{doc.filename}</span>
          </button>
        ))}
        {docs.length === 0 && (
          <span className="text-xs text-gray-400">暂无文档</span>
        )}
        {mode === 'chat' && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.xlsx,.txt"
              onChange={handleUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="ml-auto px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded whitespace-nowrap disabled:opacity-50 shrink-0"
            >
              {uploading ? '上传中...' : '+ 上传'}
            </button>
          </>
        )}
      </div>

      {/* Viewer body */}
      <div className="flex-1 overflow-hidden">
        {selectedDoc ? (
          <Viewer doc={selectedDoc} jump={activeJump} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            {mode === 'chat' ? '点击右上角「+ 上传」添加文档' : '暂无演示文档'}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 8.6: Commit**

```bash
git add apps/web/src/components/FileViewer/ apps/web/src/components/ViewerPanel.tsx
git commit -m "feat(web): file viewers and ViewerPanel with tabs, upload, source jump highlight"
```

---

## Task 9: SourceCard and ChatPanel components

**Files:**
- Create: `apps/web/src/components/SourceCard.tsx`
- Create: `apps/web/src/components/ChatPanel.tsx`

- [ ] **Step 9.1: Create SourceCard.tsx**

```tsx
// apps/web/src/components/SourceCard.tsx
import type { JumpLocation } from './ViewerPanel'

export interface Source {
  document_id: string
  filename: string
  file_type: 'pdf' | 'docx' | 'xlsx' | 'txt'
  page_num?: number
  page_idx?: number        // for PDF canvas highlight via highlightIndex
  bbox?: [number, number, number, number]  // normalized 0-1000, extracted by PyMuPDF ingestion
  paragraph_idx?: number
  sheet_name?: string
  row_start?: number
  chunk_text: string
  score: number
}

interface SourceCardProps {
  sources: Source[]
  onJump: (loc: JumpLocation) => void
}

function sourceLabel(s: Source): string {
  if (s.file_type === 'pdf' && s.page_num) return `第${s.page_num}页`
  if (s.file_type === 'docx' && s.paragraph_idx !== undefined) return `第${s.paragraph_idx + 1}段`
  if (s.file_type === 'xlsx' && s.sheet_name) return `${s.sheet_name} 第${s.row_start}行`
  return ''
}

export function SourceCard({ sources, onJump }: SourceCardProps) {
  if (!sources.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {sources.map((s, i) => (
        <button
          key={i}
          onClick={() => onJump({
            document_id: s.document_id,
            file_type: s.file_type,
            page_num: s.page_num,
            page_idx: s.page_idx,
            bbox: s.bbox,
            paragraph_idx: s.paragraph_idx,
            sheet_name: s.sheet_name,
            row_start: s.row_start,
            chunk_text: s.chunk_text,
          })}
          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md border border-blue-200 hover:bg-blue-100 transition-colors"
        >
          <span>📎</span>
          <span className="max-w-[120px] truncate">{s.filename}</span>
          {sourceLabel(s) && <span className="text-blue-400 shrink-0">{sourceLabel(s)}</span>}
          <span className="text-blue-400 shrink-0">→</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 9.2: Create ChatPanel.tsx**

```tsx
// apps/web/src/components/ChatPanel.tsx
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
    setMessages(data.map((m: any) => ({
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
      {/* Header: new chat button */}
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
  )
}
```

- [ ] **Step 9.3: Commit**

```bash
git add apps/web/src/components/SourceCard.tsx apps/web/src/components/ChatPanel.tsx
git commit -m "feat(web): ChatPanel (JSON, no SSE) and SourceCard with source jump"
```

---

## Task 10: Feature Demo page

**Files:**
- Create: `apps/web/src/app/(app)/demo/page.tsx`

- [ ] **Step 10.1: Verify file serving endpoint**

`GET /documents/file/{document_id}` was added to `apps/agent/app/api/document.py` in agent Task 9. Confirm it works before building the demo page:

```bash
# Agent must be running
curl http://localhost:8001/documents/demo
# Pick a document_id from the response, then:
curl http://localhost:8001/documents/file/<document_id> -I
# Expected: HTTP 200 with Content-Disposition header
```

- [ ] **Step 10.2: Create demo page**

```tsx
// apps/web/src/app/(app)/demo/page.tsx
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

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => setUserId(d.user_id))
    fetch('/api/agent/documents/demo').then(r => r.json()).then(setDocs)
  }, [])

  function handleJump(loc: JumpLocation) {
    setActiveDocId(loc.document_id)
    setJumpLocation(loc)
  }

  return (
    <div className="flex w-full h-full overflow-hidden">
      <div className="w-[55%] min-w-0 shrink-0">
        <ViewerPanel
          docs={docs.filter(d => d.status === 'ready')}
          activeDocId={activeDocId}
          jumpLocation={jumpLocation}
          mode="demo"
        />
      </div>
      <div className="flex-1 min-w-0">
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
  )
}
```

- [ ] **Step 10.3: Commit**

```bash
git add apps/web/src/app/(app)/demo/ apps/agent/app/api/document.py
git commit -m "feat(web): Feature Demo page — split-screen viewer + chat"
```

---

## Task 11: Personal knowledge base (Chat) page

**Files:**
- Create: `apps/web/src/app/(app)/chat/page.tsx`

- [ ] **Step 11.1: Create chat page**

```tsx
// apps/web/src/app/(app)/chat/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { ViewerPanel, type JumpLocation } from '@/components/ViewerPanel'
import { ChatPanel } from '@/components/ChatPanel'

interface Doc { document_id: string; filename: string; file_type: string; status: string }

export default function ChatPage() {
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
```

- [ ] **Step 11.2: Commit**

```bash
git add apps/web/src/app/(app)/chat/
git commit -m "feat(web): personal knowledge base page — split-screen viewer + chat"
```

---

## Task 12: End-to-end verification

- [ ] **Step 12.1: Start both services**

```bash
# Terminal 1 - Agent
cd apps/agent && source .venv/bin/activate
uvicorn main:app --reload --port 8000

# Terminal 2 - Web
cd apps/web
npm run dev
```

- [ ] **Step 12.2: Verify full flow**

```
1. Open http://localhost:3001
2. Redirects to /login ✓
3. Login with demo1 / Demo@2026 → redirects to /demo ✓
4. Demo page: left panel shows demo doc tabs, right panel is chat ✓
5. Ask a question → loading dots → JSON answer appears ✓
6. Answer has source chips (📎 filename · 第N页 →) ✓
7. Click source chip → left viewer switches to that file, scrolls + highlights ✓
8. Switch to "我的知识库" → /chat ✓
9. Click "+ 上传" in viewer tab bar → upload a PDF ✓
10. After ingestion, PDF tab appears → ask question → jump to source ✓
11. Click "↺ 新对话" → clears chat, starts fresh session ✓
```

- [ ] **Step 12.3: Final commit**

```bash
git add .
git commit -m "feat: complete enterprise RAG demo - agent + web"
```

---

## Task 13: Web health endpoint

**Files:**
- Create: `apps/web/src/app/api/health/route.ts`

> Pattern from: `smart-agriculture/apps/web/app/api/health/route.ts`

- [ ] **Step 13.1: Create health route**

```typescript
// apps/web/src/app/api/health/route.ts
import { NextResponse } from 'next/server'
import pkg from '../../../../package.json'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'enterprise-rag-web',
    version: pkg.version,
  })
}
```

- [ ] **Step 13.2: Verify**

```bash
curl http://localhost:3001/api/health
# Expected: {"status":"ok","service":"enterprise-rag-web","version":"0.1.0"}
```

- [ ] **Step 13.3: Commit**

```bash
git add apps/web/src/app/api/health/
git commit -m "feat(web): health endpoint with version"
```

---

## Task 14: Start scripts + deploy skill

**Files:**
- Create: `scripts/dev/start-local-agent.sh`
- Create: `scripts/dev/start-local-web.sh`
- Create: `.claude/skills/deploy/SKILL.md`
- Create: `.claude/skills/deploy/references/current-runtime.md`

> Pattern from: `smart-agriculture/.claude/skills/deploy/` + `scripts/dev/`

- [ ] **Step 14.1: Create start-local-agent.sh**

```bash
#!/usr/bin/env bash
# scripts/dev/start-local-agent.sh
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

if [ ! -x "apps/agent/.venv/bin/python" ]; then
  echo "缺少 apps/agent/.venv，请先：cd apps/agent && python -m venv .venv && .venv/bin/pip install -e ."
  exit 1
fi

# Read OpenAI key from Mac keychain
if [ -z "${OPENAI_API_KEY:-}" ]; then
  OPENAI_API_KEY=$(security find-generic-password -s "openai" -a "OPENAI_API_KEY" -w 2>/dev/null || true)
fi
if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "❌ OPENAI_API_KEY 未设置且未在钥匙串找到"
  exit 1
fi
export OPENAI_API_KEY

# Read Mem0 key from Mac keychain (service: enterprise-rag, account: MEM0_API_KEY)
if [ -z "${MEM0_API_KEY:-}" ]; then
  MEM0_API_KEY=$(security find-generic-password -s "enterprise-rag" -a "MEM0_API_KEY" -w 2>/dev/null || true)
fi
export MEM0_API_KEY

find_free_port() {
  for p in 8001 8002 8003 8004 8005; do
    if ! lsof -nP -iTCP:"${p}" -sTCP:LISTEN >/dev/null 2>&1; then echo "${p}"; return 0; fi
  done
  return 1
}

AGENT_PORT=${AGENT_PORT:-$(find_free_port)}
mkdir -p .runtime
printf '%s\n' "${AGENT_PORT}" > .runtime/local-agent-port
echo "enterprise-rag agent 启动端口: ${AGENT_PORT}"

cd apps/agent
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port "${AGENT_PORT}"
```

```bash
chmod +x scripts/dev/start-local-agent.sh
```

- [ ] **Step 14.2: Create start-local-web.sh**

```bash
#!/usr/bin/env bash
# scripts/dev/start-local-web.sh
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

AGENT_PORT=$(cat .runtime/local-agent-port 2>/dev/null || echo "8001")
export AGENT_URL="http://localhost:${AGENT_PORT}"

# Build if .next/standalone doesn't exist
if [ ! -f "apps/web/.next/standalone/server.js" ]; then
  echo "需要先 build：cd apps/web && npm run build"
  exit 1
fi

exec npm --prefix apps/web run start
```

```bash
chmod +x scripts/dev/start-local-web.sh
```

- [ ] **Step 14.3: Create deploy skill**

```markdown
<!-- .claude/skills/deploy/SKILL.md -->
---
name: deploy
description: Use when deploying enterprise-rag in process mode on the maintainer machine. Always uses start-local-agent.sh and start-local-web.sh — never Docker.
---

# Enterprise RAG Process Mode Deploy Workflow

Read [references/current-runtime.md](./references/current-runtime.md) before touching live services.

## Workflow

### 1. Inspect current state
- Run `git status`, `lsof -nP -iTCP -sTCP:LISTEN`, `ps auxww`
- Note processes on ports 3001 (web) and any 8001-8005 (agent)

### 2. Update code
- Check for uncommitted changes before `git pull`
- If web dependencies changed: `npm --prefix apps/web install`
- If agent dependencies changed: `cd apps/agent && .venv/bin/pip install -e .`

### 3. Bump version (patch) — both files must stay in sync

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ working tree 不干净"; exit 1
fi

CURRENT=$(node -p "require('./apps/web/package.json').version")
NEW=$(node -p "const [a,b,c]='$CURRENT'.split('.').map(Number); \`\${a}.\${b}.\${c+1}\`")
echo "Bumping $CURRENT → $NEW"

node -e "
  const fs=require('fs'), p='./apps/web/package.json';
  const pkg=JSON.parse(fs.readFileSync(p));
  pkg.version='$NEW';
  fs.writeFileSync(p, JSON.stringify(pkg,null,2)+'\n');
"
sed -i '' "s/^version = \".*\"/version = \"$NEW\"/" apps/agent/pyproject.toml

git add apps/web/package.json apps/agent/pyproject.toml
git commit -m "chore: bump version to $NEW"
```

- Rebuild web: `npm --prefix apps/web run build`

### 4. Restart services

**Agent:**
```bash
# Kill existing agent process
AGENT_PORT=$(cat .runtime/local-agent-port 2>/dev/null || echo "8001")
pkill -f "uvicorn main:app.*${AGENT_PORT}" || true
bash scripts/dev/start-local-agent.sh &
```

**Web:**
```bash
# Kill existing web process
pkill -f "standalone/server.js" || true
bash scripts/dev/start-local-web.sh &
```

### 5. 验活

```bash
EXPECTED=$(node -p "require('./apps/web/package.json').version")

smoke() {
  local label=$1 base=$2
  echo "=== 验活: $label ==="

  WEB=$(curl -fsS "$base/api/health")
  echo "$WEB" | python3 -m json.tool
  WEB_VER=$(echo "$WEB" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
  [ "$WEB_VER" = "$EXPECTED" ] || { echo "❌ 版本不符 (期望 $EXPECTED, 实际 $WEB_VER)"; return 1; }

  AUTH=$(curl -fsS -X POST "$base/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"demo1","password":"Demo@2026"}' \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("ok" if d.get("user_id") or d.get("username") else "fail")')
  [ "$AUTH" = "ok" ] || { echo "❌ 登录失败"; return 1; }

  echo "✓ $label 验活通过 (version: $EXPECTED)"
}

smoke "localhost" "http://localhost:3001"
smoke "rag.luyaxiang.com" "https://rag.luyaxiang.com"
```

## Quick Reference

- Repo root: `/Users/mac/Desktop/code/ai-demos/enterprise-rag`
- Start agent: `bash scripts/dev/start-local-agent.sh`
- Start web: `bash scripts/dev/start-local-web.sh`
- Local health: `http://localhost:3001/api/health`
- Live health: `https://rag.luyaxiang.com/api/health`
```

- [ ] **Step 14.4: Create current-runtime.md**

```markdown
<!-- .claude/skills/deploy/references/current-runtime.md -->
# Current Runtime Topology

## Canonical Paths

- Repo root: `/Users/mac/Desktop/code/ai-demos/enterprise-rag`
- Nginx config: `/Users/mac/.doc-cloud/config/rag-luyaxiang-enterprise-rag.nginx.conf`

## Domain Chain

1. `cloudflared` routes `rag.luyaxiang.com` → `127.0.0.1:5174`
2. `nginx` on `127.0.0.1:5174`
3. Next.js web on `127.0.0.1:3001`
4. Python agent on `127.0.0.1:8001` (default, see `.runtime/local-agent-port`)

## Notes

- Web port: **3001** (3000 is reserved for smart-agriculture)
- Agent port: dynamic, written to `.runtime/local-agent-port` by start-local-agent.sh
- Never Docker for this project — process mode only
- Nginx config template: see `infra/nginx/rag-luyaxiang.nginx.conf`
```

- [ ] **Step 14.5: Create nginx config template**

```nginx
# infra/nginx/rag-luyaxiang.nginx.conf
# Deploy: copy to /Users/mac/.doc-cloud/config/ then reload nginx
worker_processes 1;
error_log /Users/mac/.doc-cloud/logs/rag-luyaxiang-enterprise-rag.nginx.error.log info;
pid /Users/mac/.doc-cloud/logs/rag-luyaxiang-enterprise-rag.nginx.pid;

events { worker_connections 1024; }

http {
  include /opt/homebrew/etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log /Users/mac/.doc-cloud/logs/rag-luyaxiang-enterprise-rag.nginx.access.log;
  sendfile on;
  keepalive_timeout 65;

  server {
    listen 127.0.0.1:5174;
    server_name rag.luyaxiang.com;

    location / {
      proxy_pass http://127.0.0.1:3001;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 120s;
      client_max_body_size 50m;
    }
  }
}
```

- [ ] **Step 14.6: Commit**

```bash
chmod +x scripts/dev/start-local-agent.sh scripts/dev/start-local-web.sh
mkdir -p .claude/skills/deploy/references infra/nginx
git add scripts/dev/ .claude/skills/deploy/ infra/nginx/
git commit -m "feat: deploy skill, start scripts, nginx config for rag.luyaxiang.com"
```

> **Setup note** (one-time, done manually):
> 1. Copy nginx config: `cp infra/nginx/rag-luyaxiang.nginx.conf /Users/mac/.doc-cloud/config/`
> 2. Add cloudflared rule routing `rag.luyaxiang.com` → `http://127.0.0.1:5174`
> 3. Reload nginx: `nginx -s reload` (or restart nginx process)

---

## Summary

| Step | What it builds |
|---|---|
| Tasks 1-5 | Next.js scaffold, auth utils, login/logout APIs, middleware, agent proxy |
| Tasks 6-7 | Login page, nav layout |
| Tasks 8-9 | File viewers, ViewerPanel, ChatPanel, SourceCard |
| Tasks 10-11 | Feature Demo page, personal knowledge base page |
| Task 12 | End-to-end verification |
| Task 13 | Web `/api/health` endpoint |
| Task 14 | Start scripts + deploy skill for `rag.luyaxiang.com` |

**Start order:** `scripts/init_db.py` → `bash scripts/dev/start-local-agent.sh` → `bash scripts/dev/start-local-web.sh`
