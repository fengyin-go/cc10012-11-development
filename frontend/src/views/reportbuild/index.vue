<template>
  <section class="page" data-module="reportbuild">
    <header class="page-head">
      <div>
        <h2>报告构建管理</h2>
        <p class="page-desc">读取图表数据快照与报告模板，按模板渲染正文和附件，生成可交付、可核对的报告数据明细文件。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出明细清单</button>
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

    <h3 class="section-title">报告数据明细文件</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          :class="{ 'row-selected': row['文件编号'] === selectedCode }"
        >
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看</button>
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              :disabled="busy"
              @click="runFileAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            暂无报告数据明细文件，可先在下方报告模板区发起构建
          </td>
        </tr>
      </tbody>
    </table>

    <section v-if="detail.file" class="detail-panel">
      <h3 class="section-title">明细文件详情：{{ detail.file['文件编号'] }}</h3>
      <dl class="detail-grid">
        <div><dt>关联模板</dt><dd>{{ detail.file['关联模板'] }}</dd></div>
        <div><dt>报告周期</dt><dd>{{ detail.file['报告周期'] }}</dd></div>
        <div><dt>报告版本</dt><dd>{{ detail.file['报告版本'] }}</dd></div>
        <div><dt>文件摘要</dt><dd>{{ detail.file['文件摘要'] }}</dd></div>
        <div><dt>水印标记</dt><dd>{{ detail.file['水印标记'] }}</dd></div>
        <div><dt>导出格式</dt><dd>{{ detail.file['导出格式'] }}</dd></div>
      </dl>
      <h4 class="section-subtitle">分页明细（每页记录使用的快照版本，不同版本不拼成同一图表）</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>页码</th>
            <th>图表编号</th>
            <th>图表名称</th>
            <th>快照编号</th>
            <th>快照版本</th>
            <th>来源取舍</th>
            <th>渲染时间</th>
            <th>页状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="page in detail.pages" :key="String(page.id)">
            <td>{{ page['页码'] }}</td>
            <td>{{ page['图表编号'] }}</td>
            <td>{{ page['图表名称'] }}</td>
            <td>{{ page['快照编号'] || '—' }}</td>
            <td>{{ page['快照版本'] || '—' }}</td>
            <td>{{ page['来源取舍'] }}</td>
            <td>{{ page['渲染时间'] || '—' }}</td>
            <td>{{ page.status }}</td>
          </tr>
          <tr v-if="!detail.pages.length">
            <td colspan="8" class="empty-state">该文件还没有分页明细</td>
          </tr>
        </tbody>
      </table>
      <h4 class="section-subtitle">导出清单</h4>
      <pre class="manifest-preview">{{ manifestPreview }}</pre>
      <button class="btn" type="button" @click="downloadManifest">下载导出清单</button>
    </section>

    <h3 class="section-title">报告模板（按模板构建，报告文件通过报告周期核对）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>模板编号</th>
          <th>模板名称</th>
          <th>包含图表</th>
          <th>报告周期</th>
          <th>水印开关</th>
          <th>模板状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="tpl in templates" :key="String(tpl.id)">
          <td>{{ tpl['模板编号'] }}</td>
          <td>{{ tpl['模板名称'] }}</td>
          <td>{{ tpl['包含图表'] }}</td>
          <td>{{ tpl['报告周期'] }}</td>
          <td>{{ tpl['水印开关'] }}</td>
          <td>{{ tpl.status }}</td>
          <td class="row-actions">
            <button
              class="link"
              type="button"
              :disabled="busy"
              @click="startBuild(String(tpl['模板编号']))"
            >
              {{ building === tpl['模板编号'] ? '构建中…' : '构建报告' }}
            </button>
          </td>
        </tr>
        <tr v-if="!templates.length">
          <td colspan="7" class="empty-state">暂无报告模板，请先在报告生成模块登记</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">图表数据快照（旧版与新版并存，均有业务价值，构建时记录来源取舍）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>快照编号</th>
          <th>图表编号</th>
          <th>图表名称</th>
          <th>快照版本</th>
          <th>快照时间</th>
          <th>数据摘要</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="snap in snapshots" :key="String(snap.id)">
          <td>{{ snap['快照编号'] }}</td>
          <td>{{ snap['图表编号'] }}</td>
          <td>{{ snap['图表名称'] }}</td>
          <td>{{ snap['快照版本'] }}</td>
          <td>{{ snap['快照时间'] }}</td>
          <td>{{ snap['数据摘要'] }}</td>
          <td>{{ snap.status }}</td>
          <td class="row-actions">
            <button
              v-if="snap.status === '有效'"
              class="link"
              type="button"
              :disabled="busy"
              @click="retireSnap(snap)"
            >
              废止快照
            </button>
            <button
              v-else
              class="link"
              type="button"
              :disabled="busy"
              @click="restoreSnap(snap)"
            >
              恢复快照
            </button>
          </td>
        </tr>
        <tr v-if="!snapshots.length">
          <td colspan="8" class="empty-state">暂无图表数据快照</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 份报告数据明细文件</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { listEntries, moduleMeta } from '@/api/local-service'
