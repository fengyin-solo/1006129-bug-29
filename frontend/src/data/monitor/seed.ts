import type {
  AlarmRecord,
  MonitorBuilding,
  MonitorState,
  MonitorUnit,
  SettlementPoint,
  SettlementReading,
  ThresholdEvent,
  TransferEvent,
} from './types'

/**
 * 监测单位。账号切换演示越权：
 *  - 中铁沉降监测队 / 华岩第三方监测所：测点归属单位，可改本单位测点；
 *  - 监理复核组：不归属任何测点，任何写操作都应被当场拒绝（只能查看）。
 */
export const MONITOR_UNITS: MonitorUnit[] = [
  { id: 'unit-cr', name: '中铁沉降监测队', operator: '王沉降' },
  { id: 'unit-hy', name: '华岩第三方监测所', operator: '李监测' },
  { id: 'unit-jl', name: '监理复核组', operator: '赵监理' },
]

export function unitName(unitId: string): string {
  return MONITOR_UNITS.find((unit) => unit.id === unitId)?.name ?? unitId
}

const READINGS: SettlementReading[] = [
  // SETT-0101 正常
  { id: 1, pointId: 'SETT-0101', date: '2026-09-28', cumulativeMm: -3.2, rateMmPerDay: -0.4, unitId: 'unit-cr', operator: '王沉降', createdAt: '2026-09-28T18:00:00+08:00' },
  { id: 2, pointId: 'SETT-0101', date: '2026-10-01', cumulativeMm: -4.6, rateMmPerDay: -0.5, unitId: 'unit-cr', operator: '王沉降', createdAt: '2026-10-01T18:00:00+08:00' },
  { id: 3, pointId: 'SETT-0101', date: '2026-10-04', cumulativeMm: -5.8, rateMmPerDay: -0.4, unitId: 'unit-cr', operator: '王沉降', createdAt: '2026-10-04T18:00:00+08:00' },
  // SETT-0102 预警
  { id: 4, pointId: 'SETT-0102', date: '2026-09-29', cumulativeMm: -12.9, rateMmPerDay: -1.6, unitId: 'unit-cr', operator: '王沉降', createdAt: '2026-09-29T18:00:00+08:00' },
  { id: 5, pointId: 'SETT-0102', date: '2026-10-05', cumulativeMm: -16.8, rateMmPerDay: -1.5, unitId: 'unit-cr', operator: '王沉降', createdAt: '2026-10-05T18:00:00+08:00' },
  // SETT-0103 报警
  { id: 6, pointId: 'SETT-0103', date: '2026-09-30', cumulativeMm: -24.1, rateMmPerDay: -2.4, unitId: 'unit-hy', operator: '李监测', createdAt: '2026-09-30T18:00:00+08:00' },
  { id: 7, pointId: 'SETT-0103', date: '2026-10-05', cumulativeMm: -31.6, rateMmPerDay: -2.6, unitId: 'unit-hy', operator: '李监测', createdAt: '2026-10-05T18:00:00+08:00' },
  // SETT-0104 从华岩划给中铁（归属已变，阈值权限跟着走）
  { id: 8, pointId: 'SETT-0104', date: '2026-09-27', cumulativeMm: -8.4, rateMmPerDay: -0.9, unitId: 'unit-hy', operator: '李监测', createdAt: '2026-09-27T18:00:00+08:00' },
  { id: 9, pointId: 'SETT-0104', date: '2026-10-05', cumulativeMm: -14.2, rateMmPerDay: -1.4, unitId: 'unit-cr', operator: '王沉降', createdAt: '2026-10-05T18:00:00+08:00' },
  // SETT-0105 阈值被改松又回调，在效报警按新阈值重算后仍超
  { id: 10, pointId: 'SETT-0105', date: '2026-09-26', cumulativeMm: -33.0, rateMmPerDay: -3.0, unitId: 'unit-hy', operator: '李监测', createdAt: '2026-09-26T18:00:00+08:00' },
  { id: 11, pointId: 'SETT-0105', date: '2026-10-05', cumulativeMm: -35.4, rateMmPerDay: -2.8, unitId: 'unit-hy', operator: '李监测', createdAt: '2026-10-05T18:00:00+08:00' },
  // SETT-0106 阈值改松后重算解除
  { id: 12, pointId: 'SETT-0106', date: '2026-09-30', cumulativeMm: -33.2, rateMmPerDay: -2.2, unitId: 'unit-hy', operator: '李监测', createdAt: '2026-09-30T18:00:00+08:00' },
  { id: 13, pointId: 'SETT-0106', date: '2026-10-05', cumulativeMm: -33.5, rateMmPerDay: -0.3, unitId: 'unit-hy', operator: '李监测', createdAt: '2026-10-05T18:00:00+08:00' },
  // SETT-0107 已解除（整段只读）
  { id: 14, pointId: 'SETT-0107', date: '2026-09-20', cumulativeMm: -40.8, rateMmPerDay: -3.1, unitId: 'unit-cr', operator: '王沉降', createdAt: '2026-09-20T18:00:00+08:00' },
  { id: 15, pointId: 'SETT-0107', date: '2026-09-26', cumulativeMm: -41.0, rateMmPerDay: 0, unitId: 'unit-cr', operator: '王沉降', createdAt: '2026-09-26T18:00:00+08:00' },
  // SETT-0108 未布点到建筑物
  { id: 16, pointId: 'SETT-0108', date: '2026-10-04', cumulativeMm: -6.1, rateMmPerDay: -0.7, unitId: 'unit-cr', operator: '王沉降', createdAt: '2026-10-04T18:00:00+08:00' },
]

