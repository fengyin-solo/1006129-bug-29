import { loadMonitorState, mutateMonitorState, nextSeq, parseNumberLenient } from './store'
import { MONITOR_UNITS, unitName } from './seed'
import { MonitorError } from './types'
import type {
  AlarmRecord,
  MonitorBuilding,
  MonitorState,
  PointStatus,
  SettlementPoint,
  SettlementReading,
} from './types'

export { MONITOR_UNITS, unitName }
export { parseNumberLenient }

export type Actor = { unitId: string }

export type PointView = SettlementPoint & {
  ownerName: string
  status: PointStatus
  /** 最新累计沉降（mm）：优先取最新读数，老数据走兜底字段。 */
  latestCumulativeMm: number | null
  latestRateMmPerDay: number | null
  latestDate: string | null
  currentThresholdMm: number
  /** 按当前阈值计算的超限幅度（mm，绝对值；未超限为 0）。 */
  overshootMm: number
  activeAlarmId: number | null
  buildingName: string | null
}

export type BuildingView = MonitorBuilding & {
  pointId: string | null
  ownerUnitId: string | null
  ownerName: string | null
  status: PointStatus | '待布点'
  activeAlarmId: number | null
  /** 关联测点的实测沉降与超限幅度，超限判定一律以测点侧为准。 */
  measuredMm: number | null
  overshootMm: number
}

// ---------- 基础查询 ----------

