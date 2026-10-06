import { rawLegacyEntries } from '@/data/local-store'
import { createSeedMonitorState } from './seed'
import type {
  AlarmRecord,
  MonitorState,
  SettlementPoint,
  SettlementReading,
  ThresholdEvent,
} from './types'

// 监测领域独立存储键，与泛型模块表分开。
const STATE_KEY = 'shield-tunnel-construction:monitor'
// 每次成功落盘的备份：主副本坏掉时从这里恢复，绝不回退到种子老数据。
const BACKUP_KEY = 'shield-tunnel-construction:monitor:backup'
const STATE_VERSION = 1

function storage(): Storage {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('本地存储不可用，监测数据无法读取')
  }
  return window.localStorage
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 「xxx 样例N」是仓库自带的占位演示行，不是真实存量，不补录。 */
function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && /样例\d+$/.test(value.trim())
}

/** 兼容老数据：「-12.6mm」「30 mm」之类带单位字符串也能解析；解析不出来给 null。 */
export function parseNumberLenient(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.replace(/[^\d.\-+]/g, '')
  if (text === '' || text === '-' || text === '+' || text === '.') return null
  const num = Number(text)
  return Number.isFinite(num) ? num : null
}

/**
 * 从泛型模块表（老版本数据）补录存量测点，按监测日期照旧。
 * 补录只跑一次；补录进来的测点标 legacy，数值挂兜底字段，参与同一套权限与重算。
 */
function migrateLegacyRows(state: MonitorState): void {
  if (state.migratedFromLegacy) return
  const legacy = rawLegacyEntries()
  const settlementRows = legacy.settlement ?? []
  const buildingRows = legacy.building ?? []

  for (const row of settlementRows) {
    const code = String(row['测点编号'] ?? '').trim()
    const location = String(row['测点位置'] ?? '').trim()
    // 「xxx 样例N」是仓库自带的占位演示行（编号可能像真的，但名称/字段是样例值），不补录。
    const placeholderFields = ['测点位置', '初始高程', '累计沉降', '沉降速率', '预警阈值']
    const looksPlaceholder =
      !code ||
      isPlaceholder(code) ||
      (isPlaceholder(location) &&
        placeholderFields.every((field) => isPlaceholder(row[field])))
    if (looksPlaceholder) continue
    if (state.points.some((point) => point.id === code)) continue

    const cumulative = parseNumberLenient(row['累计沉降'])
    const rate = parseNumberLenient(row['沉降速率'])
    const threshold = parseNumberLenient(row['预警阈值'])
    const date = String(row['监测日期'] ?? '').trim() || '2026-09-01'
    const point: SettlementPoint = {
      id: code,
      name: String(row['测点位置'] ?? code),
      location: String(row['测点位置'] ?? code),
      initialElevationM: parseNumberLenient(row['初始高程']) ?? 0,
      thresholdMm: threshold ?? 30,
      ownerUnitId: 'unit-cr',
      buildingId: null,
      released: String(row.status) === '已稳定',
      releasedAt: String(row.status) === '已稳定' ? `${date}T00:00:00+08:00` : null,
      monitorDate: date,
      legacy: true,
    }
    if (cumulative !== null) point.legacyCumulativeMm = cumulative
    if (rate !== null) point.legacyRateMmPerDay = rate
    state.points.push(point)

    // 存量读数按监测日期补录一条。
    if (cumulative !== null) {
      state.seq += 1
      const reading: SettlementReading = {
        id: state.seq,
        pointId: code,
        date,
        cumulativeMm: cumulative,
        rateMmPerDay: rate ?? 0,
        unitId: 'unit-cr',
        operator: '存量补录',
        createdAt: `${date}T00:00:00+08:00`,
      }
      state.readings.push(reading)
    }

    // 老版本处于「报警」的存量测点：按当时阈值（取行内阈值，无则当前阈值）留档一条报警。
    if (String(row.status) === '报警' && cumulative !== null) {
      state.seq += 1
      const thresholdAt = point.thresholdMm
      const alarm: AlarmRecord = {
        id: state.seq,
        pointId: code,
        buildingId: null,
        buildingName: null,
        unitId: 'unit-cr',
        operator: '存量补录',
        publishedAt: `${date}T00:00:00+08:00`,
        thresholdAtPublishMm: thresholdAt,
        cumulativeAtPublishMm: cumulative,
        overshootAtPublishMm: Number(Math.max(0, Math.abs(cumulative) - thresholdAt).toFixed(3)),
        status: point.released ? '测点解除关闭' : '在效',
        closedAt: point.releasedAt,
        closeReason: point.released ? '存量补录：测点已解除' : null,
      }
      state.alarms.push(alarm)
    }

    // 老数据的阈值口径留一条初始档，之后每次调整都有痕可查。
    state.seq += 1
    const event: ThresholdEvent = {
      id: state.seq,
      pointId: code,
      oldThresholdMm: point.thresholdMm,
      newThresholdMm: point.thresholdMm,
      reason: '存量测点补录：沿用历史预警阈值',
      unitId: 'unit-cr',
      operator: '存量补录',
      at: `${date}T00:00:00+08:00`,
    }
    state.thresholdEvents.push(event)
  }

  // 建筑对象老行：编码与名字是真实的就带进来（未布点，可后续在建筑页关联测点）。
  for (const row of buildingRows) {
    const code = String(row['对象编号'] ?? '').trim()
    const name = String(row['建筑物名称'] ?? '').trim()
    if (!code || isPlaceholder(code) || isPlaceholder(name) || !name) continue
    if (state.buildings.some((building) => building.id === code)) continue
    state.buildings.push({
      id: code,
      name,
      structureType: String(row['结构类型'] ?? '未登记'),
      distanceToTunnelM: parseNumberLenient(row['距隧道距离']) ?? 0,
      allowableSettlementMm: parseNumberLenient(row['允许沉降']) ?? 30,
      frequency: String(row['监测频次'] ?? '1 次/日'),
    })
  }

  state.migratedFromLegacy = true
}

