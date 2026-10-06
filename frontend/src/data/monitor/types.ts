/**
 * 监测领域（地表沉降 + 建筑监测）专用类型。
 *
 * 两个页面（地表沉降、建筑监测）共用同一份测点与报警数据：
 * 测点归属、阈值、报警结论只在这里存在一份，任何入口都不允许各写各的。
 */

/** 监测单位：测点按单位归属，阈值与状态操作只有归属单位能做。 */
export type MonitorUnit = {
  id: string
  name: string
  /** 值班账号名，写进阈值/归属/报警的留痕记录里。 */
  operator: string
}

/** 一次监测读数（mm，累计沉降，向下沉降按惯例记为负值）。 */
export type SettlementReading = {
  id: number
  pointId: string
  /** 监测日期：存量补录用历史日期。 */
  date: string
  /** 累计沉降（mm）。 */
  cumulativeMm: number
  /** 沉降速率（mm/d）。 */
  rateMmPerDay: number
  /** 提交单位：跨单位补录当场拦下，必须等于测点归属单位。 */
  unitId: string
  operator: string
  createdAt: string
}

/** 一次阈值调整留痕。历史报警按当时快照留档，不改旧记录。 */
export type ThresholdEvent = {
  id: number
  pointId: string
  oldThresholdMm: number
  newThresholdMm: number
  reason: string
  unitId: string
  operator: string
  at: string
}

/** 一次归属划转留痕；划走后测点归属立即变成新单位，原单位不再有权限。 */
export type TransferEvent = {
  id: number
  pointId: string
  fromUnitId: string
  toUnitId: string
  reason: string
  operator: string
  at: string
}

/**
 * 报警记录。同一测点同时最多一条在效报警：重复发布只认最早那次，不多出一条。
 * 发布时的阈值与超限幅度做快照，历史报警按当时阈值留档；阈值改口径后重算只动在效报警。
 */
export type AlarmRecord = {
  id: number
  pointId: string
  buildingId: string | null
  buildingName: string | null
  /** 发布单位（= 测点当时归属单位）。 */
  unitId: string
  operator: string
  publishedAt: string
  /** 发布当时的阈值快照（mm）。 */
  thresholdAtPublishMm: number
  /** 发布当时的累计沉降快照（mm）。 */
  cumulativeAtPublishMm: number
  /** 发布当时的超限幅度（mm，绝对值）。 */
  overshootAtPublishMm: number
  status: '在效' | '阈值重算解除' | '测点解除关闭'
  closedAt: string | null
  closeReason: string | null
}

/** 沉降测点。 */
export type SettlementPoint = {
  id: string
  name: string
  location: string
  /** 初始高程（m，展示用，不参与超限判定）。 */
  initialElevationM: number
  /** 当前预警阈值（mm，绝对值）。只有归属单位能调，每次调整留痕。 */
  thresholdMm: number
  /** 归属单位 id。 */
  ownerUnitId: string
  /** 关联建筑对象；null 表示尚未布点到建筑物。 */
  buildingId: string | null
  /** 已解除的测点整段只读：任何单位（含归属单位）都不能再改。 */
  released: boolean
  releasedAt: string | null
  monitorDate: string
  /** 兼容老数据：没有读数的存量测点，把累计沉降直接挂在这里兜底。 */
  legacyCumulativeMm?: number
  legacyRateMmPerDay?: number
  legacy: boolean
}

/** 建筑监测对象。归属/权限沿用其关联测点（未布点的对象只能看）。 */
export type MonitorBuilding = {
  id: string
  name: string
  structureType: string
  distanceToTunnelM: number
  /** 允许沉降（mm，展示用；超限判定一律以地表沉降测点侧为准）。 */
  allowableSettlementMm: number
  frequency: string
}

/** 测点的派生状态：不在存储里持久化，每次按最新读数 + 当前阈值现算。 */
export type PointStatus = '正常' | '预警' | '报警' | '已解除'

/** 领域整体状态，原子落盘。 */
export type MonitorState = {
  version: number
  points: SettlementPoint[]
  buildings: MonitorBuilding[]
  readings: SettlementReading[]
  thresholdEvents: ThresholdEvent[]
  transferEvents: TransferEvent[]
  alarms: AlarmRecord[]
  seq: number
  /** 是否已完成一次老数据（泛型表）补录。 */
  migratedFromLegacy: boolean
}

/** 统一失败结构：权限/重复提交等业务拒绝都走这里，当场返回给页面。 */
export class MonitorError extends Error {
  code:
    | 'UNAUTHORIZED_UNIT'
    | 'CROSS_UNIT_SUBMIT'
    | 'READONLY_RELEASED'
    | 'NOT_FOUND'
    | 'DUP_SUBMISSION'
    | 'NOT_EXCEEDED'
    | 'INVALID_INPUT'
    | 'STORAGE_UNAVAILABLE'

  constructor(code: MonitorError['code'], message: string) {
    super(message)
    this.name = 'MonitorError'
    this.code = code
  }
}
