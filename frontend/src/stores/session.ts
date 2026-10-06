import { defineStore } from 'pinia'

import { MONITOR_UNITS } from '@/data/monitor/seed'

// 默认以中铁沉降监测队身份进入；顶栏可切换单位演示越权拦截。
const DEFAULT_UNIT = MONITOR_UNITS[0]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: DEFAULT_UNIT.operator,
    unitId: DEFAULT_UNIT.id,
    unitName: DEFAULT_UNIT.name,
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    /** 切换当前登录的监测单位账号（操作人随单位一起切换）。 */
    switchUnit(unitId: string) {
      const unit = MONITOR_UNITS.find((item) => item.id === unitId)
      if (!unit) return
      this.unitId = unit.id
      this.unitName = unit.name
      this.operator = unit.operator
    },
  },
})
