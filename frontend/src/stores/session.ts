import { defineStore } from 'pinia'

import { DEFAULT_UNIT, MONITORING_UNITS } from '@/data/units'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
    // 当前登录账号所属的监测单位：测点归属与阈值权限都按它判定。
    unit: DEFAULT_UNIT,
    units: [...MONITORING_UNITS],
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setUnit(unit: string) {
      if (this.units.includes(unit)) {
        this.unit = unit
      }
    },
  },
})
