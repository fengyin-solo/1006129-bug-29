<template>
  <section class="page" data-module="settlement">
    <header class="page-head">
      <div>
        <h2>地表沉降管理</h2>
        <p class="page-desc">
          测点按监测单位归属，阈值与状态操作仅归属单位可执行；阈值调整全程留痕，报警结论统一进入建筑监测报警清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出沉降测点清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card" :class="item.danger ? 'stat-danger' : ''">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item">当前账号单位：{{ session.unitName }}（{{ session.operator }}）</span>
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload()">
      <label class="filter-item">
        <span>测点检索</span>
        <input v-model="keyword" placeholder="按测点编号 / 位置 / 建筑物检索" />
      </label>
      <label class="filter-item">
        <span>归属单位</span>
        <select v-model="unitFilter">
          <option value="">全部单位</option>
          <option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="message" class="notice" :class="messageKind === 'error' ? 'notice-error' : 'notice-ok'">
      {{ message }}
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>测点编号</th>
          <th>测点名称/位置</th>
          <th>归属单位</th>
          <th>初始高程(m)</th>
          <th>最新累计沉降(mm)</th>
          <th>沉降速率(mm/d)</th>
          <th>预警阈值(mm)</th>
          <th>超限幅度(mm)</th>
          <th>监测日期</th>
          <th>关联建筑物</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredPoints" :key="row.id" :class="{ 'row-released': row.released, 'row-alarm': row.status === '报警' }">
          <td>{{ row.id }}<span v-if="row.legacy" class="tag tag-legacy" title="从老数据按监测日期补录">存量</span></td>
          <td>{{ row.name }}<br /><span class="cell-sub">{{ row.location }}</span></td>
          <td>
            {{ row.ownerName }}
            <span v-if="row.ownerUnitId !== session.unitId" class="tag tag-lock" title="非归属单位，仅可查看">他单位</span>
          </td>
          <td>{{ row.initialElevationM }}</td>
          <td>{{ row.latestCumulativeMm ?? '—' }}</td>
          <td>{{ row.latestRateMmPerDay ?? '—' }}</td>
          <td>{{ row.currentThresholdMm }}</td>
          <td :class="row.overshootMm > 0 ? 'num-danger' : ''">{{ row.overshootMm.toFixed(1) }}</td>
          <td>{{ row.latestDate ?? row.monitorDate }}</td>
          <td>{{ row.buildingName ?? '未布点' }}</td>
          <td><span class="badge" :class="statusBadge(row.status)">{{ row.status }}</span></td>
          <td class="row-actions">
            <template v-if="row.released">
              <span class="readonly-text">已解除 · 只读</span>
            </template>
            <template v-else-if="row.ownerUnitId !== session.unitId">
              <span class="readonly-text" :title="`测点归属${row.ownerName}，当前单位无权改动`">🔒 仅可查看</span>
            </template>
            <template v-else>
              <button class="link" type="button" @click="openReading(row)">提交监测</button>
              <button class="link" type="button" @click="openThreshold(row)">调整阈值</button>
              <button class="link" type="button" @click="publishFromRow(row)" :disabled="row.status !== '预警'" :title="row.status === '预警' ? '当前超限，可发布报警' : '仅当前达到阈值（预警）可发布报警'">发布报警</button>
              <button class="link" type="button" @click="openTransfer(row)">划转归属</button>
              <button class="link danger" type="button" @click="confirmRelease(row)">解除测点</button>
            </template>
          </td>
        </tr>
        <tr v-if="!filteredPoints.length">
          <td colspan="12" class="empty-state">没有符合条件的沉降测点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filteredPoints.length }} 个测点 · 在效报警测点 {{ activeAlarmCount }} 个（与建筑监测页一致）</span>
    </footer>

    <!-- 提交监测读数（支持按历史监测日期补录） -->
    <ModalDialog :open="readingModal.open" title="提交监测读数" @close="closeModal('readingModal')">
      <div v-if="readingModal.row" class="form-grid">
        <p class="modal-hint">测点 {{ readingModal.row.id }} 归属 {{ readingModal.row.ownerName }}，同一监测日期重复提交只保留最早一次。</p>
        <label><span>监测日期</span><input v-model="readingForm.date" type="date" /></label>
        <label><span>累计沉降 (mm，下沉为负)</span><input v-model.number="readingForm.cumulative" type="number" step="0.1" /></label>
        <label><span>沉降速率 (mm/d)</span><input v-model.number="readingForm.rate" type="number" step="0.1" /></label>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="closeModal('readingModal')">取消</button>
        <button class="btn primary" type="button" @click="submitReadingForm">提交（失败自动整条回滚）</button>
      </template>
    </ModalDialog>

    <!-- 调整阈值：必填原因，留痕并自动重算在效报警 -->
    <ModalDialog :open="thresholdModal.open" title="调整预警阈值" @close="closeModal('thresholdModal')">
      <div v-if="thresholdModal.row" class="form-grid">
        <p class="modal-hint">测点 {{ thresholdModal.row.id }} · 当前阈值 {{ thresholdModal.row.currentThresholdMm }}mm。调整会写入留痕，已发布的在效报警照新阈值重算判定。</p>
        <label><span>新预警阈值 (mm)</span><input v-model.number="thresholdForm.value" type="number" min="0" step="1" /></label>
        <label><span>调整原因（必填）</span><textarea v-model="thresholdForm.reason" rows="3" placeholder="例如：设计复核后调整允许沉降口径"></textarea></label>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="closeModal('thresholdModal')">取消</button>
        <button class="btn primary" type="button" @click="submitThresholdForm">确认调整并重算报警</button>
      </template>
    </ModalDialog>

    <!-- 划转归属：划走后原单位立即失权 -->
    <ModalDialog :open="transferModal.open" title="划转测点归属" @close="closeModal('transferModal')">
      <div v-if="transferModal.row" class="form-grid">
        <p class="modal-hint">测点 {{ transferModal.row.id }} 当前归属 {{ transferModal.row.ownerName }}，划走后阈值与报警权限立即移交新单位，原单位只读。</p>
        <label>
          <span>转入单位</span>
          <select v-model="transferForm.toUnitId">
            <option v-for="unit in transferableUnits(transferModal.row.ownerUnitId)" :key="unit.id" :value="unit.id">{{ unit.name }}</option>
          </select>
        </label>
        <label><span>划转原因（必填）</span><textarea v-model="transferForm.reason" rows="3"></textarea></label>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="closeModal('transferModal')">取消</button>
        <button class="btn primary" type="button" @click="submitTransferForm">确认划转</button>
      </template>
    </ModalDialog>

    <!-- 阈值与归属留痕 -->
    <section class="audit">
      <h3>阈值调整与归属划转留痕</h3>
      <table class="data-table">
        <thead>
          <tr><th>时间</th><th>测点</th><th>事项</th><th>原值</th><th>新值</th><th>操作单位/人</th><th>原因</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in auditRows" :key="item.key">
            <td>{{ item.time }}</td>
            <td>{{ item.pointId }}</td>
            <td>{{ item.kind }}</td>
            <td>{{ item.from }}</td>
            <td>{{ item.to }}</td>
            <td>{{ item.actor }}</td>
            <td>{{ item.reason }}</td>
          </tr>
          <tr v-if="!auditRows.length"><td colspan="7" class="empty-state">暂无留痕记录</td></tr>
        </tbody>
      </table>
    </section>

    <!-- 共用：建筑监测报警清单（唯一报警数据源） -->
    <AlarmLedger :alarms="alarms" :active-count="activeAlarmCount" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import AlarmLedger from '@/views/monitor/AlarmLedger.vue'
