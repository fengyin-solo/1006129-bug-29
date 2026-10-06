<template>
  <section class="page" data-module="building">
    <header class="page-head">
      <div>
        <h2>建筑监测管理</h2>
        <p class="page-desc">
          监测对象的报警结论以关联的地表沉降测点为准（超限幅度取测点侧）；本页与地表沉降页共用同一套归属权限、同一份报警清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出建筑监测清单</button>
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

    <div v-if="message" class="notice" :class="messageKind === 'error' ? 'notice-error' : 'notice-ok'">
      {{ message }}
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>对象编号</th>
          <th>建筑物名称</th>
          <th>结构类型</th>
          <th>距隧道(m)</th>
          <th>允许沉降(mm)</th>
          <th>关联测点</th>
          <th>测点归属</th>
          <th>实测沉降(mm)</th>
          <th>超限幅度(mm)</th>
          <th>监测频次</th>
          <th>状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in buildings" :key="row.id" :class="{ 'row-released': row.status === '已解除', 'row-alarm': row.status === '报警' }">
          <td>{{ row.id }}</td>
          <td>{{ row.name }}</td>
          <td>{{ row.structureType }}</td>
          <td>{{ row.distanceToTunnelM }}</td>
          <td>{{ row.allowableSettlementMm }}</td>
          <td>{{ row.pointId ?? '待布点' }}</td>
          <td>
            <template v-if="row.ownerName">
              {{ row.ownerName }}
              <span v-if="row.ownerUnitId !== session.unitId" class="tag tag-lock">他单位</span>
            </template>
            <span v-else class="cell-sub">尚未布设测点</span>
          </td>
          <td>{{ row.measuredMm ?? '—' }}</td>
          <!-- 超限幅度以地表沉降测点侧为准，建筑允许沉降仅作展示 -->
          <td :class="row.overshootMm > 0 ? 'num-danger' : ''">{{ row.overshootMm.toFixed(1) }}</td>
          <td>{{ row.frequency }}</td>
          <td><span class="badge" :class="statusBadge(row.status)">{{ row.status }}</span></td>
          <td class="row-actions">
            <template v-if="!row.pointId">
              <button class="link" type="button" @click="openDeploy(row)">布设测点</button>
            </template>
            <template v-else-if="row.status === '已解除'">
              <span class="readonly-text">测点已解除 · 只读</span>
            </template>
            <template v-else-if="row.ownerUnitId !== session.unitId">
              <span class="readonly-text" :title="`关联测点归属${row.ownerName}，当前单位无权改动`">🔒 仅可查看</span>
            </template>
            <template v-else>
              <button class="link" type="button" @click="publishFromBuilding(row)" :disabled="row.status !== '预警'" :title="row.status === '预警' ? '关联测点当前超限，可发布报警' : '仅关联测点达到阈值（预警）可发布报警'">发布报警</button>
              <button v-if="row.status === '报警'" class="link danger" type="button" @click="confirmRelease(row)">解除报警</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ buildings.length }} 个监测对象 · 在效报警测点 {{ activeAlarmCount }} 个（与地表沉降页一致）</span>
      <span class="cell-sub">超限判定一律以地表沉降测点侧阈值为准，兼容老测点记录</span>
    </footer>

    <!-- 布设测点：从未布点的本单位测点中选一个，越权/跨单位由 service 当场拦下 -->
    <ModalDialog :open="deployModal.open" title="布设测点到监测对象" @close="deployModal.open = false">
      <div v-if="deployModal.row" class="form-grid">
        <p class="modal-hint">把一个尚未布点、且归属当前单位的测点关联到「{{ deployModal.row.name }}」。</p>
        <label>
          <span>选择测点</span>
          <select v-model="deployForm.pointId">
            <option value="" disabled>请选择测点</option>
            <option v-for="point in deployablePoints" :key="point.id" :value="point.id">
              {{ point.id }} · {{ point.name }}（{{ point.ownerName }}）
            </option>
          </select>
        </label>
        <p v-if="!deployablePoints.length" class="modal-hint error-text">
          当前没有「归属本单位且尚未布点」的测点，可先到地表沉降页划转归属。
        </p>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="deployModal.open = false">取消</button>
        <button class="btn primary" type="button" :disabled="!deployForm.pointId" @click="submitDeploy">确认布设</button>
      </template>
    </ModalDialog>

    <!-- 报警结论落地清单（与地表沉降页是同一份数据） -->
    <AlarmLedger :alarms="alarms" :active-count="activeAlarmCount" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'

import AlarmLedger from '@/views/monitor/AlarmLedger.vue'
import ModalDialog from '@/views/monitor/ModalDialog.vue'
import { useMonitor } from '@/views/monitor/useMonitor'
import type { BuildingView } from '@/data/monitor/service'

const {
  session, points, buildings, alarms, activeAlarmCount,
  message, messageKind, reload, run, actions,
} = useMonitor()

const statusSummary = computed(() =>
  (['待布点', '正常', '预警', '报警', '已解除'] as const).map((status) => ({
    status,
    count: buildings.value.filter((row) => row.status === status).length,
  })),
)

const stats = computed(() => [
  { label: '监测对象', value: buildings.value.length, danger: false },
  { label: '监测中', value: buildings.value.filter((row) => row.status === '正常' || row.status === '预警').length, danger: false },
  { label: '在效报警测点', value: activeAlarmCount.value, danger: true },
  { label: '已解除', value: buildings.value.filter((row) => row.status === '已解除').length, danger: false },
])

function statusBadge(status: BuildingView['status']): string {
  if (status === '报警') return 'badge-danger'
  if (status === '预警') return 'badge-warn'
  if (status === '已解除') return 'badge-muted'
  if (status === '待布点') return 'badge-muted'
  return 'badge-ok'
}

const deployModal = reactive<{ open: boolean; row: BuildingView | null }>({ open: false, row: null })
const deployForm = reactive({ pointId: '' })

const deployablePoints = computed(() =>
  points.value.filter((point) => !point.buildingId && !point.released && point.ownerUnitId === session.unitId),
)

function openDeploy(row: BuildingView) {
  deployModal.row = row
  deployForm.pointId = deployablePoints.value[0]?.id ?? ''
  deployModal.open = true
}

async function submitDeploy() {
  const row = deployModal.row
  if (!row || !deployForm.pointId) return
  const ok = await run('测点已布设', () => actions.deployPoint(row.id, deployForm.pointId))
  if (ok) deployModal.open = false
}

function publishFromBuilding(row: BuildingView) {
  if (!row.pointId) return
  run('报警已发布', () => actions.publishAlarm(row.pointId as string))
}

function confirmRelease(row: BuildingView) {
  if (!row.pointId) return
  if (window.confirm(`确认解除测点 ${row.pointId}？解除后测点整段转只读，任何单位都不能再改动。`)) {
    run('测点已解除', () => actions.releasePoint(row.pointId as string))
  }
}

function exportRows() {
  const header = ['对象编号', '建筑物名称', '结构类型', '距隧道(m)', '允许沉降(mm)', '关联测点', '测点归属', '实测沉降(mm)', '超限幅度(mm)', '状态']
  const lines = [header.join(',')]
  for (const row of buildings.value) {
    lines.push([
      row.id, row.name, row.structureType, row.distanceToTunnelM, row.allowableSettlementMm,
      row.pointId ?? '', row.ownerName ?? '', row.measuredMm ?? '', row.overshootMm.toFixed(1), row.status,
    ].join(','))
  }
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '建筑监测对象清单.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

onMounted(() => reload())
</script>
