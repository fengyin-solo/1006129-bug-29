import { computed, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import {
  activeAlarmPointCount,
  adjustThreshold,
  deployPoint,
  errorMessageOf,
  listAlarms,
  listBuildings,
  listPoints,
  listThresholdEvents,
  listTransferEvents,
  publishAlarm,
  releasePoint,
  submitReading,
  transferPoint,
} from '@/data/monitor/service'
import { loadMonitorState } from '@/data/monitor/store'

/**
 * 地表沉降页与建筑监测页共用的数据/动作入口：
 * 所有写操作都带上当前登录单位，权限在 service 层统一当场校验，页面不做第二套判断。
 */
export function useMonitor() {
  const session = useSessionStore()
  const actor = computed(() => ({ unitId: session.unitId }))

  const points = ref(listPoints())
  const buildings = ref(listBuildings())
  const alarms = ref(listAlarms())
  const thresholdEvents = ref(listThresholdEvents())
  const transferEvents = ref(listTransferEvents())
  // 两侧页面读到的在效报警测点数必须对得上：都取这一个值。
  const activeAlarmCount = ref(activeAlarmPointCount())
  const message = ref('')
  const messageKind = ref<'ok' | 'error'>('ok')

  /** 重新进页面核对：任何动作后都从存储重读，不拿页面缓存兜底。 */
  function reload(notice = '') {
    // 以存储实际内容为准，防止中途断掉显示老数据。
    loadMonitorState()
    points.value = listPoints()
    buildings.value = listBuildings()
    alarms.value = listAlarms()
    thresholdEvents.value = listThresholdEvents()
    transferEvents.value = listTransferEvents()
    activeAlarmCount.value = activeAlarmPointCount()
    if (notice) {
      message.value = notice
      messageKind.value = 'ok'
    }
  }

  function fail(error: unknown) {
    message.value = errorMessageOf(error)
    messageKind.value = 'error'
  }

  /** 包一层：service 抛错时当场提示并回滚视图（重读存储），不保留半截改动。成功返回 true。 */
  async function run(label: string, task: () => void | string): Promise<boolean> {
    try {
      const note = task()
      reload(note || label)
      return true
    } catch (error) {
      fail(error)
      // 写失败整条抽回：重读存储，页面回到落盘的真实状态。
      points.value = listPoints()
      buildings.value = listBuildings()
      alarms.value = listAlarms()
      return false
    }
  }

  return {
    session,
    actor,
    points,
    buildings,
    alarms,
    thresholdEvents,
    transferEvents,
    activeAlarmCount,
    message,
    messageKind,
    reload,
    actions: {
      submitReading(input: Parameters<typeof submitReading>[0]) {
        const result = submitReading(input, actor.value)
        return result.duplicated
          ? `测点 ${input.pointId} ${input.date} 的监测记录已存在，仍按最早那次，不重复登记`
          : `测点 ${input.pointId} 监测读数已提交`
      },
      publishAlarm(pointId: string) {
        const record = publishAlarm(pointId, actor.value)
        return `报警已发布（编号 #${record.id}），已进入建筑监测报警清单`
      },
      adjustThreshold(pointId: string, thresholdMm: number, reason: string) {
        const result = adjustThreshold(pointId, thresholdMm, reason, actor.value)
        const closed = result.recalculated.filter((item) => !item.nowActive).length
        const kept = result.recalculated.length - closed
        const parts = [`测点 ${pointId} 阈值已调整并留痕，在效报警已按新口径重算`]
        if (kept) parts.push(`${kept} 条仍超限保持在效`)
        if (closed) parts.push(`${closed} 条不再超限已解除（旧报警留档）`)
        return parts.join('，')
      },
      releasePoint(pointId: string) {
        releasePoint(pointId, actor.value)
        return `测点 ${pointId} 已解除，整段转只读，其他单位仅可查看`
      },
      transferPoint(pointId: string, toUnitId: string, reason: string) {
        transferPoint(pointId, toUnitId, reason, actor.value)
        return `测点 ${pointId} 已划转，归属与阈值权限即时移交`
      },
      deployPoint(buildingId: string, pointId: string) {
        deployPoint(buildingId, pointId, actor.value)
        return `测点 ${pointId} 已布点到监测对象`
      },
    },
    run,
  }
}