const POINTS: SettlementPoint[] = [
  {
    id: 'SETT-0101', name: '地表沉降点 D1-01', location: '左线 K12+310 地表',
    initialElevationM: 28.42, thresholdMm: 20, ownerUnitId: 'unit-cr', buildingId: 'BUIL-01',
    released: false, releasedAt: null, monitorDate: '2026-09-28', legacy: false,
  },
  {
    id: 'SETT-0102', name: '地表沉降点 D1-02', location: '左线 K12+340 地表',
    initialElevationM: 28.37, thresholdMm: 20, ownerUnitId: 'unit-cr', buildingId: 'BUIL-02',
    released: false, releasedAt: null, monitorDate: '2026-09-29', legacy: false,
  },
  {
    id: 'SETT-0103', name: '地表沉降点 D1-03', location: '华岩小区 3 号楼北侧',
    initialElevationM: 29.05, thresholdMm: 30, ownerUnitId: 'unit-hy', buildingId: 'BUIL-03',
    released: false, releasedAt: null, monitorDate: '2026-09-30', legacy: false,
  },
  {
    // 原归属华岩，已划转给中铁；划转后原单位无权再动
    id: 'SETT-0104', name: '地表沉降点 D1-04', location: '华岩小区 3 号楼南侧',
    initialElevationM: 29.01, thresholdMm: 20, ownerUnitId: 'unit-cr', buildingId: 'BUIL-03',
    released: false, releasedAt: null, monitorDate: '2026-09-27', legacy: false,
  },
  {
    // 阈值曾被越权改松（40），已按审批回调到 30；阈值全程留痕，在效报警按新阈值重算
    id: 'SETT-0105', name: '地表沉降点 D2-01', location: '滨河路 K12+520 地表',
    initialElevationM: 27.88, thresholdMm: 30, ownerUnitId: 'unit-hy', buildingId: 'BUIL-04',
    released: false, releasedAt: null, monitorDate: '2026-09-26', legacy: false,
  },
  {
    // 报警后阈值口径改严，重算不再超限，在效报警自动解除（旧报警留档）
    id: 'SETT-0106', name: '地表沉降点 D2-02', location: '滨河路 K12+550 地表',
    initialElevationM: 27.8, thresholdMm: 35, ownerUnitId: 'unit-hy', buildingId: 'BUIL-05',
    released: false, releasedAt: null, monitorDate: '2026-09-30', legacy: false,
  },
  {
    // 已解除测点：整段只读
    id: 'SETT-0107', name: '地表沉降点 D0-09', location: '始发井端头地表',
    initialElevationM: 30.12, thresholdMm: 30, ownerUnitId: 'unit-cr', buildingId: 'BUIL-06',
    released: true, releasedAt: '2026-09-28T10:00:00+08:00', monitorDate: '2026-09-26', legacy: false,
  },
  {
    // 尚未布点到建筑物：建筑页可做「布设测点」
    id: 'SETT-0108', name: '地表沉降点 D3-01', location: '右线 K12+705 地表',
    initialElevationM: 28.6, thresholdMm: 20, ownerUnitId: 'unit-cr', buildingId: null,
    released: false, releasedAt: null, monitorDate: '2026-10-04', legacy: false,
  },
]

const BUILDINGS: MonitorBuilding[] = [
  { id: 'BUIL-01', name: '江洲花园 1 号楼', structureType: '框架剪力墙', distanceToTunnelM: 14.2, allowableSettlementMm: 20, frequency: '1 次/日' },
  { id: 'BUIL-02', name: '江洲花园 2 号楼', structureType: '框架剪力墙', distanceToTunnelM: 12.8, allowableSettlementMm: 20, frequency: '1 次/日' },
  { id: 'BUIL-03', name: '华岩小区 3 号楼', structureType: '砖混', distanceToTunnelM: 8.6, allowableSettlementMm: 30, frequency: '2 次/日' },
  { id: 'BUIL-04', name: '滨河路商铺', structureType: '框架', distanceToTunnelM: 10.4, allowableSettlementMm: 30, frequency: '1 次/日' },
  { id: 'BUIL-05', name: '滨河路配电房', structureType: '框架', distanceToTunnelM: 11.0, allowableSettlementMm: 35, frequency: '1 次/日' },
  { id: 'BUIL-06', name: '始发井管理用房', structureType: '砖混', distanceToTunnelM: 6.0, allowableSettlementMm: 30, frequency: '已停测' },
]

