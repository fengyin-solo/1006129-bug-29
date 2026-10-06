import assert from 'node:assert/strict'

// 先装好 localStorage 替身，再碰数据层：数据层只认 window.localStorage。
const mem = new Map<string, string>()
let setItemHook: ((key: string, value: string) => void) | null = null
let getItemHook: ((key: string) => string | null) | null = null
const localStorageShim = {
  getItem(key: string): string | null {
    if (getItemHook) return getItemHook(key)
    return mem.has(key) ? (mem.get(key) as string) : null
  },
  setItem(key: string, value: string): void {
    if (setItemHook) setItemHook(key, value)
    mem.set(key, String(value))
  },
  removeItem(key: string): void {
    mem.delete(key)
  },
  clear(): void {
    mem.clear()
  },
}
;(globalThis as Record<string, unknown>).window = { localStorage: localStorageShim }

const { invalidateCache, storageKey } = await import('@/data/local-store')
const {
  adjustThreshold,
  confirmStable,
  countActiveAlarms,
  listActiveAlarms,
  listMonitoringRecords,
  listSettlementAlarms,
  listSettlementPoints,
  listThresholdLog,
  publishAlarm,
  submitMonitoring,
  transferPoint,
} = await import('@/api/settlement-service')
const { exportEntries, runAction, setActor } = await import('@/api/local-service')

const A1 = { operator: '张三', unit: '监测一单位' }
const A2 = { operator: '李四', unit: '监测二单位' }
const A3 = { operator: '王五', unit: '监测三单位' }

function reset() {
  setItemHook = null
  getItemHook = null
  localStorageShim.clear()
  invalidateCache()
}

function pointOf(id: number) {
  const point = listSettlementPoints().find((row) => Number(row.id) === id)
  assert.ok(point, `测点 ${id} 应存在`)
  return point
}

