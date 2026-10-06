<template>
  <section class="ledger">
    <header class="ledger-head">
      <h3>建筑监测报警清单</h3>
      <span class="ledger-count">
        在效报警测点 <strong>{{ activeCount }}</strong> 个 · 共 {{ alarms.length }} 条记录（含历史留档）
      </span>
    </header>
    <table class="data-table">
      <thead>
        <tr>
          <th>报警编号</th>
          <th>测点编号</th>
          <th>所属单位</th>
          <th>建筑物</th>
          <th>发布时间</th>
          <th>发布时阈值(mm)</th>
          <th>发布时累计沉降(mm)</th>
          <th>超限幅度(mm)</th>
          <th>结论状态</th>
          <th>关闭说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="alarm in alarms" :key="alarm.id" :class="{ 'row-alarm': alarm.status === '在效' }">
          <td>#{{ alarm.id }}</td>
          <td>{{ alarm.pointId }}</td>
          <td>{{ unitName(alarm.unitId) }}</td>
          <td>{{ alarm.buildingName ?? '未关联建筑物' }}</td>
          <td>{{ formatTime(alarm.publishedAt) }}</td>
          <td>{{ alarm.thresholdAtPublishMm }}</td>
          <td>{{ alarm.cumulativeAtPublishMm }}</td>
          <!-- 超限幅度一律以地表沉降测点侧发布时快照为准 -->
          <td>{{ alarm.overshootAtPublishMm.toFixed(1) }}</td>
          <td>
            <span class="badge" :class="badgeClass(alarm.status)">{{ alarm.status }}</span>
          </td>
          <td>{{ alarm.closeReason ?? '—' }}</td>
        </tr>
        <tr v-if="!alarms.length">
          <td colspan="10" class="empty-state">暂无报警记录</td>
        </tr>
      </tbody>
    </table>
    <p class="ledger-note">
      报警结论只在这一份清单里维护，地表沉降页与本页读同一数据源；阈值改口径后在效报警自动重算，历史报警按发布当时阈值留档。
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { unitName } from '@/data/monitor/service'
import type { AlarmRecord } from '@/data/monitor/types'

const props = defineProps<{ alarms: AlarmRecord[]; activeCount: number }>()
const alarms = computed(() => props.alarms)

function formatTime(iso: string): string {
  return iso.replace('T', ' ').replace(/\+.+$/, '').slice(0, 16)
}

function badgeClass(status: AlarmRecord['status']): string {
  if (status === '在效') return 'badge-danger'
  if (status === '阈值重算解除') return 'badge-warn'
  return 'badge-muted'
}
</script>
