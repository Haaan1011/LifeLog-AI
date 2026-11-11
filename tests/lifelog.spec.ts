import { expect, test, type Page } from '@playwright/test';

const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+rWv8AAAAASUVORK5CYII=','base64');
function button(page: Page,label: string) {
  return page.locator('uni-button').filter({hasText:new RegExp('^\\s*' + label + '\\s*$')}).filter({visible:true}).first();
}
async function home(page: Page) {
  await page.goto('/');
  await expect(button(page,'新建记录')).toBeVisible();
}
async function demo(page: Page) {
  await button(page,'演示入口').click();
  await expect(page.locator('#demo-console')).toBeVisible();
  await page.locator('#demo-bind').click();
  await expect(page.getByText('已绑定',{exact:true})).toBeVisible();
}
async function send(page: Page,text: string) {
  await page.locator('#demo-text textarea').fill(text);
  await page.locator('#demo-send').click();
  await expect(page.locator('#demo-result')).toContainText('已保存');
}

test('绑定、文字去重、饮食编辑重算、目标和统计页',async ({page}) => {
  await home(page);
  await expect(page.getByText('今天还没有饮食记录',{exact:true})).toBeVisible();
  await demo(page);
  await send(page,'今天早餐吃了两个鸡蛋、一杯250ml牛奶和两片面包。');
  await page.locator('#demo-resend').click();
  await expect(page.locator('#demo-result')).toContainText('已去重');
  await page.locator('#goal-kcal input').fill('2000');
  await page.locator('#goal-save').click();
  await expect(page.getByText('目标已保存',{exact:true})).toBeVisible();
  await button(page,'记录').click();
  await expect(page.locator('.record-button')).toHaveCount(1);
  await page.locator('.record-button').first().click();
  await expect(page.locator('#food-grams-0 input')).toBeVisible();
  const grams = page.locator('#food-grams-0 input');
  await grams.fill(String(Number(await grams.inputValue()) * 2));
  const saved = page.waitForResponse(response => response.url().includes('/api/records/') && response.request().method() === 'PUT' && response.ok());
  await page.locator('#record-save').click();
  const record = await (await saved).json();
  expect(record.data.items[0].grams).toBe(200);
  await button(page,'统计').click();
  await expect(button(page,'最近 30 天')).toBeVisible();
  await button(page,'最近 30 天').click();
  await expect(page.getByText('营养摄入趋势',{exact:true})).toBeVisible();
  await button(page,'首页').click();
  await expect(page.getByText(/2,000|2000/).first()).toBeVisible();
});

test('上传图片待确认，查看附件，删除后记录为空',async ({page}) => {
  await home(page);
  await demo(page);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#demo-image').click();
  await (await chooser).setFiles({name:'meal.png',mimeType:'image/png',buffer:picture});
  await expect(page.getByText('更换图片',{exact:true})).toBeVisible();
  await page.locator('#demo-send').click();
  await expect(page.locator('#demo-result')).toContainText('已保存');
  await button(page,'记录').click();
  await expect(page.locator('.record-button')).toHaveCount(1);
  await expect(page.getByText('图片待确认',{exact:true})).toBeVisible();
  const mediaResponse = page.waitForResponse(response => response.url().includes('/api/media/') && response.ok());
  await page.locator('.record-button').click();
  const media = await mediaResponse;
  expect(media?.headers()['content-type']).toContain('image/png');
  await page.locator('#record-delete').click();
  await page.locator('uni-modal').getByText('删除',{exact:true}).click();
  await expect(page.getByText('这里还没有记录',{exact:true})).toBeVisible();
});

test('小屏错误态可重试，待办可新增并完成',async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/stats?days=*',route => route.fulfill({status:503,contentType:'application/json',body:'{"error":"测试连接中断"}'}));
  await page.goto('/');
  await expect(page.getByText('测试连接中断',{exact:true})).toBeVisible();
  await page.unroute('**/api/stats?days=*');
  await button(page,'重试').click();
  await expect(button(page,'新建待办')).toBeVisible();
  await button(page,'新建待办').click();
  await page.locator('#record-title input').fill('提交测试报告');
  await page.locator('#record-save').click();
  await expect(page.getByText('提交测试报告',{exact:true})).toBeVisible();
  await page.locator('.check-button').first().click();
  await expect(page.locator('.record-name.done').first()).toHaveText('提交测试报告');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