import ModalDialog from '@/views/monitor/ModalDialog.vue'
import { useMonitor } from '@/views/monitor/useMonitor'
import { MONITOR_UNITS } from '@/data/monitor/seed'
import type { PointView } from '@/data/monitor/service'

const units = MONITOR_UNITS
const {
  session, points, alarms, thresholdEvents, transferEvents, activeAlarmCount,
  message, messageKind, reload, run, actions,
} = useMonitor()

const keyword = ref('')
const unitFilter = ref('')

const filteredPoints = computed(() =>
  points.value.filter((row) => {
    const kw = keyword.value.trim()
    const hitKeyword =
      !kw ||
      row.id.includes(kw) ||
      row.location.includes(kw) ||
      row.name.includes(kw) ||
      (row.buildingName ?? '').includes(kw)
    const hitUnit = !unitFilter.value || row.ownerUnitId === unitFilter.value
    return hitKeyword && hitUnit
  }),
)

const statusSummary = computed(() =>
  (['正常', '预警', '报警', '已解除'] as const).map((status) => ({
    status,
    count: points.value.filter((row) => row.status === status).length,
  })),
)

const stats = computed(() => [
  { label: '测点总数', value: points.value.length, danger: false },
  { label: '正常测点', value: points.value.filter((row) => row.status === '正常').length, danger: false },
  { label: '预警测点', value: points.value.filter((row) => row.status === '预警').length, danger: false },
  { label: '在效报警测点', value: activeAlarmCount.value, danger: true },
  { label: '已解除（只读）', value: points.value.filter((row) => row.released).length, danger: false },
])

