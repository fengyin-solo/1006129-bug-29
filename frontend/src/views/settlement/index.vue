<template>
  <section class="page" data-module="settlement">
    <header class="page-head">
      <div>
        <h2>地表沉降管理</h2>
        <p class="page-desc">维护沉降测点，围绕测点编号、测点位置、归属单位、初始高程、累计沉降做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记沉降测点</button>
        <button class="btn" type="button" @click="exportRows">导出地表沉降清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <span v-if="isReleased(row)" class="tag readonly">已解除·只读</span>
            <span v-else-if="!isOwn(row)" class="tag denied">归属{{ row['归属单位'] }}·越权不可改</span>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无地表沉降数据，可先登记沉降测点</td>
        </tr>
      </tbody>
    </table>

    <section class="section-block">
      <h3>报警记录（与建筑监测报警清单同源，共 {{ alarms.length }} 条，有效 {{ activeAlarmCount }} 条）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in alarmColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="alarm in alarms" :key="String(alarm.id)">
            <td v-for="column in alarmColumns" :key="column">{{ alarm[column] === '' ? '—' : (alarm[column] ?? '—') }}</td>
          </tr>
          <tr v-if="!alarms.length">
            <td :colspan="alarmColumns.length" class="empty-state">暂无报警记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="section-block">
      <h3>阈值调整留痕（共 {{ thresholdLogs.length }} 条）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in thresholdLogColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in thresholdLogs" :key="String(log.id)">
            <td v-for="column in thresholdLogColumns" :key="column">{{ log[column] ?? '—' }}</td>
          </tr>
          <tr v-if="!thresholdLogs.length">
            <td :colspan="thresholdLogColumns.length" class="empty-state">暂无阈值调整记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="section-block">
      <h3>监测记录（存量按监测日期照旧补录，共 {{ monitoringRecords.length }} 条）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in monitoringColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in monitoringRecords" :key="String(record.id)">
            <td v-for="column in monitoringColumns" :key="column">{{ record[column] === '' ? '—' : (record[column] ?? '—') }}</td>
          </tr>
          <tr v-if="!monitoringRecords.length">
            <td :colspan="monitoringColumns.length" class="empty-state">暂无监测记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条地表沉降记录</span>
      <span v-if="okMessage" class="success-text">{{ okMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  adjustThreshold,
  confirmStable,
  downloadEntries,
  listEntries,
  listMonitoringRecords,
  listSettlementAlarms,
  listThresholdLog,
  moduleMeta,
  publishAlarm,
  submitMonitoring,
  transferPoint,
} from '@/api/local-service'
import type { ActionResult, EntryRow } from '@/data/types'
import { MONITORING_UNITS } from '@/data/units'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('settlement')
const columns = ["测点编号", "测点位置", "归属单位", "初始高程", "累计沉降", "沉降速率", "预警阈值", "监测日期", "测点状态"]
const actions = ["提交监测", "发布预警", "确认稳定", "调整阈值", "划转移交"]
const statuses = ["正常", "预警", "报警", "已稳定"]
const alarmColumns = ["测点编号", "归属单位", "累计沉降", "发布时阈值", "判定阈值", "超限幅度", "结论", "状态", "首次发布时间", "最近重算时间"]
const thresholdLogColumns = ["测点编号", "归属单位", "旧阈值", "新阈值", "操作人", "操作单位", "调整时间"]
const monitoringColumns = ["测点编号", "归属单位", "监测日期", "累计沉降", "沉降速率", "提交人", "提交单位", "提交时间"]

const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const alarms = ref<EntryRow[]>([])
const thresholdLogs = ref<EntryRow[]>([])
const monitoringRecords = ref<EntryRow[]>([])
const total = ref(0)
const okMessage = ref('')
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const activeAlarmCount = computed(
  () => alarms.value.filter((alarm) => String(alarm['状态']) === '有效').length,
)
const stats = computed(() => [
  { label: '正常测点', value: rows.value.filter((row) => String(row.status) === '正常').length },
  { label: '预警测点', value: rows.value.filter((row) => String(row.status) === '预警').length },
  { label: '报警测点', value: activeAlarmCount.value },
  {
    label: '最大累计沉降',
    value: rows.value.reduce((max, row) => {
      const value = Number(row['累计沉降'])
      return Number.isFinite(value) ? Math.max(max, value) : max
    }, 0),
  },
])

function isReleased(row: EntryRow): boolean {
  return String(row.status) === '已稳定'
}

function isOwn(row: EntryRow): boolean {
  return String(row['归属单位'] ?? '') === session.unit
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '沉降测点登记入口尚未接入审批流'
}

function showResult(result: ActionResult) {
  if (result.ok) {
    okMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  okMessage.value = ''
  errorMessage.value = ''
  const id = Number(row.id)
  if (action === '提交监测') {
    const total = window.prompt('本次累计沉降（mm）', String(row['累计沉降'] ?? ''))
    if (total === null) return
    const rate = window.prompt('本次沉降速率（mm/d），可留空', String(row['沉降速率'] ?? ''))
    if (rate === null) return
    const date = window.prompt('监测日期（YYYY-MM-DD）', String(row['监测日期'] ?? ''))
    if (date === null) return
    showResult(submitMonitoring(id, { 累计沉降: total, 沉降速率: rate, 监测日期: date }))
    return
  }
  if (action === '调整阈值') {
    const input = window.prompt('新的预警阈值（mm）', String(row['预警阈值'] ?? ''))
    if (input === null) return
    showResult(adjustThreshold(id, Number(input)))
    return
  }
  if (action === '划转移交') {
    const input = window.prompt(`划转移交至（${MONITORING_UNITS.join(' / ')}）`, '')
    if (input === null) return
    showResult(transferPoint(id, input))
    return
  }
  if (action === '发布预警') {
    showResult(publishAlarm(id))
    return
  }
  if (action === '确认稳定') {
    showResult(confirmStable(id))
  }
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    alarms.value = listSettlementAlarms()
    thresholdLogs.value = listThresholdLog()
    monitoringRecords.value = listMonitoringRecords()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地表沉降列表读取失败'
  }
}

onMounted(reload)
</script>
