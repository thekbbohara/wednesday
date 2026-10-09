// This PC's live health for the Usages page: CPU, memory, disks, GPU, power, top processes.
// Linux only, read-only: /proc, /sys, statfs and (if installed) nvidia-smi. Kept cheap - the
// owner's PC is fragile - so one collection is shared by every caller for a couple of seconds.
import { execFile } from 'node:child_process'
import { readdir, readFile, statfs } from 'node:fs/promises'
import { cpus, hostname } from 'node:os'
import type { DiskUse, GpuUse, PowerState, ProcessUse, SystemStats } from './system-types.ts'

const CLK_TCK = 100
const PAGE = 4096
const SAMPLE_MS = 500
const CACHE_MS = 2_000
const GPU_TIMEOUT_MS = 2_000

/** Bytes from /proc/meminfo (values there are kB). */
export function parseMeminfo(text: string): SystemStats['memory'] {
  const kb = (key: string) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024
  const total = kb('MemTotal')
  // Kernels before 3.14 lack MemAvailable; free + cache is the old estimate.
  const available = /^MemAvailable:/m.test(text) ? kb('MemAvailable') : kb('MemFree') + kb('Buffers') + kb('Cached')
  const swapTotal = kb('SwapTotal')
  return { total, used: Math.max(0, total - available), available, swapTotal, swapUsed: Math.max(0, swapTotal - kb('SwapFree')) }
}

/** Busy and total jiffies for "cpu" (all) and each "cpuN" line of /proc/stat. */
export function parseCpuStat(text: string): { busy: number; total: number }[] {
  return text.split('\n').filter(l => /^cpu\d*\s/.test(l)).map(l => {
    const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = l.trim().split(/\s+/).slice(1).map(Number)
    const total = user + nice + system + idle + iowait + irq + softirq + steal
    return { busy: total - idle - iowait, total }
  })
}

const share = (a: { busy: number; total: number }, b: { busy: number; total: number }) =>
  b.total > a.total ? Math.min(100, Math.max(0, ((b.busy - a.busy) / (b.total - a.total)) * 100)) : 0

/** Filesystem types that are not real storage (or that would double count it). */
const VIRTUAL_FS = new Set(['tmpfs', 'devtmpfs', 'overlay', 'squashfs', 'proc', 'sysfs', 'cgroup', 'cgroup2', 'devpts', 'mqueue', 'debugfs', 'tracefs', 'securityfs', 'pstore', 'efivarfs', 'bpf', 'autofs', 'hugetlbfs', 'configfs', 'fusectl', 'ramfs', 'nsfs', 'binfmt_misc', 'rpc_pipefs', 'fuse.portal', 'fuse.gvfsd-fuse'])

/** Real, block-device mounts from /proc/mounts, first mount of each device only (bind mounts repeat it). */
export function parseMounts(text: string): { device: string; mount: string; type: string }[] {
  const seen = new Set<string>()
  const out: { device: string; mount: string; type: string }[] = []
  for (const line of text.split('\n')) {
    const [device, rawMount, type] = line.split(' ')
    if (!device || !rawMount || !type || VIRTUAL_FS.has(type)) continue
    if (!device.startsWith('/dev/') || device.startsWith('/dev/loop') || seen.has(device)) continue
    seen.add(device)
    // /proc/mounts escapes space, tab, newline and backslash as octal.
    out.push({ device, type, mount: rawMount.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8))) })
  }
  return out
}

/** Per-process ticks and resident pages from /proc/<pid>/stat (the name may hold spaces and parentheses). */
export function parseProcStat(text: string): { name: string; ticks: number; rssPages: number } | null {
  const open = text.indexOf('('), close = text.lastIndexOf(')')
  if (open < 0 || close < open) return null
  const f = text.slice(close + 2).split(' ')
  const ticks = Number(f[11]) + Number(f[12])
  const rssPages = Number(f[21])
  if (!Number.isFinite(ticks) || !Number.isFinite(rssPages)) return null
  return { name: text.slice(open + 1, close), ticks, rssPages }
}