let passed = 0
function test(name: string, fn: () => void) {
  reset()
  fn()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

// 1. 老数据迁移：补归属单位、监测日期照旧、按日期补录监测记录，且幂等
test('老数据测点记录兼容：补归属、照旧补录、幂等', () => {
  localStorageShim.setItem(
    storageKey(),
    JSON.stringify({
      settlement: [
        {
          id: 1,
          status: '预警',
          pending: true,
          abnormal: false,
          测点编号: 'SETT-OLD1',
          测点位置: '老位置',
          初始高程: '老数据',
          累计沉降: '老数据',
          沉降速率: '老数据',
          预警阈值: '老数据',
          监测日期: '2026-08-15',
          测点状态: '老样例',
        },
      ],
      settlement_alarm: [],
      settlement_threshold_log: [],
      settlement_monitoring: [],
    }),
  )
  invalidateCache()
  const point = pointOf(1)
  assert.equal(point['归属单位'], '监测一单位', '老数据要补写归属单位')
  assert.equal(point['监测日期'], '2026-08-15', '存量测点按监测日期照旧')
  assert.equal(point['测点状态'], '预警', '测点状态与当前状态对齐')
  const records = listMonitoringRecords()
  assert.ok(
    records.some((row) => Number(row['测点id']) === 1 && row['监测日期'] === '2026-08-15'),
    '存量测点按监测日期补录监测记录',
  )
  const count = records.length
  listMonitoringRecords()
  assert.equal(listMonitoringRecords().length, count, '补录幂等，不重复登记')
  // 老数据阈值不是数字：发布预警不崩，超限幅度记空；改阈值后按新口径重算
  const published = publishAlarm(1, A1)
  assert.equal(published.ok, true)
  const alarm = listSettlementAlarms().find((row) => Number(row['测点id']) === 1)
  assert.ok(alarm)
  assert.equal(alarm['超限幅度'], '')
  const fixed = adjustThreshold(1, 10, A1)
  assert.equal(fixed.ok, true)
  const rejudged = listSettlementAlarms().find((row) => Number(row['测点id']) === 1)
  assert.ok(rejudged)
  assert.equal(rejudged['判定阈值'], 10)
})

// 2. 越权改阈值当场拒绝：领域入口与通用入口都拦
test('越权改阈值当场拒绝，两个入口都拦', () => {
  const denied = adjustThreshold(1, 20, A2)
  assert.equal(denied.ok, false)
  assert.match(denied.message, /越权/)
  assert.equal(Number(pointOf(1)['预警阈值']), 10, '阈值不被越权改动')
  assert.equal(listThresholdLog().length, 0, '越权不留痕')

  setActor(A2)
  const viaGeneric = runAction('settlement', 1, '调整阈值')
  assert.equal(viaGeneric.ok, false)
  assert.match(viaGeneric.message, /越权/)
  setActor(A1)
})

// 3. 跨单位提交监测当场拦下
test('跨单位提交监测当场拦下', () => {
  const denied = submitMonitoring(3, { 累计沉降: 20, 监测日期: '2026-10-06' }, A1)
  assert.equal(denied.ok, false)
  assert.match(denied.message, /越权/)
  assert.ok(
    !listMonitoringRecords().some((row) => Number(row['测点id']) === 3 && row['监测日期'] === '2026-10-06'),
    '跨单位提交不写监测记录',
  )
})

// 4. 调整阈值留痕，已发布报警按新阈值重算，发布时阈值留档
test('调整阈值留痕并重算已发布报警', () => {
  assert.equal(countActiveAlarms(), 1, '种子数据里 SETT-0003 有一条有效报警')
  const raised = adjustThreshold(3, 20, A2)
  assert.equal(raised.ok, true)
  const logs = listThresholdLog()
  assert.equal(logs.length, 1, '调整阈值要留痕')
  assert.equal(Number(logs[0]['旧阈值']), 12)
  assert.equal(Number(logs[0]['新阈值']), 20)
  assert.equal(logs[0]['操作单位'], '监测二单位')
  const alarm = listSettlementAlarms().find((row) => Number(row['测点id']) === 3)
  assert.ok(alarm)
  assert.equal(alarm['结论'], '不成立', '照新阈值重算后再判定')
  assert.equal(alarm['状态'], '已解除')
  assert.equal(Number(alarm['发布时阈值']), 12, '历史报警按当时的阈值留档')
  assert.equal(Number(alarm['判定阈值']), 20)
  assert.equal(pointOf(3).status, '正常', '报警解除后测点状态跟着重算')
  assert.equal(countActiveAlarms(), 0)
  const lowered = adjustThreshold(3, 15, A2)
  assert.equal(lowered.ok, true)
  assert.equal(pointOf(3).status, '预警')
  assert.equal(listThresholdLog().length, 2)
})

// 5. 同一测点重复发布报警只留一条，按最早那条
test('重复发布报警只留一条，按最早那条', () => {
  const first = publishAlarm(2, A1)
  assert.equal(first.ok, true)
  assert.equal(pointOf(2).status, '报警')
  const alarm = listSettlementAlarms().find((row) => Number(row['测点id']) === 2)
  assert.ok(alarm)
  assert.equal(Number(alarm['超限幅度']), 2.6, '超限幅度以测点实测为准')
  const again = publishAlarm(2, A1)
  assert.equal(again.ok, true)
  assert.match(again.message, /最早/)
  const alarms = listSettlementAlarms().filter((row) => Number(row['测点id']) === 2)
  assert.equal(alarms.length, 1, '报警记录不多出一条')
  assert.equal(alarms[0]['首次发布时间'], alarm['首次发布时间'], '首次发布时间不动')
})

// 6. 已解除的测点整段只读
test('已解除的测点整段只读，任何单位都不能改动', () => {
  for (const actor of [A1, A2, A3]) {
    assert.equal(adjustThreshold(4, 5, actor).ok, false)
    assert.equal(submitMonitoring(4, { 累计沉降: 7, 监测日期: '2026-10-06' }, actor).ok, false)
    assert.equal(publishAlarm(4, actor).ok, false)
    assert.equal(transferPoint(4, '监测一单位', actor).ok, false)
    assert.equal(confirmStable(4, actor).ok, false)
  }
  const denied = adjustThreshold(4, 5, A2)
  assert.match(denied.message, /只读/)
  assert.equal(Number(pointOf(4)['预警阈值']), 10)
})

// 7. 划转移交：归属跟着测点走，原单位立即越权
test('划转移交后归属更新，原单位越权、新单位可改', () => {
  const moved = transferPoint(1, '监测二单位', A1)
  assert.equal(moved.ok, true)
  assert.equal(pointOf(1)['归属单位'], '监测二单位')
  assert.equal(adjustThreshold(1, 9, A1).ok, false, '划走后原单位越权')
  assert.equal(adjustThreshold(1, 9, A2).ok, true, '新单位可改阈值')
  assert.equal(transferPoint(2, '监测三单位', A2).ok, false, '非归属单位不能划转')
  assert.equal(transferPoint(1, '不存在的单位', A2).ok, false, '接收单位要在名录里')
  assert.equal(transferPoint(1, '监测二单位', A2).ok, false, '重复划转不动')
})

// 8. 重复提交监测按最早那次
test('同测点同日期重复提交只留最早那条', () => {
  const first = submitMonitoring(1, { 累计沉降: 4, 沉降速率: 0.5, 监测日期: '2026-10-06' }, A1)
  assert.equal(first.ok, true)
  assert.equal(Number(pointOf(1)['累计沉降']), 4)
  const again = submitMonitoring(1, { 累计沉降: 9.9, 沉降速率: 9.9, 监测日期: '2026-10-06' }, A1)
  assert.equal(again.ok, true)
  assert.match(again.message, /最早/)
  assert.equal(Number(pointOf(1)['累计沉降']), 4, '再递一遍仍按最早那次')
  const records = listMonitoringRecords().filter(
    (row) => Number(row['测点id']) === 1 && row['监测日期'] === '2026-10-06',
  )
  assert.equal(records.length, 1, '重复提交只留一条')
})

// 9. 事务：写失败整条抽回；中途断掉重试；核对不一致不拿老数据兜底
test('写失败整条抽回，中途断掉重试，核对不一致也抽回', () => {
  listSettlementPoints() // 先让迁移落笔，避免干扰后续写入计数
  setItemHook = () => {
    throw new Error('存储中断')
  }
  const failed = adjustThreshold(1, 8, A1)
  assert.equal(failed.ok, false)
  assert.match(failed.message, /抽回/)
  setItemHook = null
  invalidateCache()
  assert.equal(Number(pointOf(1)['预警阈值']), 10, '写失败就整条抽回')
  assert.equal(listThresholdLog().length, 0, '留痕也一并抽回')

  let calls = 0
  setItemHook = () => {
    calls += 1
    if (calls === 1) throw new Error('中途断掉')
  }
  const retried = adjustThreshold(1, 8, A1)
  assert.equal(retried.ok, true, '中途断掉就重试')
  setItemHook = null
  invalidateCache()
  assert.equal(Number(pointOf(1)['预警阈值']), 8)
  assert.equal(listThresholdLog().length, 1)

  const stale = mem.get(storageKey()) as string
  getItemHook = () => stale
  const staleFailed = adjustThreshold(1, 6, A1)
  assert.equal(staleFailed.ok, false, '写后核对不一致要抽回')
  getItemHook = null
  invalidateCache()
  assert.equal(Number(pointOf(1)['预警阈值']), 8, '不拿老数据兜底')
})

// 10. 两处读到的报警测点数对得上
test('报警测点数两处一致，同源一份', () => {
  assert.equal(countActiveAlarms(), listActiveAlarms().length)
  assert.equal(countActiveAlarms(), 1)
  publishAlarm(2, A1)
  assert.equal(countActiveAlarms(), listActiveAlarms().length)
  assert.equal(countActiveAlarms(), 2)
})

// 11. 通用入口：沉降走同一守卫；建筑监测已解除整段只读
test('通用动作入口同样校验越权与只读', () => {
  setActor(A2)
  const denied = runAction('settlement', 1, '确认稳定')
  assert.equal(denied.ok, false)
  assert.match(denied.message, /越权/)
  setActor(A1)
  const stabilized = runAction('settlement', 1, '确认稳定')
  assert.equal(stabilized.ok, true)
  assert.equal(pointOf(1).status, '已稳定')
  const readonly = runAction('settlement', 1, '发布预警')
  assert.equal(readonly.ok, false)
  assert.match(readonly.message, /只读/)

  const released = runAction('building', 3, '解除报警')
  assert.equal(released.ok, true)
  const blocked = runAction('building', 3, '发布报警')
  assert.equal(blocked.ok, false)
  assert.match(blocked.message, /只读/)
  const normal = runAction('building', 1, '布设测点')
  assert.equal(normal.ok, true, '未解除的监测对象照常流转')
})

// 12. 确认稳定后在途报警解除留档，测点转只读
test('确认稳定解除在途报警并整段只读', () => {
  publishAlarm(2, A1)
  assert.equal(countActiveAlarms(), 2)
  const stabilized = confirmStable(2, A1)
  assert.equal(stabilized.ok, true)
  assert.equal(pointOf(2).status, '已稳定')
  assert.equal(countActiveAlarms(), 1, '有效报警随之解除')
  const alarm = listSettlementAlarms().find((row) => Number(row['测点id']) === 2)
  assert.ok(alarm)
  assert.equal(alarm['状态'], '已解除')
  assert.equal(alarm['结论'], '成立', '历史结论留档')
  assert.equal(adjustThreshold(2, 30, A1).ok, false, '已稳定后阈值也改不动')
})

// 13. 导出清单带归属单位
test('导出地表沉降清单包含归属单位', () => {
  const csv = exportEntries('settlement')
  assert.ok(csv.content.includes('归属单位'))
  assert.ok(csv.content.includes('监测一单位'))
})

console.log(`\n${passed} 个用例全部通过`)
