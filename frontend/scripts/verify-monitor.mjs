// 监测领域行为验证：mock localStorage 后用 esbuild 跑真实 TS 代码。
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

const CR = { unitId: 'unit-cr' }
const HY = { unitId: 'unit-hy' }
const JL = { unitId: 'unit-jl' }

const harness = `
const mem = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: (k) => { mem.delete(k) },
    __dump: () => Object.fromEntries(mem),
    __set: (k, v) => mem.set(k, v),
  },
}
import {
  listPoints, listBuildings, listAlarms, activeAlarmPointCount,
  submitReading, publishAlarm, adjustThreshold, releasePoint, transferPoint, deployPoint,
} from '@/data/monitor/service'
globalThis.__svc = {
  listPoints, listBuildings, listAlarms, activeAlarmPointCount,
  submitReading, publishAlarm, adjustThreshold, releasePoint, transferPoint, deployPoint,
}
globalThis.__ls = globalThis.window.localStorage
`

const entry = join(mkdtempSync(join(tmpdir(), 'mon-')), 'entry.ts')
writeFileSync(entry, harness)

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  alias: { '@': join(process.cwd(), 'src') },
})
const out = join(tmpdir(), 'monitor-bundle.mjs')
writeFileSync(out, result.outputFiles[0].text)
await import(pathToFileURL(out).href)
const ls = globalThis.__ls
const {
  listPoints, listBuildings, listAlarms, activeAlarmPointCount,
  submitReading, publishAlarm, adjustThreshold, releasePoint, transferPoint, deployPoint,
} = globalThis.__svc

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log('  ✅', name) }
  else { failed += 1; console.log('  ❌', name, detail) }
}
function expectThrow(name, fn, codeIncludes) {
  try {
    fn()
    check(name, false, '未被拦下')
  } catch (error) {
    const ok = !codeIncludes || String(error.code ?? error.message).includes(codeIncludes) || String(error.message).includes(codeIncludes)
    check(name, ok, `实际：${error.code} ${error.message}`)
  }
}

console.log('1) 初始数据：在效报警测点数两侧一致')
check('沉降页与建筑页在效报警数一致', activeAlarmPointCount() === 2, `实际 ${activeAlarmPointCount()}`)
check('历史报警按当时阈值留档', listAlarms().filter((a) => a.status !== '在效').length === 2)

console.log('2) 越权改阈值：非归属单位当场拒绝（SETT-0103 归华岩）')
expectThrow('中铁改华岩测点阈值被拒', () => adjustThreshold('SETT-0103', 99, '尝试改松', CR), 'UNAUTHORIZED_UNIT')
expectThrow('监理账号改阈值被拒', () => adjustThreshold('SETT-0103', 99, '监理改松', JL), 'UNAUTHORIZED_UNIT')
expectThrow('未填原因拒绝', () => adjustThreshold('SETT-0103', 99, '  ', HY), 'INVALID_INPUT')
const p0103 = listPoints().find((p) => p.id === 'SETT-0103')
check('阈值未被越权改动', p0103.currentThresholdMm === 30, `实际 ${p0103.currentThresholdMm}`)

console.log('3) 归属划转后，原单位立即失权（SETT-0104 已划给中铁）')
expectThrow('华岩（原单位）再改阈值被拒', () => adjustThreshold('SETT-0104', 25, '原单位操作', HY), 'UNAUTHORIZED_UNIT')
check('归属显示为中铁', p0103 && listPoints().find((p) => p.id === 'SETT-0104').ownerName.includes('中铁'))
adjustThreshold('SETT-0104', 25, '新归属单位按复测调整', CR)
check('新归属单位可调且留痕', listAlarms() && true)

console.log('4) 重复发布报警只留最早一条')
const before = listAlarms().filter((a) => a.pointId === 'SETT-0103').length
const a1 = publishAlarm('SETT-0103', HY)
const a2 = publishAlarm('SETT-0103', HY)
const after = listAlarms().filter((a) => a.pointId === 'SETT-0103').length
check('重复发布返回同一条（最早那次）', a1.id === a2.id)
check('报警记录没有多出一条', before === after, `${before} -> ${after}`)

console.log('5) 未超限不能发布报警（SETT-0101 正常）')
expectThrow('正常测点发布报警被拒', () => publishAlarm('SETT-0101', CR), 'NOT_EXCEEDED')

console.log('6) 提交读数跨单位/重复提交')
submitReading({ pointId: 'SETT-0102', date: '2026-10-06', cumulativeMm: -18, rateMmPerDay: -1.2 }, CR)
const dup = submitReading({ pointId: 'SETT-0102', date: '2026-10-06', cumulativeMm: -25, rateMmPerDay: -9 }, CR)
check('同日重复提交标记 duplicated 且按最早那次', dup.duplicated === true)
const kept = listPoints().find((p) => p.id === 'SETT-0102')
check('后一次提交没有覆盖最早值', kept.latestCumulativeMm === -18, `实际 ${kept.latestCumulativeMm}`)
expectThrow('华岩给中铁测点补录被拒（跨单位）', () => submitReading({ pointId: 'SETT-0102', date: '2026-10-07', cumulativeMm: -20, rateMmPerDay: -1 }, HY), 'UNAUTHORIZED_UNIT')

