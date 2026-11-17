import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 报告构建：读取图表数据快照与报告模板，按模板渲染正文和附件，生成报告数据明细文件。
// 涉及报告数据明细文件、图表快照、分页明细的状态流转只允许在本文件里改，页面组件不做业务判断。

const RENDER_MS_PER_PAGE = 800

export type BuildResult = ActionResult & { fileCode?: string }

export type ReportFileDetail = {
  file?: EntryRow
  pages: EntryRow[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function nowStamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

// 确定性摘要：同样的文件内容算出来永远是同一个摘要，重新打开也能核对。
export function digestOf(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function listTemplates(): EntryRow[] {
  return listRows('reportgen')
}

export function listSnapshots(): EntryRow[] {
  return listRows('chartsnap')
}

export function listReportFiles(): EntryRow[] {
  return listRows('reportbuild')
}

export function templateCharts(template: EntryRow): string[] {
  return String(template['包含图表'] ?? '')
    .split(/[,，、;；\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function snapshotVersionNo(snapshot: EntryRow): number {
  const matched = /(\d+)/.exec(String(snapshot['快照版本'] ?? ''))
  return matched ? Number(matched[1]) : 0
}

export function activeSnapshotsOf(chartCode: string): EntryRow[] {
  return listSnapshots().filter(
    (row) => row['图表编号'] === chartCode && row.status === '有效',
  )
}

// 冲突处理：同一图表多版有效快照并存时选用最新版，来源取舍写进页明细，旧版留档可查。
function pickSnapshot(chartCode: string): { snapshot?: EntryRow; decision: string } {
  const candidates = [...activeSnapshotsOf(chartCode)].sort(
    (left, right) => snapshotVersionNo(right) - snapshotVersionNo(left),
  )
  const chosen = candidates[0]
  if (!chosen) {
    return { decision: '' }
  }
  if (candidates.length === 1) {
    return { snapshot: chosen, decision: `仅${chosen['快照版本']}一版有效快照，直接选用` }
  }
  const others = candidates
    .slice(1)
    .map((row) => String(row['快照版本']))
    .join('、')
  return {
    snapshot: chosen,
    decision: `旧版${others}与新版${chosen['快照版本']}并存，选用新版${chosen['快照版本']}，旧版留档可查`,
  }
}

// 任一图缺快照时，列出引用了这些图表的模板，便于核对影响面。
export function affectedTemplates(missingCharts: string[]): string[] {
  return listTemplates()
    .filter((template) => templateCharts(template).some((code) => missingCharts.includes(code)))
    .map((template) => String(template['模板编号']))
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextFileCode(): string {
  const max = listReportFiles().reduce((acc, row) => {
    const matched = /(\d+)/.exec(String(row['文件编号'] ?? ''))
    return Math.max(acc, matched ? Number(matched[1]) : 0)
  }, 0)
  return `REPB-${String(max + 1).padStart(4, '0')}`
}

// 版本随文件保存：同一模板同一报告周期内递增，报告文件通过报告周期核对归属。
function nextVersion(templateCode: string, period: string): string {
  const max = listReportFiles()
    .filter((row) => row['关联模板'] === templateCode && row['报告周期'] === period)
    .reduce((acc, row) => {
      const matched = /(\d+)/.exec(String(row['报告版本'] ?? ''))
      return Math.max(acc, matched ? Number(matched[1]) : 0)
    }, 0)
  return `v${max + 1}`
}

function chartNameOf(chartCode: string): string {
  const chart = listRows('chart').find((row) => row['图表编号'] === chartCode)
  return String(chart?.['图表名称'] ?? chartCode)
}

function renderPage(fileCode: string, pageNo: number, chartCode: string): void {
  const { snapshot, decision } = pickSnapshot(chartCode)
  const page: EntryRow = {
    id: nextId(listRows('reportpage')),
    status: '已完成',
    pending: false,
    abnormal: false,
    文件编号: fileCode,
    页码: pageNo,
    图表编号: chartCode,
    图表名称: chartNameOf(chartCode),
    快照编号: String(snapshot?.['快照编号'] ?? ''),
    快照版本: String(snapshot?.['快照版本'] ?? ''),
    来源取舍: decision,
    渲染时间: nowStamp(),
  }
  saveRows('reportpage', [...listRows('reportpage'), page])
}

function makePendingPage(fileCode: string, pageNo: number, chartCode: string, id: number): EntryRow {
  return {
    id,
    status: '待补全',
    pending: true,
    abnormal: false,
    文件编号: fileCode,
    页码: pageNo,
    图表编号: chartCode,
    图表名称: chartNameOf(chartCode),
    快照编号: '',
    快照版本: '',
    来源取舍: '构建中断，等待补全重试',
    渲染时间: '',
  }
}

function refreshFileProgress(fileCode: string): void {
  const files = listReportFiles()
  const index = files.findIndex((row) => row['文件编号'] === fileCode)
  if (index < 0) {
    return
  }
  const pages = listRows('reportpage').filter((row) => row['文件编号'] === fileCode)
  const done = pages.filter((row) => row.status === '已完成').length
  const next = [...files]
  next[index] = { ...files[index], 图表页数: `${done}/${pages.length}` }
  saveRows('reportbuild', next)
}

// 只有新文件完整生成后才归档同周期旧文件：中断时上一份完整报告不会被顶掉。
function completeFile(fileCode: string): void {
  const files = listReportFiles()
  const file = files.find((row) => row['文件编号'] === fileCode)
  if (!file) {
    return
  }
  const pages = listRows('reportpage').filter((row) => row['文件编号'] === fileCode)
  const done = pages.filter((row) => row.status === '已完成').length
  const digestSource = [
    String(file['文件编号']),
    String(file['关联模板']),
    String(file['报告周期']),
    String(file['报告版本']),
    ...pages.map((row) => `${row['页码']}:${row['图表编号']}@${row['快照版本']}`),
  ].join('|')
  const digest = digestOf(digestSource)
  const next = files.map((row) => {
    if (row['文件编号'] === fileCode) {
      return { ...row, status: '已生成', pending: false, 文件摘要: digest, 图表页数: `${done}/${pages.length}` }
    }
    if (
      row['关联模板'] === file['关联模板'] &&
      row['报告周期'] === file['报告周期'] &&
      (row.status === '已生成' || row.status === '已发布')
    ) {
      return { ...row, status: '已归档', pending: false }
    }
    return row
  })
  saveRows('reportbuild', next)
}

function markFileStatus(fileCode: string, status: string): void {
  const files = listReportFiles()
  const index = files.findIndex((row) => row['文件编号'] === fileCode)
  if (index < 0) {
    return
  }
  const next = [...files]
  next[index] = { ...files[index], status, pending: status !== '已归档' }
  saveRows('reportbuild', next)
}

export async function buildReport(templateCode: string): Promise<BuildResult> {
  const template = listTemplates().find((row) => row['模板编号'] === templateCode)
  if (!template) {
    return { ok: false, message: `没有找到报告模板 ${templateCode}` }
  }
  const period = String(template['报告周期'] ?? '').trim()
  if (period === '') {
    return { ok: false, message: `模板 ${templateCode} 没有登记报告周期，报告文件要通过报告周期核对，先补周期` }
  }
  const charts = templateCharts(template)
  if (charts.length === 0) {
    return { ok: false, message: `模板 ${templateCode} 没有配置包含图表` }
  }
  // 并发执行只认可一份：同模板同周期已有生成中的文件就拒绝。
  const inflight = listReportFiles().find(
    (row) => row['关联模板'] === templateCode && row['报告周期'] === period && row.status === '生成中',
  )
  if (inflight) {
    return {
      ok: false,
      message: `${templateCode}/${period} 已有进行中的构建 ${inflight['文件编号']}，并发执行只认可一份报告数据明细文件`,
    }
  }
  // 快照核对：任一图缺快照就列出受影响模板。
  const missing = charts.filter((code) => activeSnapshotsOf(code).length === 0)
  if (missing.length > 0) {
    const affected = affectedTemplates(missing)
    return {
      ok: false,
      message: `图表 ${missing.join('、')} 缺少数据快照，受影响模板：${affected.join('、') || '无'}`,
    }
  }

  const fileCode = nextFileCode()
  const version = nextVersion(templateCode, period)
  const watermark = String(template['水印开关']) === '开' ? '带水印' : '无水印'
  const file: EntryRow = {
    id: nextId(listReportFiles()),
    status: '生成中',
    pending: true,
    abnormal: false,
    文件编号: fileCode,
    关联模板: templateCode,
    报告周期: period,
    报告版本: version,
    图表页数: `0/${charts.length}`,
    文件摘要: '渲染中',
    导出格式: String(template['导出格式'] ?? 'PDF'),
    水印标记: watermark,
  }
  saveRows('reportbuild', [...listReportFiles(), file])

  for (let index = 0; index < charts.length; index += 1) {
    await sleep(RENDER_MS_PER_PAGE)
    const current = listReportFiles().find((row) => row['文件编号'] === fileCode)
    if (!current || current.status !== '生成中') {
      // 生成中断：剩余页登记为待补全，上一份完整报告保持有效。
      const rest = charts.slice(index)
      const pages = listRows('reportpage')
      const baseId = nextId(pages)
      const pendingPages = rest.map((code, offset) =>
        makePendingPage(fileCode, index + offset + 1, code, baseId + offset),
      )
      saveRows('reportpage', [...pages, ...pendingPages])
      refreshFileProgress(fileCode)
      return {
        ok: false,
        fileCode,
        message: `${fileCode} 构建中断：已完成 ${index} 页，待补全 ${rest.length} 页，上一份完整报告保持有效`,
      }
    }
    renderPage(fileCode, index + 1, charts[index])
    refreshFileProgress(fileCode)
  }
  completeFile(fileCode)
  return {
    ok: true,
    fileCode,
    message: `${fileCode}（${version}）已生成，共 ${charts.length} 页，${watermark}，本次构建只生成这一份报告数据明细文件`,
  }
}

export function interruptBuild(fileCode: string): ActionResult {
  const files = listReportFiles()
  const index = files.findIndex((row) => row['文件编号'] === fileCode)
  if (index < 0) {
    return { ok: false, message: `没有找到报告数据明细文件 ${fileCode}` }
  }
  if (files[index].status !== '生成中') {
    return { ok: false, message: `${fileCode} 当前状态「${files[index].status}」，只有生成中的文件能中断` }
  }
  const next = [...files]
  next[index] = { ...files[index], status: '已中断', pending: true }
  saveRows('reportbuild', next)
  return { ok: true, message: `${fileCode} 已中断，上一份完整报告保持有效，可补全重试` }
}

// 重试只补未完成图表：已完成的页保持原快照版本不动。
export async function retryBuild(fileCode: string): Promise<BuildResult> {
  const files = listReportFiles()
  const file = files.find((row) => row['文件编号'] === fileCode)
  if (!file) {
    return { ok: false, message: `没有找到报告数据明细文件 ${fileCode}` }
  }
  if (file.status !== '已中断') {
    return { ok: false, message: `${fileCode} 当前状态「${file.status}」，只有已中断的文件需要补全重试` }
  }
  const inflight = files.find(
    (row) =>
      row['关联模板'] === file['关联模板'] && row['报告周期'] === file['报告周期'] && row.status === '生成中',
  )
  if (inflight) {
    return {
      ok: false,
      message: `已有进行中的构建 ${inflight['文件编号']}，并发执行只认可一份报告数据明细文件`,
    }
  }
  const pendingPages = listRows('reportpage')
    .filter((row) => row['文件编号'] === fileCode && row.status === '待补全')
    .sort((left, right) => Number(left['页码']) - Number(right['页码']))
  if (pendingPages.length === 0) {
    return { ok: false, message: `${fileCode} 没有待补全的图表页` }
  }
  const missing = [...new Set(pendingPages.map((row) => String(row['图表编号'])))].filter(
    (code) => activeSnapshotsOf(code).length === 0,
  )
  if (missing.length > 0) {
    const affected = affectedTemplates(missing)
    return {
      ok: false,
      message: `图表 ${missing.join('、')} 仍缺少数据快照，受影响模板：${affected.join('、') || '无'}`,
    }
  }
  markFileStatus(fileCode, '生成中')
  for (const page of pendingPages) {
    await sleep(RENDER_MS_PER_PAGE)
    const current = listReportFiles().find((row) => row['文件编号'] === fileCode)
    if (!current || current.status !== '生成中') {
      refreshFileProgress(fileCode)
      return { ok: false, fileCode, message: `${fileCode} 补全重试被中断，剩余待补全页保留` }
    }
    completePage(Number(page.id))
    refreshFileProgress(fileCode)
  }
  completeFile(fileCode)
  return {
    ok: true,
    fileCode,
    message: `${fileCode} 补全完成，只补了 ${pendingPages.length} 页未完成图表，已生成完整报告`,
  }
}

function completePage(pageId: number): void {
  const pages = listRows('reportpage')
  const index = pages.findIndex((row) => Number(row.id) === pageId)
  if (index < 0) {
    return
  }
  const { snapshot, decision } = pickSnapshot(String(pages[index]['图表编号']))
  const next = [...pages]
  next[index] = {
    ...pages[index],
    status: '已完成',
    pending: false,
    快照编号: String(snapshot?.['快照编号'] ?? ''),
    快照版本: String(snapshot?.['快照版本'] ?? ''),
    来源取舍: decision,
    渲染时间: nowStamp(),
  }
  saveRows('reportpage', next)
}

export function publishFile(fileCode: string): ActionResult {
  const files = listReportFiles()
  const file = files.find((row) => row['文件编号'] === fileCode)
  if (!file) {
    return { ok: false, message: `没有找到报告数据明细文件 ${fileCode}` }
  }
  // 缺失页不能进入已发布快照：还有待补全页就先补全重试。
  const pendingPages = listRows('reportpage').filter(
    (row) => row['文件编号'] === fileCode && row.status !== '已完成',
  )
  if (file.status === '已中断' || pendingPages.length > 0) {
    return {
      ok: false,
      message: `${fileCode} 还有 ${pendingPages.length} 页待补全，先补全重试，否则缺失页会进入已发布快照`,
    }
  }
  if (file.status !== '已生成') {
    return { ok: false, message: `${fileCode} 当前状态「${file.status}」，只有已生成的文件能发布` }
  }
  markFileStatus(fileCode, '已发布')
  return { ok: true, message: `${fileCode} 已发布，导出明细与列表对得上` }
}

export function archiveFile(fileCode: string): ActionResult {
  const files = listReportFiles()
  const file = files.find((row) => row['文件编号'] === fileCode)
  if (!file) {
    return { ok: false, message: `没有找到报告数据明细文件 ${fileCode}` }
  }
  if (file.status === '生成中') {
    return { ok: false, message: `${fileCode} 正在生成中，先中断构建再归档` }
  }
  if (file.status === '已归档') {
    return { ok: false, message: `${fileCode} 已经是「已归档」，不用重复操作` }
  }
  markFileStatus(fileCode, '已归档')
  return { ok: true, message: `${fileCode} 已归档` }
}

export function retireSnapshot(snapshotCode: string): ActionResult {
  return markSnapshotStatus(snapshotCode, '已废止', '有效')
}

export function restoreSnapshot(snapshotCode: string): ActionResult {
  return markSnapshotStatus(snapshotCode, '有效', '已废止')
}

function markSnapshotStatus(snapshotCode: string, target: string, from: string): ActionResult {
  const snapshots = listSnapshots()
  const index = snapshots.findIndex((row) => row['快照编号'] === snapshotCode)
  if (index < 0) {
    return { ok: false, message: `没有找到快照 ${snapshotCode}` }
  }
  if (snapshots[index].status !== from) {
    return {
      ok: false,
      message: `${snapshotCode} 当前状态「${snapshots[index].status}」，不能流转到「${target}」`,
    }
  }
  const next = [...snapshots]
  next[index] = { ...snapshots[index], status: target }
  saveRows('chartsnap', next)
  return { ok: true, message: `${snapshotCode} 已流转到「${target}」` }
}

export function reportFileDetail(fileCode: string): ReportFileDetail {
  const file = listReportFiles().find((row) => row['文件编号'] === fileCode)
  const pages = listRows('reportpage')
    .filter((row) => row['文件编号'] === fileCode)
    .sort((left, right) => Number(left['页码']) - Number(right['页码']))
  return { file, pages }
}

// 导出清单：明细文件、图表快照、附件一页一单，和详情视图看到的一致。
export function exportManifest(fileCode: string): { filename: string; content: string } {
  const { file, pages } = reportFileDetail(fileCode)
  if (!file) {
    return { filename: `${fileCode}-导出清单.txt`, content: `没有找到报告数据明细文件 ${fileCode}` }
  }
  const template = listTemplates().find((row) => row['模板编号'] === file['关联模板'])
  const pack = String(template?.['附件压缩'] ?? 'zip')
  const lines = [
    '报告数据明细文件导出清单',
    `文件编号：${file['文件编号']}`,
    `关联模板：${file['关联模板']}`,
    `报告周期：${file['报告周期']}`,
    `报告版本：${file['报告版本']}`,
    `文件摘要：${file['文件摘要']}`,
    `导出格式：${file['导出格式']}`,
    `水印标记：${file['水印标记']}`,
    `当前状态：${file.status}`,
    '正文页：',
    ...pages.map(
      (row) =>
        `第${row['页码']}页 ${row['图表编号']} ${row['图表名称']} 快照${row['快照编号'] || '—'}(${row['快照版本'] || '待补全'}) ${row.status}`,
    ),
    `附件：${file['文件编号']}-附件包.${pack}`,
  ]
  return { filename: `${fileCode}-导出清单.txt`, content: `${lines.join('\n')}\n` }
}

// 导出明细与列表对得上：导出的就是列表当前展示的行。
export function exportReportFiles(rows: EntryRow[]): { filename: string; content: string } {
  const header = ['文件编号', '关联模板', '报告周期', '报告版本', '图表页数', '文件摘要', '导出格式', '水印标记', '当前状态']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row['文件编号'] ?? '',
        row['关联模板'] ?? '',
        row['报告周期'] ?? '',
        row['报告版本'] ?? '',
        row['图表页数'] ?? '',
        row['文件摘要'] ?? '',
        row['导出格式'] ?? '',
        row['水印标记'] ?? '',
        row.status,
      ].join(','),
    )
  }
  return { filename: '报告数据明细文件-清单.csv', content: `\uFEFF${lines.join('\n')}` }
}

export function downloadTextFile(filename: string, content: string, type = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