function readingsOf(state: MonitorState, pointId: string): SettlementReading[] {
  return state.readings
    .filter((reading) => reading.pointId === pointId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
}

export function latestReading(
  state: MonitorState,
  point: SettlementPoint,
): SettlementReading | null {
  const list = readingsOf(state, point.id)
  if (list.length) return list[list.length - 1]
  if (point.legacyCumulativeMm !== undefined) {
    return {
      id: -1,
      pointId: point.id,
      date: point.monitorDate,
      cumulativeMm: point.legacyCumulativeMm,
      rateMmPerDay: point.legacyRateMmPerDay ?? 0,
      unitId: point.ownerUnitId,
      operator: '存量补录',
      createdAt: `${point.monitorDate}T00:00:00+08:00`,
    }
  }
  return null
}

export function activeAlarmOf(state: MonitorState, pointId: string): AlarmRecord | null {
  return state.alarms.find((alarm) => alarm.pointId === pointId && alarm.status === '在效') ?? null
}

function isExceeded(point: SettlementPoint, cumulativeMm: number): boolean {
  // 沉降向下为负，超限看累计沉降绝对值是否达到阈值（达到即算，兼容阈值口径）。
  return Math.abs(cumulativeMm) >= point.thresholdMm
}

/** 超限幅度（mm，保留 3 位小数，避免浮点尾差）。 */
function overshootOf(point: SettlementPoint, cumulativeMm: number): number {
  return Number(Math.max(0, Math.abs(cumulativeMm) - point.thresholdMm).toFixed(3))
}

export function statusOf(
  state: MonitorState,
  point: SettlementPoint,
): { status: PointStatus; latest: SettlementReading | null; activeAlarm: AlarmRecord | null } {
  const activeAlarm = activeAlarmOf(state, point.id)
  if (point.released) return { status: '已解除', latest: latestReading(state, point), activeAlarm }
  const latest = latestReading(state, point)
  if (activeAlarm) return { status: '报警', latest, activeAlarm }
  if (latest && isExceeded(point, latest.cumulativeMm)) return { status: '预警', latest, activeAlarm: null }
  return { status: '正常', latest, activeAlarm: null }
}

// ---------- 权限：所有写操作的唯一入口，两处页面都走这里 ----------

function getPoint(state: MonitorState, pointId: string): SettlementPoint {
  const point = state.points.find((item) => item.id === pointId)
  if (!point) throw new MonitorError('NOT_FOUND', `测点 ${pointId} 不存在`)
  return point
}

/** 归属/权限校验：已解除整段只读；非归属单位当场拒绝（监理等外单位只能查看）。 */
function assertWritable(state: MonitorState, pointId: string, actor: Actor): SettlementPoint {
  const point = getPoint(state, pointId)
  if (point.released) {
    throw new MonitorError(
      'READONLY_RELEASED',
      `测点 ${point.id} 已解除，整段只读，任何单位都不能改动`,
    )
  }
  if (point.ownerUnitId !== actor.unitId) {
    throw new MonitorError(
      'UNAUTHORIZED_UNIT',
      `测点 ${point.id} 归属「${unitName(point.ownerUnitId)}」，当前账号单位「${unitName(
        actor.unitId,
      )}」无权操作`,
    )
  }
  return point
}

function nowIso(): string {
  return new Date().toISOString()
}

// ---------- 视图模型（两侧页面读同一份数据，报警测点数天然对得上） ----------

export function listPoints(state: MonitorState = loadMonitorState()): PointView[] {
  return state.points.map((point) => {
    const info = statusOf(state, point)
    const latest = info.latest
    const cumulative = latest?.cumulativeMm ?? null
    return {
      ...point,
      ownerName: unitName(point.ownerUnitId),
      status: info.status,
      latestCumulativeMm: cumulative,
      latestRateMmPerDay: latest?.rateMmPerDay ?? point.legacyRateMmPerDay ?? null,
      latestDate: latest?.date ?? null,
      currentThresholdMm: point.thresholdMm,
      overshootMm: cumulative !== null ? overshootOf(point, cumulative) : 0,
      activeAlarmId: info.activeAlarm?.id ?? null,
      buildingName: point.buildingId
        ? state.buildings.find((building) => building.id === point.buildingId)?.name ?? null
        : null,
    }
  })
}

export function listBuildings(state: MonitorState = loadMonitorState()): BuildingView[] {
  return state.buildings.map((building) => {
    const point = state.points.find((item) => item.buildingId === building.id)
    if (!point) {
      return {
        ...building,
        pointId: null,
        ownerUnitId: null,
        ownerName: null,
        status: '待布点',
        activeAlarmId: null,
        measuredMm: null,
        overshootMm: 0,
      }
    }
    const info = statusOf(state, point)
    const cumulative = info.latest?.cumulativeMm ?? null
    return {
      ...building,
      pointId: point.id,
      ownerUnitId: point.ownerUnitId,
      ownerName: unitName(point.ownerUnitId),
      status: point.released ? '已解除' : info.status,
      activeAlarmId: info.activeAlarm?.id ?? null,
      measuredMm: cumulative,
      // 超限幅度以地表沉降测点侧为准（建筑允许沉降仅展示）。
      overshootMm: cumulative !== null ? overshootOf(point, cumulative) : 0,
    }
  })
}

/** 建筑监测报警清单：报警结论唯一来源，地表沉降页也读它。 */
export function listAlarms(state: MonitorState = loadMonitorState()): AlarmRecord[] {
  return [...state.alarms].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
}

export function listThresholdEvents(state: MonitorState = loadMonitorState()) {
  return [...state.thresholdEvents].sort((a, b) => (a.at < b.at ? 1 : -1))
}

export function listTransferEvents(state: MonitorState = loadMonitorState()) {
  return [...state.transferEvents].sort((a, b) => (a.at < b.at ? 1 : -1))
}

export function listReadings(pointId: string, state: MonitorState = loadMonitorState()) {
  return readingsOf(state, pointId).reverse()
}

/** 两侧页面共用的「在效报警测点数」，必须一致。 */
export function activeAlarmPointCount(state: MonitorState = loadMonitorState()): number {
  return state.alarms.filter((alarm) => alarm.status === '在效').length
}

// ---------- 写操作：每个入口都带归属/越权/跨单位/只读校验 ----------

export type SubmitReadingInput = {
  pointId: string
  date: string
  cumulativeMm: number
  rateMmPerDay: number
}

/**
 * 提交监测读数（支持按监测日期补录存量）。
 * 同一测点同一天重复提交：仍按最早那次，直接幂等返回，不新增记录。
 */
export function submitReading(input: SubmitReadingInput, actor: Actor): { ok: true; duplicated: boolean } {
  if (!input.date) throw new MonitorError('INVALID_INPUT', '请填写监测日期')
  if (!Number.isFinite(input.cumulativeMm)) throw new MonitorError('INVALID_INPUT', '累计沉降数值不合法')
  const state = loadMonitorState()
  const point = assertWritable(state, input.pointId, actor)
  // 再递一遍仍按最早那次：重复提交当场幂等返回，不新增、不覆盖。
  if (readingsOf(state, point.id).some((reading) => reading.date === input.date)) {
    return { ok: true, duplicated: true }
  }
  mutateMonitorState((draft) => {
    // 落盘前在草稿上再校验一次，防止同批次并发绕过。
    assertWritable(draft, input.pointId, actor)
    draft.readings.push({
      id: nextSeq(draft),
      pointId: input.pointId,
      date: input.date,
      cumulativeMm: input.cumulativeMm,
      rateMmPerDay: Number.isFinite(input.rateMmPerDay) ? input.rateMmPerDay : 0,
      unitId: actor.unitId,
      operator: operatorOf(actor),
      createdAt: nowIso(),
    })
  })
  return { ok: true, duplicated: false }
}

function operatorOf(actor: Actor): string {
  return MONITOR_UNITS.find((unit) => unit.id === actor.unitId)?.operator ?? actor.unitId
}

/**
 * 发布报警。两处入口（地表沉降页、建筑监测页）都走这里。
 *  - 越权/跨单位/已解除：当场拒绝；
 *  - 当前未超限：拒绝发布；
 *  - 同一测点已有在效报警：再发布只认最早那条，直接返回已有记录，不多出一条；
 *  - 发布时把阈值、累计沉降、超限幅度做快照留档。
 */
export function publishAlarm(pointId: string, actor: Actor): AlarmRecord {
  let alarm: AlarmRecord | null = null
  mutateMonitorState((draft) => {
    const point = assertWritable(draft, pointId, actor)
    const existed = activeAlarmOf(draft, point.id)
    if (existed) {
      alarm = existed
      return
    }
    const latest = latestReading(draft, point)
    if (!latest) {
      throw new MonitorError('NOT_EXCEEDED', `测点 ${point.id} 还没有监测读数，不能发布报警`)
    }
    if (!isExceeded(point, latest.cumulativeMm)) {
      throw new MonitorError(
        'NOT_EXCEEDED',
        `测点 ${point.id} 当前累计沉降 ${latest.cumulativeMm}mm，未达到阈值 ${point.thresholdMm}mm，不能发布报警`,
      )
    }
    const building = point.buildingId
      ? draft.buildings.find((item) => item.id === point.buildingId) ?? null
      : null
    const record: AlarmRecord = {
      id: nextSeq(draft),
      pointId: point.id,
      buildingId: point.buildingId,
      buildingName: building?.name ?? null,
      unitId: actor.unitId,
      operator: operatorOf(actor),
      publishedAt: nowIso(),
      thresholdAtPublishMm: point.thresholdMm,
      cumulativeAtPublishMm: latest.cumulativeMm,
      overshootAtPublishMm: overshootOf(point, latest.cumulativeMm),
      status: '在效',
      closedAt: null,
      closeReason: null,
    }
    draft.alarms.push(record)
    alarm = record
  })
  if (!alarm) throw new Error('报警发布结果缺失，请重试')
  return alarm
}

/**
 * 调整预警阈值：只有归属单位能调，每次调整留痕。
 * 改口径之后，已发布的在效报警照新阈值重算一遍再来判定：
 *  - 仍超限：继续在效（不动旧记录，发布快照留档）；
 *  - 不再超限：在效报警关闭（状态「阈值重算解除」），历史记录按当时阈值保留。
 */
export function adjustThreshold(
  pointId: string,
  newThresholdMm: number,
  reason: string,
  actor: Actor,
): { recalculated: Array<{ alarmId: number; nowActive: boolean }> } {
  if (!Number.isFinite(newThresholdMm) || newThresholdMm <= 0) {
    throw new MonitorError('INVALID_INPUT', '新阈值必须是大于 0 的数字（mm）')
  }
  const trimmedReason = reason.trim()
  if (!trimmedReason) throw new MonitorError('INVALID_INPUT', '调整阈值必须填写原因，全程留痕')

  const recalculated: Array<{ alarmId: number; nowActive: boolean }> = []
  mutateMonitorState((draft) => {
    const point = assertWritable(draft, pointId, actor)
    if (point.thresholdMm === newThresholdMm) {
      throw new MonitorError('INVALID_INPUT', '新阈值与当前阈值一致，无需调整')
    }
    const old = point.thresholdMm
    point.thresholdMm = newThresholdMm
    draft.thresholdEvents.push({
      id: nextSeq(draft),
      pointId: point.id,
      oldThresholdMm: old,
      newThresholdMm,
      reason: trimmedReason,
      unitId: actor.unitId,
      operator: operatorOf(actor),
      at: nowIso(),
    })

    // 已发布的在效报警照新阈值重算。
    for (const alarmRecord of draft.alarms) {
      if (alarmRecord.pointId !== point.id || alarmRecord.status !== '在效') continue
      const latest = latestReading(draft, point)
      const stillExceeded = latest ? isExceeded(point, latest.cumulativeMm) : false
      if (stillExceeded) {
        recalculated.push({ alarmId: alarmRecord.id, nowActive: true })
      } else {
        alarmRecord.status = '阈值重算解除'
        alarmRecord.closedAt = nowIso()
        alarmRecord.closeReason = `阈值口径由 ${old}mm 调整为 ${newThresholdMm}mm，按新阈值重算不再超限`
        recalculated.push({ alarmId: alarmRecord.id, nowActive: false })
      }
    }
  })
  return { recalculated }
}

/**
 * 测点解除：整段转只读，在效报警关闭留档。解除后任何单位都不能再改，仅可查看。
 */
export function releasePoint(
  pointId: string,
  actor: Actor,
): { recalculated: Array<{ alarmId: number }> } {
  const closed: Array<{ alarmId: number }> = []
  mutateMonitorState((draft) => {
    const point = assertWritable(draft, pointId, actor)
    point.released = true
    point.releasedAt = nowIso()
    for (const alarmRecord of draft.alarms) {
      if (alarmRecord.pointId !== point.id || alarmRecord.status !== '在效') continue
      alarmRecord.status = '测点解除关闭'
      alarmRecord.closedAt = point.releasedAt
      alarmRecord.closeReason = '测点解除，整段转只读，报警关闭'
      closed.push({ alarmId: alarmRecord.id })
    }
  })
  return { recalculated: closed }
}

/**
 * 测点划转：仅归属单位可发起；划走后归属立即变成新单位，原单位不再有权限，留痕。
 * 已解除测点只读，不能划转。
 */
export function transferPoint(
  pointId: string,
  toUnitId: string,
  reason: string,
  actor: Actor,
): void {
  if (!MONITOR_UNITS.some((unit) => unit.id === toUnitId)) {
    throw new MonitorError('INVALID_INPUT', '目标监测单位不存在')
  }
  const trimmedReason = reason.trim()
  if (!trimmedReason) throw new MonitorError('INVALID_INPUT', '划转测点必须填写原因')
  mutateMonitorState((draft) => {
    const point = assertWritable(draft, pointId, actor)
    if (point.ownerUnitId === toUnitId) {
      throw new MonitorError('INVALID_INPUT', '测点已归属该单位，无需划转')
    }
    const from = point.ownerUnitId
    point.ownerUnitId = toUnitId
    // 测点编码挂在新单位名下后，未关闭报警的归属快照不回改（结论属当时事实）。
    draft.transferEvents.push({
      id: nextSeq(draft),
      pointId: point.id,
      fromUnitId: from,
      toUnitId,
      reason: trimmedReason,
      operator: operatorOf(actor),
      at: nowIso(),
    })
  })
}

/**
 * 建筑监测页「布设测点」：把一个尚未布点的测点关联到监测对象。
 * 两个入口共用归属校验：跨单位、已解除当场拦下。
 */
export function deployPoint(buildingId: string, pointId: string, actor: Actor): void {
  mutateMonitorState((draft) => {
    const building = draft.buildings.find((item) => item.id === buildingId)
    if (!building) throw new MonitorError('NOT_FOUND', `监测对象 ${buildingId} 不存在`)
    const point = assertWritable(draft, pointId, actor)
    if (point.buildingId && point.buildingId !== buildingId) {
      throw new MonitorError(
        'INVALID_INPUT',
        `测点 ${point.id} 已布点到其他监测对象，不能重复布设`,
      )
    }
    const occupied = draft.points.find(
      (item) => item.buildingId === buildingId && item.id !== point.id && !item.released,
    )
    if (occupied) {
      throw new MonitorError(
        'INVALID_INPUT',
        `监测对象 ${building.name} 已由测点 ${occupied.id} 监测，请勿重复布设`,
      )
    }
    point.buildingId = buildingId
  })
}

/** 把任意异常归一成 message，页面只负责展示。 */
export function errorMessageOf(error: unknown): string {
  if (error instanceof MonitorError) return error.message
  if (error instanceof Error) return error.message
  return '操作失败，请重试'
}
