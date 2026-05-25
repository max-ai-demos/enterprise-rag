import { expect, test } from '@playwright/test'

test('login page loads with the expected form', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByRole('heading', { name: '企业知识库' })).toBeVisible()
  await expect(page.getByPlaceholder('请输入用户名')).toBeVisible()
  await expect(page.getByPlaceholder('请输入密码')).toBeVisible()
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
})