import {
  archiveFile,
  buildReport,
  downloadTextFile,
  exportManifest,
  exportReportFiles,
  interruptBuild,
  listSnapshots,
  listTemplates,
  publishFile,
  reportFileDetail,
  restoreSnapshot,
  retireSnapshot,
  retryBuild,
} from '@/api/report-build-service'
import type { ReportFileDetail } from '@/api/report-build-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('reportbuild')
const columns = ["文件编号", "关联模板", "报告周期", "报告版本", "图表页数", "文件摘要", "导出格式", "水印标记"]
const statuses = ["生成中", "已生成", "已中断", "已发布", "已归档"]

const ACTION_BY_STATUS: Record<string, string[]> = {
  生成中: ['中断构建'],
  已中断: ['补全重试', '发布文件', '归档文件'],
  已生成: ['发布文件', '归档文件'],
  已发布: ['归档文件'],
  已归档: [],
}

const rows = ref<EntryRow[]>([])
const fileRows = ref<EntryRow[]>([])
const templates = ref<EntryRow[]>([])
const snapshots = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const building = ref('')
const busy = ref(false)
const selectedCode = ref('')
const detail = ref<ReportFileDetail>({ pages: [] })
let refreshTimer: number | undefined

const stats = computed(() => [
  { label: '明细文件总数', value: fileRows.value.length },
  { label: '已生成文件', value: fileRows.value.filter((row) => row.status === '已生成').length },
  { label: '已发布文件', value: fileRows.value.filter((row) => row.status === '已发布').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: fileRows.value.filter((row) => String(row.status) === status).length,
  })),
)

const manifestPreview = computed(() =>
  selectedCode.value ? exportManifest(selectedCode.value).content : '',
)

function actionsFor(row: EntryRow): string[] {
  return ACTION_BY_STATUS[String(row.status)] ?? []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  const { filename, content } = exportReportFiles(rows.value)
  downloadTextFile(filename, content, 'text/csv;charset=utf-8')
}

function openDetail(row: EntryRow) {
  selectedCode.value = String(row['文件编号'])
  detail.value = reportFileDetail(selectedCode.value)
}

function downloadManifest() {
  if (!selectedCode.value) {
    return
  }
  const { filename, content } = exportManifest(selectedCode.value)
  downloadTextFile(filename, content)
}

function showResult(result: { ok: boolean; message: string }) {
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

async function startBuild(templateCode: string) {
  errorMessage.value = ''
  noticeMessage.value = ''
  busy.value = true
  building.value = templateCode
  startAutoRefresh()
  try {
    const result = await buildReport(templateCode)
    showResult(result)
    if (result.fileCode) {
      selectedCode.value = result.fileCode
    }
  } finally {
    stopAutoRefresh()
    building.value = ''
    busy.value = false
    reload()
  }
}

async function runFileAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const fileCode = String(row['文件编号'])
  if (action === '中断构建') {
    showResult(interruptBuild(fileCode))
    reload()
    return
  }
  if (action === '补全重试') {
    busy.value = true
    startAutoRefresh()
    try {
      const result = await retryBuild(fileCode)
      showResult(result)
    } finally {
      stopAutoRefresh()
      busy.value = false
      reload()
    }
    return
  }
  if (action === '发布文件') {
    showResult(publishFile(fileCode))
  } else if (action === '归档文件') {
    showResult(archiveFile(fileCode))
  }
  reload()
}

function retireSnap(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  showResult(retireSnapshot(String(row['快照编号'])))
  reload()
}

function restoreSnap(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  showResult(restoreSnapshot(String(row['快照编号'])))
  reload()
}

function startAutoRefresh() {
  stopAutoRefresh()
  refreshTimer = window.setInterval(reload, 300)
}

function stopAutoRefresh() {
  if (refreshTimer !== undefined) {
    window.clearInterval(refreshTimer)
    refreshTimer = undefined
  }
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    fileRows.value = listRows(meta.key)
    templates.value = listTemplates()
    snapshots.value = listSnapshots()
    if (selectedCode.value) {
      detail.value = reportFileDetail(selectedCode.value)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '报告构建列表读取失败'
  }
}

onMounted(reload)
onBeforeUnmount(stopAutoRefresh)
</script>
