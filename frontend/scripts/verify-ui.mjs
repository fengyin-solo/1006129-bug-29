// 真实浏览器核对：两个入口的渲染、越权拦截、留痕、两侧报警数一致、刷新后核对。
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5173'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push(String(err)))

let passed = 0, failed = 0
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log('  ✅', name) } else { failed++; console.log('  ❌', name, detail) }
}

async function selectUnit(unitName) {
  await page.locator('.unit-switch select').selectOption({ label: unitName })
}
async function activeCountText() {
  return page.locator('.page-foot').first().innerText()
}

console.log('1) 地表沉降页渲染')
await page.goto(`${BASE}/settlement`, { waitUntil: 'networkidle' })
await page.waitForSelector('table.data-table tbody tr')
const mainTable = page.locator('section.page > table.data-table')
const settleRows = await mainTable.locator('tbody tr').count()
check('测点行渲染（8 个种子测点）', settleRows === 8, `实际 ${settleRows}`)
check('归属单位列有内容', (await page.locator('tbody tr td:nth-child(3)').first().innerText()).includes('中铁'))
check('页面写明当前账号单位', (await page.locator('.status-legend').first().innerText()).includes('中铁沉降监测队'))
const foot1 = await activeCountText()
check('沉降页显示在效报警 2 个', foot1.includes('在效报警测点 2 个'), foot1)

console.log('2) 报警清单落地且历史留档')
const ledgerRows = await page.locator('.ledger table tbody tr').count()
check('报警清单共 4 条（2 在效 + 2 历史留档）', ledgerRows === 4, `实际 ${ledgerRows}`)
const activeBadges = await page.locator('.ledger .badge-danger').count()
check('清单内在效徽标 2 个', activeBadges === 2, `实际 ${activeBadges}`)

console.log('3) 越权：切到监理账号，他单位测点只能查看')
await selectUnit('监理复核组（赵监理）')
await page.waitForTimeout(200)
const lockCount = await mainTable.locator('text=仅可查看').count()
check('非解除测点都显示仅可查看（监理不归属任何测点）', lockCount === 7, `实际 ${lockCount}`)
check('监理看不到任何写操作按钮', (await mainTable.locator('tbody button.link').count()) === 0)
// 已解除测点在任何单位下只读
const readonlyCount = await page.locator('text=已解除 · 只读').count()
check('已解除测点显示只读', readonlyCount >= 1)

console.log('4) 切到华岩，改自己测点阈值：留痕 + 重算')
await selectUnit('华岩第三方监测所（李监测）')
await page.waitForTimeout(200)
// SETT-0106 当前 35；改为 30（收紧）→ 测点重新超限变预警，不会自动报警
const row0106 = mainTable.locator('tbody tr', { hasText: 'SETT-0106' })
await row0106.locator('button.link', { hasText: '调整阈值' }).click()
await page.locator('.modal input[type=number]').fill('30')
await page.locator('.modal textarea').fill('页面核对：收紧口径重新判定')
await page.locator('.modal button.primary').click()
await page.waitForTimeout(300)
check('成功提示出现', (await page.locator('.notice-ok').innerText()).includes('重算'))
// 审计留痕新增一条
const auditText = await page.locator('.audit').innerText()
check('阈值调整留痕可见', auditText.includes('页面核对：收紧口径重新判定'))
const footAfterTighten = await activeCountText()
check('收紧后在效报警仍为 2（不自动补发）', footAfterTighten.includes('在效报警测点 2 个'), footAfterTighten)

console.log('5) 越权改阈值被当场拒绝：华岩动中铁测点 SETT-0101')
// 中铁测点行上应显示锁，无按钮
const row0101 = mainTable.locator('tbody tr', { hasText: 'SETT-0101' })
check('华岩看中铁测点显示仅可查看', (await row0101.innerText()).includes('仅可查看'))

console.log('6) 重复发布报警只一条：华岩对 SETT-0103（已有在效报警）再发布')
// SETT-0103 已报警（有在效报警），发布按钮在报警状态下 disabled
const row0103 = mainTable.locator('tbody tr', { hasText: 'SETT-0103' })
const publishBtn = row0103.locator('button.link', { hasText: '发布报警' })
check('已在效报警的测点不能重复发布（按钮禁用）', (await publishBtn.count()) === 0 || (await publishBtn.isDisabled()))

console.log('7) 建筑监测页：同一数据源，报警测点数对得上')
await page.goto(`${BASE}/building`, { waitUntil: 'networkidle' })
await page.waitForSelector('table.data-table tbody tr')
const bMainTable = page.locator('section.page > table.data-table')
const bRows = await bMainTable.locator('tbody tr').count()
check('6 个监测对象渲染', bRows === 6, `实际 ${bRows}`)
const bFoot = await page.locator('.page-foot').first().innerText()
check('建筑页在效报警同样是 2 个', bFoot.includes('在效报警测点 2 个'), bFoot)
const bLedger = await page.locator('.ledger table tbody tr').count()
check('建筑页报警清单也是 4 条（同一份）', bLedger === 4, `实际 ${bLedger}`)
// 超限幅度来自测点侧
const b03 = bMainTable.locator('tbody tr', { hasText: 'BUIL-03' })
check('建筑页超限幅度有值且以测点侧为准', /\d+\.\d/.test(await b03.locator('td:nth-child(9)').innerText()))

console.log('8) 从建筑入口越权同样被拦：切监理，所有动作消失')
await selectUnit('监理复核组（赵监理）')
await page.waitForTimeout(200)
check('监理在建筑页看不到任何写按钮', (await mainTable.locator('tbody button.link').count()) === 0)
check('他单位对象显示仅可查看', (await bMainTable.locator('text=仅可查看').count()) >= 5)

console.log('9) 重新进页面核对：刷新后数据与计数仍一致，不回退老数据')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.ledger table tbody tr')
const footAfterReload = await page.locator('.page-foot').first().innerText()
check('刷新后在效报警仍 2 个', footAfterReload.includes('在效报警测点 2 个'), footAfterReload)
const auditAfterReload = await page.locator('.audit').count()
// 建筑页没有审计表，回沉降页确认阈值留痕持久化
await page.goto(`${BASE}/settlement`, { waitUntil: 'networkidle' })
await page.waitForSelector('.audit')
check('刷新后阈值留痕仍在', (await page.locator('.audit').innerText()).includes('页面核对：收紧口径重新判定'))
check('阈值已持久化为 30', (await page.locator('section.page > table.data-table tbody tr', { hasText: 'SETT-0106' }).innerText()).includes('30'))

console.log('10) 运营概览跟着重算')
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
const overview = await page.locator('table.data-table').innerText()
check('概览表含地表沉降/建筑监测行', overview.includes('地表沉降') && overview.includes('建筑监测'))

check('全程无浏览器控制台错误', errors.length === 0, errors.join(' | '))

await page.screenshot({ path: '/tmp/settlement.png', fullPage: false })
await browser.close()
console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
