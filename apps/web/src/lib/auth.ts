import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'enterprise-demo-shared-secret-2026'
)
export const COOKIE_NAME = 'ai_demo_token'
const EXPIRES_IN = '7d'
const REFRESH_THRESHOLD_S = 60 * 60 * 24 // refresh if < 1 day remaining

export interface JwtPayload {
  user_id: string
  org_id: string
  username: string
  role: string
  exp?: number
  iat?: number
}

export async function signToken(payload: Omit<JwtPayload, 'exp' | 'iat'>): Promise<string> {
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
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  }
}

export function shouldRefreshToken(payload: JwtPayload): boolean {
  if (!payload.exp) return false
  const remainingS = payload.exp - Math.floor(Date.now() / 1000)
  return remainingS < REFRESH_THRESHOLD_S
}
