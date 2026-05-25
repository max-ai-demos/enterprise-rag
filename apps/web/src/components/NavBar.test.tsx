import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NavBar } from './NavBar'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

describe('NavBar', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ version: '1.0' }) })
    ))
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('renders the demo title', () => {
    render(<NavBar username="demo" />)
    expect(screen.getByText('企业知识库')).toBeInTheDocument()
  })

  it('shows 演示平台 link pointing to portal', () => {
    render(<NavBar username="demo" />)
    const link = screen.getByText('← 演示平台')
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toBe('https://demo.luyaxiang.com')
  })

  it('shows 应用场景, Demo, and 试用 tabs', () => {
    render(<NavBar username="demo" showTrialTab />)
    expect(screen.getByText('应用场景')).toBeInTheDocument()
    expect(screen.getByText('Demo')).toBeInTheDocument()
    expect(screen.getByText('试用')).toBeInTheDocument()
  })

  it('does not show 退出 button', () => {
    render(<NavBar username="demo" />)
    expect(screen.queryByText('退出')).not.toBeInTheDocument()
  })

  it('shows user initial in avatar', () => {
    render(<NavBar username="demo" />)
    expect(screen.getByText('D')).toBeInTheDocument()
  })
})
