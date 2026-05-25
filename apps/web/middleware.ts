import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, signToken, cookieOptions, shouldRefreshToken, COOKIE_NAME } from '@/lib/auth'

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

  const res = NextResponse.next()

  // Auto-refresh token if nearing expiry — same threshold as portal (< 24h remaining)
  if (shouldRefreshToken(payload)) {
    const newToken = await signToken({
      user_id:  payload.user_id,
      org_id:   payload.org_id,
      username: payload.username,
      role:     payload.role,
    })
    const opts = cookieOptions()
    res.cookies.set(COOKIE_NAME, newToken, opts)
    res.headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=${newToken}; Path=/; Max-Age=604800; Domain=.luyaxiang.com; Secure; HttpOnly; SameSite=Lax`
    )
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
