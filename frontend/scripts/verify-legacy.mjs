// 老数据兼容：泛型表里的存量测点（真实数值）首次进入监测领域时按监测日期补录；占位样例行跳过。
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

const harness = `
const mem = new Map()
// 预置老版本 localStorage：泛型模块表
mem.set('shield-tunnel-construction:entries', JSON.stringify({
  settlement: [
    { id: 1, status: '报警', pending: false, abnormal: false,
      '测点编号': 'SETT-OLD-1', '测点位置': '老城区间 K10+020 地表',
      '初始高程': '25.3m', '累计沉降': '-33.6mm', '沉降速率': '-2.1mm/d',
      '预警阈值': '30 mm', '监测日期': '2026-08-15', '测点状态': '报警' },
    { id: 2, status: '正常', pending: true, abnormal: false,
      '测点编号': 'SETT-OLD-2', '测点位置': '带单位也能解析',
      '初始高程': '26.0', '累计沉降': '-5.2', '沉降速率': '-0.3',
      '预警阈值': '20', '监测日期': '2026-08-20', '测点状态': '正常' },
    // 仓库自带占位行：必须跳过，不能当存量
    { id: 3, status: '正常', pending: true, abnormal: false,
      '测点编号': 'SETT-0001', '测点位置': '地表沉降样例1',
      '初始高程': '地表沉降样例1', '累计沉降': '地表沉降样例1', '沉降速率': '地表沉降样例1',
      '预警阈值': '地表沉降样例1', '监测日期': '2026-09-01', '测点状态': '地表沉降样例1' },
  ],
  building: [
    { id: 1, status: '监测中', pending: true, abnormal: false,
      '对象编号': 'BUIL-OLD-1', '建筑物名称': '老城街 8 号院', '结构类型': '砖混',
      '距隧道距离': '9.5', '允许沉降': '30', '实测沉降': '-33.6',
      '监测频次': '1 次/日', '监测状态': '监测中' },
  ],
}))
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: (k) => { mem.delete(k) },
  },
}
import { listPoints, listBuildings, listAlarms, listReadings, listThresholdEvents, activeAlarmPointCount } from '@/data/monitor/service'
import { loadMonitorState } from '@/data/monitor/store'
globalThis.__svc = { listPoints, listBuildings, listAlarms, listReadings, listThresholdEvents, activeAlarmPointCount, loadMonitorState }
`

const entry = join(mkdtempSync(join(tmpdir(), 'mon-')), 'entry.ts')
writeFileSync(entry, harness)
const result = await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', write: false,
  alias: { '@': join(process.cwd(), 'src') },
})
const out = join(tmpdir(), 'monitor-legacy.mjs')
writeFileSync(out, result.outputFiles[0].text)
await import(pathToFileURL(out).href)
const { listPoints, listBuildings, listAlarms, listReadings, listThresholdEvents, activeAlarmPointCount, loadMonitorState } = globalThis.__svc

let passed = 0, failed = 0
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log('  ✅', name) } else { failed++; console.log('  ❌', name, detail) }
}

console.log('存量测点按监测日期补录 + 老数据兼容')
const points = listPoints()
const old1 = points.find((p) => p.id === 'SETT-OLD-1')
check('真实存量测点 SETT-OLD-1 已补录', !!old1)
check('标记为 legacy', old1?.legacy === true)
check('带单位字符串解析累计沉降 -33.6mm', old1?.latestCumulativeMm === -33.6, `实际 ${old1?.latestCumulativeMm}`)
check('带单位字符串解析阈值 "30 mm"', old1?.currentThresholdMm === 30, `实际 ${old1?.currentThresholdMm}`)
check('初始高程 "25.3m" 解析 25.3', old1?.initialElevationM === 25.3)
check('存量默认归属中铁（归属字段写清）', old1?.ownerName.includes('中铁'))
const old1Readings = listReadings('SETT-OLD-1')
check('按监测日期 2026-08-15 补录一条读数', old1Readings.some((r) => r.date === '2026-08-15' && r.cumulativeMm === -33.6))
check('老数据状态为报警 → 按当时阈值留档一条报警', listAlarms().some((a) => a.pointId === 'SETT-OLD-1' && a.thresholdAtPublishMm === 30 && Math.abs(a.overshootAtPublishMm - 3.6) < 1e-6))
check('留档报警计入在效报警数', activeAlarmPointCount() >= 1)
check('存量阈值有初始档留痕', listThresholdEvents().some((e) => e.pointId === 'SETT-OLD-1' && e.reason.includes('存量')))

const old2 = points.find((p) => p.id === 'SETT-OLD-2')
check('真实存量测点 SETT-OLD-2 已补录', !!old2)
check('未超限老测点状态正常', old2?.status === '正常', `实际 ${old2?.status}`)

check('占位样例行不会因编号重复污染（种子同编号仍只有一条）', points.filter((p) => p.id === 'SETT-0001').length <= 1)
check('种子测点仍然存在（SETT-0101）', points.some((p) => p.id === 'SETT-0101'))

const oldBuilding = listBuildings().find((b) => b.id === 'BUIL-OLD-1')
check('老建筑对象补录进来', oldBuilding?.name === '老城街 8 号院')
check('未关联测点的老建筑为待布点', oldBuilding?.status === '待布点')

// 补录只跑一次：再次加载不会重复
const count1 = listPoints().length
loadMonitorState()
const count2 = listPoints().length
check('重复加载不重复补录', count1 === count2, `${count1} vs ${count2}`)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
