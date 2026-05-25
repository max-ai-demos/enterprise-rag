import { NextRequest, NextResponse } from 'next/server'
import { signToken, cookieOptions, COOKIE_NAME } from '@/lib/auth'

const AGENT = process.env.AGENT_URL ?? 'http://localhost:8001'

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''
  let username: string, password: string, isFormPost: boolean

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    username = form.get('username') as string
    password = form.get('password') as string
    isFormPost = true
  } else {
    const body = await req.json()
    username = body.username
    password = body.password
    isFormPost = false
  }

  if (!username || !password) {
    if (isFormPost) return NextResponse.redirect(new URL('/login?error=missing', req.url))
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
  }

  const agentRes = await fetch(`${AGENT}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!agentRes.ok) {
    if (isFormPost) return NextResponse.redirect(new URL('/login?error=invalid', req.url))
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  const token = await signToken({ user_id: 'demo', org_id: 'default', username, role: 'user' })

  if (isFormPost) {
    const host = req.headers.get('host') ?? 'luyaxiang.com'
    const proto = host.startsWith('localhost') || host.startsWith('127.') || host.startsWith('0.0.0.0') ? 'http' : 'https'
    const res = NextResponse.redirect(`${proto}://${host}/demo`)
    res.cookies.set(COOKIE_NAME, token, cookieOptions())
    res.headers.append('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=604800; Domain=.luyaxiang.com; Secure; HttpOnly; SameSite=Lax`)
    return res
  }

  const res = NextResponse.json({ username, role: 'user' })
  res.cookies.set(COOKIE_NAME, token, cookieOptions())
  res.headers.append('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=604800; Domain=.luyaxiang.com; Secure; HttpOnly; SameSite=Lax`)
  return res
}