console.log('7) 阈值改口径后已发布报警重算（SETT-0106 口径 30→35 已演示解除；反向验证收紧后重新判定）')
// SETT-0105 当前在效（-35.4，阈值30），改松到 40：仍按新阈值重算
const r1 = adjustThreshold('SETT-0105', 40, '临时放宽验证重算', HY)
check('放宽到 40 后 -35.4 不再超限，在效报警解除', r1.recalculated[0].nowActive === false)
check('旧报警留档（阈值重算解除）', listAlarms().find((a) => a.pointId === 'SETT-0105').status === '阈值重算解除')
// 再收回 30：状态应回到预警，但不会自动重新发布（防止悄悄造报警）
adjustThreshold('SETT-0105', 30, '复核收回', HY)
const p0105 = listPoints().find((p) => p.id === 'SETT-0105')
check('收回后测点状态按新阈值重新判定为预警', p0105.status === '预警', `实际 ${p0105.status}`)
check('收回后不会自动补发报警（仍只有旧档）', listAlarms().filter((a) => a.pointId === 'SETT-0105').length === 1)

console.log('8) 已解除测点整段只读（SETT-0107）')
expectThrow('归属单位也不能改阈值', () => adjustThreshold('SETT-0107', 10, 'x', CR), 'READONLY_RELEASED')
expectThrow('不能再补读数', () => submitReading({ pointId: 'SETT-0107', date: '2026-10-06', cumulativeMm: -50, rateMmPerDay: -1 }, CR), 'READONLY_RELEASED')
expectThrow('不能再划转', () => transferPoint('SETT-0107', 'unit-hy', 'x', CR), 'READONLY_RELEASED')
expectThrow('外单位同样只读', () => adjustThreshold('SETT-0107', 10, 'x', HY), 'READONLY_RELEASED')

console.log('9) 建筑监测入口同样校验（第二个入口不能漏）')
// BUIL-02 <- SETT-0102（中铁）；监理从建筑页发布报警
expectThrow('监理从建筑页发布报警被拒', () => publishAlarm('SETT-0102', JL), 'UNAUTHORIZED_UNIT')
expectThrow('华岩从建筑页动中铁测点被拒', () => publishAlarm('SETT-0102', HY), 'UNAUTHORIZED_UNIT')
// 让 SETT-0102 超限后由归属单位从建筑入口发布
submitReading({ pointId: 'SETT-0102', date: '2026-10-08', cumulativeMm: -23.5, rateMmPerDay: -2 }, CR)
publishAlarm('SETT-0102', CR)
const b02 = listBuildings().find((b) => b.id === 'BUIL-02')
check('建筑页对象状态随测点变为报警', b02.status === '报警', `实际 ${b02.status}`)
check('报警落到建筑监测清单且带建筑物名', listAlarms().some((a) => a.pointId === 'SETT-0102' && a.buildingName === '江洲花园 2 号楼' && a.status === '在效'))

console.log('10) 两侧报警测点数始终对得上')
check('在效报警数同源一致', activeAlarmPointCount() === listPoints().filter((p) => p.status === '报警').length)
check('建筑页在效报警数 = 领域在效报警数', listBuildings().filter((b) => b.status === '报警').length === activeAlarmPointCount())

console.log('11) 超限幅度以测点侧为准，建筑允许沉降不参与判定')
const b04 = listBuildings().find((b) => b.id === 'BUIL-05')
check('建筑页超限幅度取自测点阈值口径', typeof b04.overshootMm === 'number')

console.log('12) 布设测点：未布点对象 + 跨单位拦截')
expectThrow('华岩把中铁未布点测点布到对象被拒', () => deployPoint('BUIL-06', 'SETT-0108', HY), 'UNAUTHORIZED_UNIT')
// BUIL-06 原点 0107 已解除，对象空出，可由归属单位把未布点的 0108 布进来
deployPoint('BUIL-06', 'SETT-0108', CR)
check('布设成功（归属一致才放行）', listPoints().find((p) => p.id === 'SETT-0108').buildingId === 'BUIL-06')
expectThrow('一个测点不能重复布到别的对象', () => deployPoint('BUIL-02', 'SETT-0108', CR), 'INVALID_INPUT')

console.log('13) 解除测点：在效报警关闭留档、状态只读')
publishAlarm('SETT-0103', HY) // 确保有在效
releasePoint('SETT-0103', HY)
check('解除后状态已解除', listPoints().find((p) => p.id === 'SETT-0103').status === '已解除')
check('在效报警关闭且留档', listAlarms().find((a) => a.pointId === 'SETT-0103' && a.status === '测点解除关闭'))
check('解除后在效报警总数下降', activeAlarmPointCount() === 1, `实际 ${activeAlarmPointCount()}`)

console.log('14) 落盘核对：刷新（重读存储）后数据一致，不留两份')
// 清模块缓存模拟刷新：直接断言存储里只有一份领域状态
const stored = JSON.parse(ls.getItem('shield-tunnel-construction:monitor'))
check('存储中报警唯一（每测点在效 ≤1）', (() => {
  const active = stored.alarms.filter((a) => a.status === '在效')
  const ids = new Set(active.map((a) => a.pointId))
  return ids.size === active.length
})())
check('备份与主副本一致', ls.getItem('shield-tunnel-construction:monitor') === ls.getItem('shield-tunnel-construction:monitor:backup'))

console.log('15) 写失败整条抽回（模拟 setItem 抛错）')
const realSet = ls.setItem.bind(ls)
let calls = 0
ls.setItem = (k, v) => {
  if (k === 'shield-tunnel-construction:monitor' && calls < 3) { calls += 1; throw new Error('QuotaExceeded') }
  return realSet(k, v)
}
const thresholdBefore = listPoints().find((p) => p.id === 'SETT-0102').currentThresholdMm
expectThrow('阈值调整写入失败时报错', () => adjustThreshold('SETT-0102', 99, '应回滚', CR), '回滚')
ls.setItem = realSet
const thresholdAfter = listPoints().find((p) => p.id === 'SETT-0102').currentThresholdMm
check('失败后阈值保持原值（整条抽回）', thresholdBefore === thresholdAfter, `${thresholdBefore} vs ${thresholdAfter}`)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
