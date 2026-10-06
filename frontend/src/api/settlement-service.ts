import { allRows, invalidateCache, listRows, persistAll, readFresh, saveRows } from '@/data/local-store'
import { DEFAULT_UNIT, MONITORING_UNITS } from '@/data/units'
import type { ActionResult, ActorContext, EntryRow } from '@/data/types'

// 地表沉降的归属、阈值、报警都落在同一份本地数据里，这里集中收口：
// 越权与跨单位提交只认 assertPointEditable 这一个守卫，所有入口（通用动作入口
// runAction、页面直连的领域函数）都必须过它，不再各写各的校验。
export const SETTLEMENT_KEY = 'settlement'
export const ALARM_KEY = 'settlement_alarm'
export const THRESHOLD_LOG_KEY = 'settlement_threshold_log'
export const MONITORING_KEY = 'settlement_monitoring'

// 已解除（已稳定）的测点整段转只读：任何单位都只能查看，不能改动。
export const RELEASED_STATUS = '已稳定'

const STATUS_NORMAL = '正常'
const STATUS_WARNING = '预警'
const STATUS_ALARM = '报警'

const ALARM_ACTIVE = '有效'
const ALARM_LIFTED = '已解除'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function nowText(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function todayText(): string {
  return nowText().slice(0, 10)
}

/** 老数据里阈值、沉降可能是样例文本，解析不出就按 null 处理，绝不让老记录把流程跑崩。 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// ---------------------------------------------------------------------------
// 老数据迁移：补归属单位、对齐测点状态、按监测日期把存量测点照旧补录进监测记录。
// 幂等，每次读写沉降数据前都过一遍；只有真的缺东西才会落笔。
// ---------------------------------------------------------------------------
function ensureSettlementMigrated(): void {
  const points = listRows(SETTLEMENT_KEY)
  let pointsChanged = false
  const nextPoints = points.map((point) => {
    const next = { ...point }
    if (!next['归属单位']) {
      next['归属单位'] = DEFAULT_UNIT
      pointsChanged = true
    }
    if (next['测点状态'] !== next.status) {
      next['测点状态'] = next.status
      pointsChanged = true
    }
    return next
  })
  if (pointsChanged) {
    saveRows(SETTLEMENT_KEY, nextPoints)
  }

  const records = listRows(MONITORING_KEY)
  const recorded = new Set(records.map((row) => `${row['测点id']}|${row['监测日期']}`))
  const additions: EntryRow[] = []
  let id = nextId(records)
  for (const point of listRows(SETTLEMENT_KEY)) {
    const date = String(point['监测日期'] ?? '')
    if (!date || recorded.has(`${point.id}|${date}`)) {
      continue
    }
    additions.push({
      id: id++,
      '测点id': point.id,
      '测点编号': point['测点编号'] ?? '',
      '归属单位': point['归属单位'] ?? DEFAULT_UNIT,
      '累计沉降': point['累计沉降'] ?? '',
      '沉降速率': point['沉降速率'] ?? '',
      '监测日期': date,
      '提交人': '系统补录',
      '提交单位': point['归属单位'] ?? DEFAULT_UNIT,
      '提交时间': date,
    })
  }
  if (additions.length > 0) {
    saveRows(MONITORING_KEY, [...records, ...additions])
  }
}

// ---------------------------------------------------------------------------
// 事务：先算好整批写入，落库后作废缓存、从存储介质重读核对；
// 中途断掉就重试一次，仍不行就整条抽回快照，绝不拿老数据兜底。
// ---------------------------------------------------------------------------
type CommitPayload = {
  writes: Record<string, EntryRow[]>
  message: string
}

function commit(payload: CommitPayload): ActionResult {
  const snapshot = clone(allRows())
  const keys = Object.keys(payload.writes)
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      persistAll({ ...snapshot, ...payload.writes })
      invalidateCache()
      const fresh = readFresh()
      for (const key of keys) {
        if (JSON.stringify(fresh[key] ?? []) !== JSON.stringify(payload.writes[key])) {
          throw new Error(`集合 ${key} 写后核对不一致`)
        }
      }
      return { ok: true, message: payload.message }
    } catch {
      // 写入或核对失败，进入下一次重试
    }
  }
  try {
    persistAll(snapshot)
    invalidateCache()
  } catch {
    // 快照回写也失败时保持缓存作废，下次读取以存储介质为准
  }
  return { ok: false, message: '写入未通过核对，已整条抽回，请重试' }
}

// ---------------------------------------------------------------------------
// 守卫：越权与跨单位提交当场拦下；已解除的测点整段只读。
// ---------------------------------------------------------------------------
function assertPointEditable(point: EntryRow, actor: ActorContext): string | null {
  if (String(point.status) === RELEASED_STATUS) {
    return `测点 ${point['测点编号']} 已解除（${RELEASED_STATUS}），整段只读，任何单位都不能改动`
  }
  const owner = String(point['归属单位'] ?? '')
  if (owner !== actor.unit) {
    return `测点 ${point['测点编号']} 归属「${owner}」，当前账号「${actor.unit}」越权，已当场拒绝`
  }
  return null
}

function findPoint(pointId: number): { point: EntryRow; index: number } | null {
  const points = listRows(SETTLEMENT_KEY)
  const index = points.findIndex((row) => Number(row.id) === pointId)
  return index < 0 ? null : { point: points[index], index }
}

function exceeds(total: number | null, threshold: number | null): boolean | null {
  if (total === null || threshold === null) {
    return null
  }
  return total >= threshold
}

function activeAlarmOf(pointId: number, alarms: EntryRow[]): EntryRow | undefined {
  return alarms.find((row) => Number(row['测点id']) === pointId && row['状态'] === ALARM_ACTIVE)
}

/** 超限幅度以地表沉降测点实测为准：累计沉降 − 判定阈值，建筑监测一侧直接引用不重算。 */
function exceedanceOf(point: EntryRow, threshold: number | null): number | '' {
  const total = toNumber(point['累计沉降'])
  if (total === null || threshold === null) {
    return ''
  }
  return Math.round((total - threshold) * 1000) / 1000
}

/** 改口径之后，已发布的报警照新阈值重算一遍再来判定；发布时阈值留在档里不动。 */
function rejudgeAlarms(point: EntryRow, alarms: EntryRow[], threshold: number | null, stamp: string): EntryRow[] {
  const total = toNumber(point['累计沉降'])
  return alarms.map((alarm) => {
    if (Number(alarm['测点id']) !== Number(point.id) || alarm['状态'] !== ALARM_ACTIVE) {
      return alarm
    }
    const stands = exceeds(total, threshold)
    const lifted = stands === false
    return {
      ...alarm,
      '判定阈值': threshold ?? alarm['判定阈值'],
      '超限幅度': exceedanceOf(point, threshold),
      '结论': stands === false ? '不成立' : '成立',
      '状态': lifted ? ALARM_LIFTED : ALARM_ACTIVE,
      '最近重算时间': stamp,
    }
  })
}

/** 测点状态跟着阈值与有效报警走：有有效报警即报警，达到阈值即预警，其余正常；已稳定不动。 */
function statusOf(point: EntryRow, alarms: EntryRow[]): string {
  if (String(point.status) === RELEASED_STATUS) {
    return RELEASED_STATUS
  }
  if (activeAlarmOf(Number(point.id), alarms)) {
    return STATUS_ALARM
  }
  const over = exceeds(toNumber(point['累计沉降']), toNumber(point['预警阈值']))
  return over === true ? STATUS_WARNING : STATUS_NORMAL
}

function withStatus(point: EntryRow, alarms: EntryRow[]): EntryRow {
  const status = statusOf(point, alarms)
  return {
    ...point,
    status,
    '测点状态': status,
    pending: status !== RELEASED_STATUS,
    abnormal: status === STATUS_ALARM,
  }
}

export type MonitoringInput = {
  累计沉降: string | number
  沉降速率?: string | number
  监测日期?: string
}

// ---------------------------------------------------------------------------
// 提交监测：同测点同监测日期只留最早那条，再递一遍仍按最早那次。
// ---------------------------------------------------------------------------
export function submitMonitoring(pointId: number, input: MonitoringInput, actor: ActorContext): ActionResult {
  ensureSettlementMigrated()
  const found = findPoint(pointId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${pointId} 的沉降测点` }
  }
  const denied = assertPointEditable(found.point, actor)
  if (denied) {
    return { ok: false, message: denied }
  }
  const total = toNumber(input.累计沉降)
  if (total === null) {
    return { ok: false, message: '累计沉降必须是数字，已当场拦下' }
  }
  const date = (input.监测日期 ?? '').trim() || todayText()
  if (!DATE_RE.test(date)) {
    return { ok: false, message: `监测日期「${date}」格式应为 YYYY-MM-DD，已当场拦下` }
  }
  const rateInput = input.沉降速率
  const rate = rateInput === undefined || String(rateInput).trim() === '' ? null : toNumber(rateInput)
  if (rateInput !== undefined && String(rateInput).trim() !== '' && rate === null) {
    return { ok: false, message: '沉降速率必须是数字，已当场拦下' }
  }

  const records = listRows(MONITORING_KEY)
  const duplicated = records.find(
    (row) => Number(row['测点id']) === pointId && String(row['监测日期']) === date,
  )
  if (duplicated) {
    return {
      ok: true,
      message: `测点 ${found.point['测点编号']} 在 ${date} 的监测已提交过（最早于 ${duplicated['提交时间']}），按最早那条处理，不重复登记`,
    }
  }

  const stamp = nowText()
  const nextPoint: EntryRow = {
    ...found.point,
    '累计沉降': total,
    '沉降速率': rate ?? found.point['沉降速率'],
    '监测日期': date,
  }
  const alarms = rejudgeAlarms(nextPoint, listRows(ALARM_KEY), toNumber(nextPoint['预警阈值']), stamp)
  const points = listRows(SETTLEMENT_KEY).map((row) =>
    Number(row.id) === pointId ? withStatus(nextPoint, alarms) : row,
  )
  const record: EntryRow = {
    id: nextId(records),
    '测点id': pointId,
    '测点编号': nextPoint['测点编号'],
    '归属单位': nextPoint['归属单位'],
    '累计沉降': total,
    '沉降速率': rate ?? '',
    '监测日期': date,
    '提交人': actor.operator,
    '提交单位': actor.unit,
    '提交时间': stamp,
  }
  return commit({
    writes: {
      [SETTLEMENT_KEY]: points,
      [ALARM_KEY]: alarms,
      [MONITORING_KEY]: [...records, record],
    },
    message: `测点 ${nextPoint['测点编号']} 监测已提交，当前状态「${statusOf(nextPoint, alarms)}」`,
  })
}

// ---------------------------------------------------------------------------
// 发布预警：同一测点只留一条有效报警，重复发布按最早那条，不多出记录。
// ---------------------------------------------------------------------------
export function publishAlarm(pointId: number, actor: ActorContext): ActionResult {
  ensureSettlementMigrated()
  const found = findPoint(pointId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${pointId} 的沉降测点` }
  }
  const denied = assertPointEditable(found.point, actor)
  if (denied) {
    return { ok: false, message: denied }
  }
  const status = String(found.point.status)
  const alarms = listRows(ALARM_KEY)
  const existing = activeAlarmOf(pointId, alarms)
  if (existing) {
    return {
      ok: true,
      message: `测点 ${found.point['测点编号']} 的报警已发布（最早于 ${existing['首次发布时间']}），按最早那条处理，不重复登记`,
    }
  }
  if (status !== STATUS_WARNING && status !== STATUS_ALARM) {
    return { ok: false, message: `测点 ${found.point['测点编号']} 当前「${status}」，未达到预警条件，不能发布报警` }
  }

  const stamp = nowText()
  const threshold = toNumber(found.point['预警阈值'])
  const alarm: EntryRow = {
    id: nextId(alarms),
    '测点id': pointId,
    '测点编号': found.point['测点编号'],
    '归属单位': found.point['归属单位'],
    '累计沉降': found.point['累计沉降'],
    '发布时阈值': threshold ?? found.point['预警阈值'],
    '判定阈值': threshold ?? found.point['预警阈值'],
    '超限幅度': exceedanceOf(found.point, threshold),
    '结论': '成立',
    '状态': ALARM_ACTIVE,
    '监测日期': found.point['监测日期'] ?? '',
    '首次发布时间': stamp,
    '最近重算时间': '',
  }
  const nextAlarms = [...alarms, alarm]
  const points = listRows(SETTLEMENT_KEY).map((row) =>
    Number(row.id) === pointId ? withStatus(row, nextAlarms) : row,
  )
  return commit({
    writes: { [SETTLEMENT_KEY]: points, [ALARM_KEY]: nextAlarms },
    message: `测点 ${found.point['测点编号']} 报警已发布，结论同步进建筑监测报警清单`,
  })
}

