// Shape of GET /api/system, shared with the web UI. Sizes are bytes, shares are 0-100.
/** Processes grouped by name: summed CPU (100 = one core) and resident memory over `count` processes. */
export interface ProcessUse { name: string; count: number; cpu: number; rss: number }
export interface DiskUse { mount: string; device: string; type: string; total: number; used: number; free: number; percent: number }
export interface GpuUse { name: string; util?: number; memUsed?: number; memTotal?: number; temp?: number; power?: number; powerLimit?: number }
export type PowerState =
  | { kind: 'battery'; percent: number; status: string; ac: boolean | null }
  | { kind: 'ac'; online: boolean | null }
export interface SystemStats {
  hostname: string
  uptime: number
  checkedAt: string
  cpu: { percent: number; cores: number[]; count: number; model: string; load: [number, number, number]; temp?: number }
  memory: { total: number; used: number; available: number; swapTotal: number; swapUsed: number }
  disks: DiskUse[]
  /** Empty when there is no NVIDIA GPU, or nvidia-smi is missing or failed. */
  gpus: GpuUse[]
  power: PowerState
  top: { cpu: ProcessUse[]; memory: ProcessUse[] }
}