/** Rows of `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(text: string): GpuUse[] {
  const num = (s: string | undefined) => {
    const n = Number(s?.trim())
    return s && /\d/.test(s) && Number.isFinite(n) ? n : undefined
  }
  const mib = (s: string | undefined) => { const n = num(s); return n === undefined ? undefined : n * 1024 * 1024 }
  return text.split('\n').filter(l => l.trim()).map(l => {
    const [name, util, memUsed, memTotal, temp, power, powerLimit] = l.split(',')
    return { name: name.trim(), util: num(util), memUsed: mib(memUsed), memTotal: mib(memTotal), temp: num(temp), power: num(power), powerLimit: num(powerLimit) }
  })
}

/** Battery and mains from /sys/class/power_supply entries ({ type, capacity, status, online } per supply). */
export function powerState(supplies: { type?: string; scope?: string; capacity?: string; status?: string; online?: string }[]): PowerState {
  const mains = supplies.filter(s => s.type === 'Mains' || s.type === 'USB')
  const ac = mains.length ? mains.some(s => s.online === '1') : null
  // scope=Device is a peripheral's battery (mouse, headset), not the PC's.
  const bat = supplies.find(s => s.type === 'Battery' && s.scope !== 'Device' && s.capacity !== undefined)
  if (bat) return { kind: 'battery', percent: Number(bat.capacity), status: bat.status ?? 'Unknown', ac }
  return { kind: 'ac', online: ac }
}

const read = (path: string) => readFile(path, 'utf8').then(s => s.trim(), () => undefined)

interface Snapshot { at: number; cpu: { busy: number; total: number }[]; procs: Map<number, { name: string; ticks: number; rssPages: number }> }

async function snapshot(): Promise<Snapshot> {
  const [stat, pids] = await Promise.all([readFile('/proc/stat', 'utf8'), readdir('/proc').catch(() => [] as string[])])
  const procs = new Map<number, { name: string; ticks: number; rssPages: number }>()
  await Promise.all(pids.filter(p => /^\d+$/.test(p)).map(async p => {
    const s = await read(`/proc/${p}/stat`)
    const parsed = s && parseProcStat(s)
    if (parsed) procs.set(Number(p), parsed)
  }))
  return { at: Date.now(), cpu: parseCpuStat(stat), procs }
}

async function cpuTemp(): Promise<number | undefined> {
  // Prefer the CPU package sensor (coretemp / k10temp), then the x86 package thermal zone.
  const hw = await readdir('/sys/class/hwmon').catch(() => [] as string[])
  for (const h of hw) {
    const name = await read(`/sys/class/hwmon/${h}/name`)
    if (name !== 'coretemp' && name !== 'k10temp' && name !== 'zenpower') continue
    const t = Number(await read(`/sys/class/hwmon/${h}/temp1_input`))
    if (t > 0) return t / 1000
  }
  const zones = await readdir('/sys/class/thermal').catch(() => [] as string[])
  for (const z of zones.filter(z => z.startsWith('thermal_zone'))) {
    if ((await read(`/sys/class/thermal/${z}/type`)) !== 'x86_pkg_temp') continue
    const t = Number(await read(`/sys/class/thermal/${z}/temp`))
    if (t > 0) return t / 1000
  }
  return undefined
}

async function disks(): Promise<DiskUse[]> {
  const mounts = parseMounts((await read('/proc/mounts')) ?? '')
  const rows = await Promise.all(mounts.map(async m => {
    try {
      const s = await statfs(m.mount)
      const total = s.blocks * s.bsize, free = s.bavail * s.bsize, used = (s.blocks - s.bfree) * s.bsize
      if (total <= 0) return null
      // As df: used against what a normal user can fill (root-reserved blocks excluded).
      return { ...m, total, used, free, percent: used + free > 0 ? (used / (used + free)) * 100 : 0 }
    } catch { return null }
  }))
  return rows.filter((r): r is DiskUse => r !== null)
}