function hydrate(raw: string): MonitorState {
  const parsed = JSON.parse(raw) as MonitorState
  if (!parsed || !Array.isArray(parsed.points) || !Array.isArray(parsed.alarms)) {
    throw new Error('监测数据结构不完整')
  }
  return parsed
}

let cache: MonitorState | null = null

/**
 * 读取监测状态：主副本 → 备份副本；两者都坏就直接报错。
 * 绝不静默回退种子，避免「中途断掉拿老数据兜底」把用户改动盖掉。
 */
export function loadMonitorState(): MonitorState {
  if (cache) return cache
  const ls = storage()
  const raw = ls.getItem(STATE_KEY)
  if (raw !== null) {
    try {
      const state = hydrate(raw)
      migrateLegacyRows(state)
      cache = state
      return state
    } catch (error) {
      const backup = ls.getItem(BACKUP_KEY)
      if (backup !== null) {
        try {
          const state = hydrate(backup)
          migrateLegacyRows(state)
          cache = state
          return state
        } catch {
          // 落下去统一报错
        }
      }
      throw new Error(
        `监测数据读取失败且备份不可用：${error instanceof Error ? error.message : '数据损坏'}`,
      )
    }
  }
  const seeded = createSeedMonitorState()
  migrateLegacyRows(seeded)
  cache = seeded
  return seeded
}

/**
 * 原子提交：先在内存里完成全部变更，再整体落盘；任一步失败整条抽回（缓存不替换）。
 * localStorage 写入失败按瞬时故障重试 3 次；成功后再读一遍核对，不一致也算失败并回滚。
 */
export function commitMonitorState(next: MonitorState): MonitorState {
  const snapshot = cache ? clone(cache) : null
  const ls = storage()
  const payload = JSON.stringify(next)
  let lastError: unknown = null

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      ls.setItem(STATE_KEY, payload)
      // 落盘后重新进「页面」核对一遍：以存储里实际内容为准，防止中途断掉。
      const verified = hydrate(ls.getItem(STATE_KEY) ?? 'null')
      if (JSON.stringify(verified) !== payload) {
        throw new Error('落盘后核对不一致')
      }
      // 主副本核对通过即以它为准刷新内存；备份只是灾难兜底，尽力写、失败不回滚主数据。
      cache = next
      try {
        ls.setItem(BACKUP_KEY, payload)
      } catch {
        // 下次成功写入会补上备份，不影响本次提交。
      }
      return next
    } catch (error) {
      lastError = error
    }
  }

  if (snapshot) cache = snapshot
  throw new Error(
    `监测数据写入失败，已整条回滚（重试 3 次仍不成功）：${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

/** 基于当前状态做一次原子变更；变更函数抛错时不落盘。 */
export function mutateMonitorState(mutate: (draft: MonitorState) => void): MonitorState {
  const current = loadMonitorState()
  const draft = clone(current)
  mutate(draft)
  return commitMonitorState(draft)
}

export function nextSeq(state: MonitorState): number {
  state.seq += 1
  return state.seq
}