const THRESHOLD_EVENTS: ThresholdEvent[] = [
  { id: 1, pointId: 'SETT-0105', oldThresholdMm: 30, newThresholdMm: 40, reason: '夜间越权调松（非归属账号操作，已追回）', unitId: 'unit-jl', operator: '赵监理', at: '2026-10-02T22:14:00+08:00' },
  { id: 2, pointId: 'SETT-0105', oldThresholdMm: 40, newThresholdMm: 30, reason: '复核会要求恢复原口径并复核算警', unitId: 'unit-hy', operator: '李监测', at: '2026-10-03T09:20:00+08:00' },
  { id: 3, pointId: 'SETT-0106', oldThresholdMm: 30, newThresholdMm: 35, reason: '设计复核后放宽允许沉降，已发报警重算', unitId: 'unit-hy', operator: '李监测', at: '2026-10-04T15:40:00+08:00' },
]

const TRANSFER_EVENTS: TransferEvent[] = [
  { id: 1, pointId: 'SETT-0104', fromUnitId: 'unit-hy', toUnitId: 'unit-cr', reason: '左线区段统一交由中铁监测队负责', operator: '平台管理员', at: '2026-10-01T09:00:00+08:00' },
]

const ALARMS: AlarmRecord[] = [
  // SETT-0103：在效报警
  {
    id: 1, pointId: 'SETT-0103', buildingId: 'BUIL-03', buildingName: '华岩小区 3 号楼',
    unitId: 'unit-hy', operator: '李监测', publishedAt: '2026-10-02T08:30:00+08:00',
    thresholdAtPublishMm: 30, cumulativeAtPublishMm: -31.0, overshootAtPublishMm: 1.0,
    status: '在效', closedAt: null, closeReason: null,
  },
  // SETT-0105：越权改松期间发布（按当时被改松的 40 本不该报），恢复 30 后按新阈值重算仍超限 → 保留在效，口径快照留档
  {
    id: 2, pointId: 'SETT-0105', buildingId: 'BUIL-04', buildingName: '滨河路商铺',
    unitId: 'unit-hy', operator: '李监测', publishedAt: '2026-09-29T07:50:00+08:00',
    thresholdAtPublishMm: 30, cumulativeAtPublishMm: -33.0, overshootAtPublishMm: 3.0,
    status: '在效', closedAt: null, closeReason: null,
  },
  // SETT-0106：阈值改严（35）后重算不超限 → 在效报警解除；旧报警按当时阈值留档
  {
    id: 3, pointId: 'SETT-0106', buildingId: 'BUIL-05', buildingName: '滨河路配电房',
    unitId: 'unit-hy', operator: '李监测', publishedAt: '2026-10-01T08:10:00+08:00',
    thresholdAtPublishMm: 30, cumulativeAtPublishMm: -33.2, overshootAtPublishMm: 3.2,
    status: '阈值重算解除', closedAt: '2026-10-04T15:40:00+08:00',
    closeReason: '阈值口径由 30mm 调整为 35mm，按新阈值重算不再超限',
  },
  // SETT-0107：测点解除，旧报警关闭留档
  {
    id: 4, pointId: 'SETT-0107', buildingId: 'BUIL-06', buildingName: '始发井管理用房',
    unitId: 'unit-cr', operator: '王沉降', publishedAt: '2026-09-22T08:00:00+08:00',
    thresholdAtPublishMm: 30, cumulativeAtPublishMm: -40.8, overshootAtPublishMm: 10.8,
    status: '测点解除关闭', closedAt: '2026-09-28T10:00:00+08:00',
    closeReason: '区段贯通，测点解除并整段转只读',
  },
]

/** 领域初始状态（首次进入监测页时播种）。 */
export function createSeedMonitorState(): MonitorState {
  return {
    version: 1,
    points: POINTS.map((point) => ({ ...point })),
    buildings: BUILDINGS.map((building) => ({ ...building })),
    readings: READINGS.map((reading) => ({ ...reading })),
    thresholdEvents: THRESHOLD_EVENTS.map((event) => ({ ...event })),
    transferEvents: TRANSFER_EVENTS.map((event) => ({ ...event })),
    alarms: ALARMS.map((alarm) => ({ ...alarm })),
    seq: 1000,
    migratedFromLegacy: false,
  }
}
