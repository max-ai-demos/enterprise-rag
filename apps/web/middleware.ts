import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/health']

function buildLoginRedirect(loginUrl: string, originalUrl: string): string {
  if (loginUrl.startsWith('http')) {
    return `${loginUrl}?redirect=${encodeURIComponent(originalUrl)}`
  }
  return loginUrl
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const loginUrl = process.env.LOGIN_URL ?? '/login'
  const token = req.cookies.get(COOKIE_NAME)?.value

  if (!token) {
    return NextResponse.redirect(buildLoginRedirect(loginUrl, req.url))
  }
  const payload = await verifyToken(token)
  if (!payload) {
    const res = NextResponse.redirect(buildLoginRedirect(loginUrl, req.url))
    res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
    return res
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