// ---------------------------------------------------------------------------
// 确认稳定：测点整段转只读，有效报警随之解除留档。
// ---------------------------------------------------------------------------
export function confirmStable(pointId: number, actor: ActorContext): ActionResult {
  ensureSettlementMigrated()
  const found = findPoint(pointId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${pointId} 的沉降测点` }
  }
  const denied = assertPointEditable(found.point, actor)
  if (denied) {
    return { ok: false, message: denied }
  }
  const stamp = nowText()
  const alarms = listRows(ALARM_KEY).map((alarm) =>
    Number(alarm['测点id']) === pointId && alarm['状态'] === ALARM_ACTIVE
      ? { ...alarm, '状态': ALARM_LIFTED, '最近重算时间': stamp }
      : alarm,
  )
  const released: EntryRow = {
    ...found.point,
    status: RELEASED_STATUS,
    '测点状态': RELEASED_STATUS,
    pending: false,
    abnormal: false,
  }
  const points = listRows(SETTLEMENT_KEY).map((row) => (Number(row.id) === pointId ? released : row))
  return commit({
    writes: { [SETTLEMENT_KEY]: points, [ALARM_KEY]: alarms },
    message: `测点 ${found.point['测点编号']} 已确认稳定，整段转只读`,
  })
}

// ---------------------------------------------------------------------------
// 调整阈值：只认归属单位；全程留痕，已发布报警照新阈值重算再判定。
// ---------------------------------------------------------------------------
export function adjustThreshold(pointId: number, newThreshold: number, actor: ActorContext): ActionResult {
  ensureSettlementMigrated()
  const found = findPoint(pointId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${pointId} 的沉降测点` }
  }
  const denied = assertPointEditable(found.point, actor)
  if (denied) {
    return { ok: false, message: denied }
  }
  if (!Number.isFinite(newThreshold) || newThreshold <= 0) {
    return { ok: false, message: '预警阈值必须是大于 0 的数字，已当场拦下' }
  }
  const oldThreshold = toNumber(found.point['预警阈值'])
  if (oldThreshold !== null && oldThreshold === newThreshold) {
    return { ok: false, message: `测点 ${found.point['测点编号']} 阈值已是 ${newThreshold}，未变化不重复留痕` }
  }

  const stamp = nowText()
  const logs = listRows(THRESHOLD_LOG_KEY)
  const log: EntryRow = {
    id: nextId(logs),
    '测点id': pointId,
    '测点编号': found.point['测点编号'],
    '归属单位': found.point['归属单位'],
    '旧阈值': oldThreshold ?? found.point['预警阈值'] ?? '',
    '新阈值': newThreshold,
    '操作人': actor.operator,
    '操作单位': actor.unit,
    '调整时间': stamp,
  }
  const nextPoint: EntryRow = { ...found.point, '预警阈值': newThreshold }
  const alarms = rejudgeAlarms(nextPoint, listRows(ALARM_KEY), newThreshold, stamp)
  const points = listRows(SETTLEMENT_KEY).map((row) =>
    Number(row.id) === pointId ? withStatus(nextPoint, alarms) : row,
  )
  return commit({
    writes: {
      [SETTLEMENT_KEY]: points,
      [ALARM_KEY]: alarms,
      [THRESHOLD_LOG_KEY]: [...logs, log],
    },
    message: `测点 ${nextPoint['测点编号']} 阈值已调整并留痕，已发布报警按新阈值重算`,
  })
}

