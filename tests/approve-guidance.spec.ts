import { test, expect } from '@playwright/test';

test('approving before sharing guides instead of doing nothing', async ({ page }) => {
  await page.goto('/demo?visit=studio');
  const skip = page.getByRole('button', { name: 'Skip tour' });
  if (await skip.count()) await skip.click();

  // clear sharing so approval is not yet allowed
  for (const box of await page.getByLabel('May be shared in this sample arrangement').all()) {
    if (await box.isChecked()) await box.uncheck();
  }

  const approve = page.getByRole('button', { name: 'Approve question' });
  await expect(approve).toBeEnabled();          // no longer a dead disabled control
  await approve.click();
  await expect(page.getByRole('status')).toContainText('Choose which needs may be shared');

  // and it still works once sharing is set
  for (const box of await page.getByLabel('May be shared in this sample arrangement').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole('button', { name: 'Approve question' }).click();
  await expect(page.getByRole('status')).toContainText('No message was sent');
});
