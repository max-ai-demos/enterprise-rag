import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getUserByUsername } from '@/lib/db'
import { signToken, cookieOptions, COOKIE_NAME } from '@/lib/auth'

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
  const user = await getUserByUsername(username)
  if (!user) {
    if (isFormPost) return NextResponse.redirect(new URL('/login?error=invalid', req.url))
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    if (isFormPost) return NextResponse.redirect(new URL('/login?error=invalid', req.url))
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  const token = await signToken({ user_id: user.id, org_id: user.org_id ?? 'default', username: user.username, role: user.role })

  if (isFormPost) {
    const host = req.headers.get('host') ?? 'luyaxiang.com'
    const proto = host.startsWith('localhost') || host.startsWith('127.') || host.startsWith('0.0.0.0') ? 'http' : 'https'
    const res = NextResponse.redirect(`${proto}://${host}/demo`)
    res.cookies.set(COOKIE_NAME, token, cookieOptions())
    res.headers.append('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=604800; Domain=.luyaxiang.com; Secure; HttpOnly; SameSite=Lax`)
    return res
  }

  const res = NextResponse.json({ username: user.username, role: user.role })
  res.cookies.set(COOKIE_NAME, token, cookieOptions())
  res.headers.append('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=604800; Domain=.luyaxiang.com; Secure; HttpOnly; SameSite=Lax`)
  return res
}