const auditRows = computed(() => {
  const threshold = thresholdEvents.value.map((event) => ({
    key: `t-${event.id}`,
    time: event.at.replace('T', ' ').replace(/\+.+$/, '').slice(0, 16),
    pointId: event.pointId,
    kind: '阈值调整',
    from: `${event.oldThresholdMm}mm`,
    to: `${event.newThresholdMm}mm`,
    actor: `${unitLabel(event.unitId)} / ${event.operator}`,
    reason: event.reason,
  }))
  const transfers = transferEvents.value.map((event) => ({
    key: `x-${event.id}`,
    time: event.at.replace('T', ' ').replace(/\+.+$/, '').slice(0, 16),
    pointId: event.pointId,
    kind: '归属划转',
    from: unitLabel(event.fromUnitId),
    to: unitLabel(event.toUnitId),
    actor: event.operator,
    reason: event.reason,
  }))
  return [...threshold, ...transfers].sort((a, b) => (a.time < b.time ? 1 : -1))
})

function unitLabel(unitId: string): string {
  return units.find((unit) => unit.id === unitId)?.name ?? unitId
}

function statusBadge(status: PointView['status']): string {
  if (status === '报警') return 'badge-danger'
  if (status === '预警') return 'badge-warn'
  if (status === '已解除') return 'badge-muted'
  return 'badge-ok'
}

function transferableUnits(current: string) {
  return units.filter((unit) => unit.id !== current)
}

function resetFilters() {
  keyword.value = ''
  unitFilter.value = ''
  reload()
}

// ---- 弹窗 ----
type ModalName = 'readingModal' | 'thresholdModal' | 'transferModal'
const readingModal = reactive<{ open: boolean; row: PointView | null }>({ open: false, row: null })
const thresholdModal = reactive<{ open: boolean; row: PointView | null }>({ open: false, row: null })
const transferModal = reactive<{ open: boolean; row: PointView | null }>({ open: false, row: null })
const readingForm = reactive({ date: '', cumulative: 0, rate: 0 })
const thresholdForm = reactive({ value: 0, reason: '' })
const transferForm = reactive({ toUnitId: '', reason: '' })

function defaultDate(row: PointView): string {
  return row.latestDate ?? row.monitorDate
}

function openReading(row: PointView) {
  readingModal.row = row
  readingForm.date = defaultDate(row)
  readingForm.cumulative = row.latestCumulativeMm ?? 0
  readingForm.rate = row.latestRateMmPerDay ?? 0
  readingModal.open = true
}
function openThreshold(row: PointView) {
  thresholdModal.row = row
  thresholdForm.value = row.currentThresholdMm
  thresholdForm.reason = ''
  thresholdModal.open = true
}
function openTransfer(row: PointView) {
  transferModal.row = row
  transferForm.toUnitId = transferableUnits(row.ownerUnitId)[0]?.id ?? ''
  transferForm.reason = ''
  transferModal.open = true
}
function closeModal(name: ModalName) {
  ;({ readingModal, thresholdModal, transferModal }[name]).open = false
}

async function submitReadingForm() {
  const row = readingModal.row
  if (!row) return
  const ok = await run('监测读数已提交', () =>
    actions.submitReading({
      pointId: row.id,
      date: readingForm.date,
      cumulativeMm: Number(readingForm.cumulative),
      rateMmPerDay: Number(readingForm.rate),
    }),
  )
  if (ok) readingModal.open = false
}

async function submitThresholdForm() {
  const row = thresholdModal.row
  if (!row) return
  const ok = await run('阈值已调整', () =>
    actions.adjustThreshold(row.id, Number(thresholdForm.value), thresholdForm.reason),
  )
  if (ok) thresholdModal.open = false
}

async function submitTransferForm() {
  const row = transferModal.row
  if (!row) return
  const ok = await run('测点已划转', () => actions.transferPoint(row.id, transferForm.toUnitId, transferForm.reason))
  if (ok) transferModal.open = false
}

// 发布报警走行内按钮：当前未超限时由服务当场拒绝，超限时直接进报警清单。
function publishFromRow(row: PointView) {
  run('报警已发布', () => actions.publishAlarm(row.id))
}

function confirmRelease(row: PointView) {
  if (window.confirm(`确认解除测点 ${row.id}？解除后整段转只读，任何单位都不能再改动，在效报警将关闭留档。`)) {
    run('测点已解除', () => actions.releasePoint(row.id))
  }
}

function exportRows() {
  const header = ['测点编号', '测点名称', '位置', '归属单位', '初始高程(m)', '最新累计沉降(mm)', '沉降速率(mm/d)', '预警阈值(mm)', '超限幅度(mm)', '监测日期', '关联建筑物', '状态']
  const lines = [header.join(',')]
  for (const row of filteredPoints.value) {
    lines.push([
      row.id, row.name, row.location, row.ownerName, row.initialElevationM,
      row.latestCumulativeMm ?? '', row.latestRateMmPerDay ?? '', row.currentThresholdMm,
      row.overshootMm.toFixed(1), row.latestDate ?? row.monitorDate, row.buildingName ?? '', row.status,
    ].join(','))
  }
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '地表沉降测点清单.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

onMounted(() => reload())
</script>