// ---------------------------------------------------------------------------
// 划转移交：归属跟着测点走，在途报警的归属一并划走；划走后原单位立即越权。
// ---------------------------------------------------------------------------
export function transferPoint(pointId: number, toUnit: string, actor: ActorContext): ActionResult {
  ensureSettlementMigrated()
  const found = findPoint(pointId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${pointId} 的沉降测点` }
  }
  const denied = assertPointEditable(found.point, actor)
  if (denied) {
    return { ok: false, message: denied }
  }
  const target = toUnit.trim()
  if (!MONITORING_UNITS.includes(target)) {
    return { ok: false, message: `接收单位「${target}」不在监测单位名录里，已当场拦下` }
  }
  if (target === String(found.point['归属单位'])) {
    return { ok: false, message: `测点 ${found.point['测点编号']} 本就归属「${target}」，无需划转` }
  }
  const points = listRows(SETTLEMENT_KEY).map((row) =>
    Number(row.id) === pointId ? { ...row, '归属单位': target } : row,
  )
  const alarms = listRows(ALARM_KEY).map((alarm) =>
    Number(alarm['测点id']) === pointId && alarm['状态'] === ALARM_ACTIVE
      ? { ...alarm, '归属单位': target }
      : alarm,
  )
  return commit({
    writes: { [SETTLEMENT_KEY]: points, [ALARM_KEY]: alarms },
    message: `测点 ${found.point['测点编号']} 已划转移交「${target}」，归属同步更新`,
  })
}

// ---------------------------------------------------------------------------
// 通用动作入口：runAction 走到沉降模块时在这里分发，守卫与领域函数完全一致。
// ---------------------------------------------------------------------------
export function runSettlementAction(
  pointId: number,
  action: string,
  actor: ActorContext,
  input?: MonitoringInput & { 新阈值?: number; 接收单位?: string },
): ActionResult {
  ensureSettlementMigrated()
  // 缺参数的通用入口也要先过守卫：越权与只读当场拦下，再提示缺参数。
  const guardFirst = (): ActionResult | null => {
    const found = findPoint(pointId)
    if (!found) {
      return { ok: false, message: `没有找到编号为 ${pointId} 的沉降测点` }
    }
    const denied = assertPointEditable(found.point, actor)
    return denied ? { ok: false, message: denied } : null
  }
  switch (action) {
    case '提交监测':
      if (!input || input.累计沉降 === undefined) {
        const blocked = guardFirst()
        return blocked ?? { ok: false, message: '提交监测需要累计沉降与监测日期，请从地表沉降页面表单提交' }
      }
      return submitMonitoring(pointId, input, actor)
    case '发布预警':
      return publishAlarm(pointId, actor)
    case '确认稳定':
      return confirmStable(pointId, actor)
    case '调整阈值':
      if (!input || input.新阈值 === undefined) {
        const blocked = guardFirst()
        return blocked ?? { ok: false, message: '调整阈值需要填写新阈值，请从地表沉降页面表单提交' }
      }
      return adjustThreshold(pointId, input.新阈值, actor)
    case '划转移交':
      if (!input || input.接收单位 === undefined) {
        const blocked = guardFirst()
        return blocked ?? { ok: false, message: '划转移交需要填写接收单位，请从地表沉降页面表单提交' }
      }
      return transferPoint(pointId, input.接收单位, actor)
    default:
      return { ok: false, message: `沉降测点没有登记「${action}」这个动作` }
  }
}

// ---------------------------------------------------------------------------
// 查询：报警清单只有一份，地表沉降页与建筑监测页读同一处，两处计数天然对得上。
// ---------------------------------------------------------------------------
export function listSettlementPoints(): EntryRow[] {
  ensureSettlementMigrated()
  return listRows(SETTLEMENT_KEY)
}

export function listSettlementAlarms(): EntryRow[] {
  ensureSettlementMigrated()
  return listRows(ALARM_KEY)
}

export function listActiveAlarms(): EntryRow[] {
  return listSettlementAlarms().filter((row) => row['状态'] === ALARM_ACTIVE)
}

export function countActiveAlarms(): number {
  return listActiveAlarms().length
}

export function listThresholdLog(): EntryRow[] {
  ensureSettlementMigrated()
  return listRows(THRESHOLD_LOG_KEY)
}

export function listMonitoringRecords(): EntryRow[] {
  ensureSettlementMigrated()
  return listRows(MONITORING_KEY)
}
