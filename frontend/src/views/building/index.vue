<template>
  <section class="page" data-module="building">
    <header class="page-head">
      <div>
        <h2>建筑监测管理</h2>
        <p class="page-desc">维护监测对象，围绕对象编号、建筑物名称、结构类型、距隧道距离做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记监测对象</button>
        <button class="btn" type="button" @click="exportRows">导出建筑监测清单</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无建筑监测数据，可先登记监测对象</td>
        </tr>
      </tbody>
    </table>

    <section class="section-block">
      <h3>报警清单（有效报警测点 {{ activeAlarms.length }} 个）</h3>
      <p class="section-note">
        报警结论来自地表沉降测点，两侧只存一份、同步重算；超限幅度以地表沉降测点实测（累计沉降 − 判定阈值）为准。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in alarmColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="alarm in activeAlarms" :key="String(alarm.id)">
            <td v-for="column in alarmColumns" :key="column">{{ alarm[column] === '' ? '—' : (alarm[column] ?? '—') }}</td>
          </tr>
          <tr v-if="!activeAlarms.length">
            <td :colspan="alarmColumns.length" class="empty-state">暂无有效报警测点</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条建筑监测记录</span>
      <span v-if="okMessage" class="success-text">{{ okMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listActiveAlarms,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('building')
const columns = ["对象编号", "建筑物名称", "结构类型", "距隧道距离", "允许沉降", "实测沉降", "监测频次", "监测状态"]
const actions = ["布设测点", "发布报警", "解除报警"]
const statuses = ["待布点", "监测中", "已报警", "已解除"]
const alarmColumns = ["测点编号", "归属单位", "累计沉降", "判定阈值", "超限幅度", "结论", "首次发布时间"]

const rows = ref<EntryRow[]>([])
const activeAlarms = ref<EntryRow[]>([])
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
const stats = computed(() => [
  { label: '监测中对象', value: rows.value.filter((row) => String(row.status) === '监测中').length },
  { label: '报警测点', value: activeAlarms.value.length },
  { label: '待布点对象', value: rows.value.filter((row) => String(row.status) === '待布点').length },
])

function isReleased(row: EntryRow): boolean {
  return String(row.status) === '已解除'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '监测对象登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  okMessage.value = ''
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (result.ok) {
    okMessage.value = result.message
  } else {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    activeAlarms.value = listActiveAlarms()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '建筑监测列表读取失败'
  }
}

onMounted(reload)
</script>