let nvidiaMissing = false
function gpus(): Promise<GpuUse[]> {
  if (nvidiaMissing) return Promise.resolve([])
  return new Promise(resolve => {
    execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit', '--format=csv,noheader,nounits'],
      { timeout: GPU_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (error, stdout) => {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') nvidiaMissing = true
        resolve(error ? [] : parseNvidiaSmi(stdout))
      })
  })
}

async function power(): Promise<PowerState> {
  const names = await readdir('/sys/class/power_supply').catch(() => [] as string[])
  return powerState(await Promise.all(names.map(async n => {
    const base = `/sys/class/power_supply/${n}`
    const [type, scope, capacity, status, online] = await Promise.all(['type', 'scope', 'capacity', 'status', 'online'].map(f => read(`${base}/${f}`)))
    return { type, scope, capacity, status, online }
  })))
}

/** Busiest programs by CPU and by memory, each program's processes summed (twelve chrome processes are one row). */
export function top(a: Snapshot['procs'], b: Snapshot['procs'], seconds: number): SystemStats['top'] {
  const groups = new Map<string, ProcessUse>()
  for (const [pid, p] of b) {
    const before = a.get(pid)
    const cpu = before && before.name === p.name ? Math.max(0, ((p.ticks - before.ticks) / CLK_TCK / seconds) * 100) : 0
    const g = groups.get(p.name) ?? { name: p.name, count: 0, cpu: 0, rss: 0 }
    g.count++, g.cpu += cpu, g.rss += p.rssPages * PAGE
    groups.set(p.name, g)
  }
  const rows = [...groups.values()]
  return {
    cpu: [...rows].sort((x, y) => y.cpu - x.cpu).slice(0, 5).filter(r => r.cpu >= 0.5),
    memory: [...rows].sort((x, y) => y.rss - x.rss).slice(0, 5),
  }
}

let last: Snapshot | undefined
async function collect(): Promise<SystemStats> {
  // CPU use is a difference of two readings: reuse the previous request's when it is recent
  // (the page polls every 5 s), otherwise sample for half a second.
  const gpu = gpus()
  let a = last
  let b = await snapshot()
  if (!a || b.at - a.at < SAMPLE_MS - 100 || b.at - a.at > 30_000) {
    a = b
    await new Promise(r => setTimeout(r, SAMPLE_MS))
    b = await snapshot()
  }
  last = b
  const [meminfo, uptime, temp, disk, pw] = await Promise.all([read('/proc/meminfo'), read('/proc/uptime'), cpuTemp(), disks(), power()])
  const [all, ...cores] = b.cpu.map((c, i) => share(a.cpu[i] ?? c, c))
  const loadavg = ((await read('/proc/loadavg')) ?? '0 0 0').split(' ').slice(0, 3).map(Number) as [number, number, number]
  const info = cpus()
  return {
    hostname: hostname(),
    uptime: Number(uptime?.split(' ')[0] ?? 0),
    checkedAt: new Date().toISOString(),
    cpu: { percent: all ?? 0, cores, count: cores.length || info.length, model: info[0]?.model.trim() ?? 'CPU', load: loadavg, temp },
    memory: parseMeminfo(meminfo ?? ''),
    disks: disk,
    gpus: await gpu,
    power: pw,
    top: top(a.procs, b.procs, Math.max(0.1, (b.at - a.at) / 1000)),
  }
}

let cached: { at: number; value: Promise<SystemStats> } | undefined
/** Live system stats; callers within CACHE_MS share one collection. */
export function readSystem(): Promise<SystemStats> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  const value = collect()
  cached = { at: Date.now(), value }
  value.catch(() => { cached = undefined })
  return value
}
