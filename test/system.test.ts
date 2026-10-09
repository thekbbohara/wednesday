import { describe, it, expect } from 'vitest'
import { readSystem, parseCpuStat, parseMeminfo, parseMounts, parseNvidiaSmi, parseProcStat, powerState, top } from '../src/system.ts'

describe('system stats parsing', () => {
  it('reads RAM and swap from /proc/meminfo in bytes, falling back when MemAvailable is missing', () => {
    const meminfo = 'MemTotal:       16233544 kB\nMemFree:         1000000 kB\nMemAvailable:    6912516 kB\nBuffers:          100000 kB\nCached:          3000000 kB\nSwapTotal:       8116732 kB\nSwapFree:        8041820 kB\n'
    expect(parseMeminfo(meminfo)).toEqual({ total: 16233544 * 1024, available: 6912516 * 1024, used: (16233544 - 6912516) * 1024, swapTotal: 8116732 * 1024, swapUsed: (8116732 - 8041820) * 1024 })
    expect(parseMeminfo(meminfo.replace(/^MemAvailable.*\n/m, '')).available).toBe(4100000 * 1024)
    expect(parseMeminfo('')).toEqual({ total: 0, used: 0, available: 0, swapTotal: 0, swapUsed: 0 })
  })

  it('counts iowait as idle in /proc/stat', () => {
    const [all, cpu0] = parseCpuStat('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 10 0 5 80 5 0 0 0 0 0\nintr 1 2 3\n')
    expect(all).toEqual({ busy: 150, total: 1000 })
    expect(cpu0).toEqual({ busy: 15, total: 100 })
  })

  it('keeps real block-device mounts once and decodes escaped paths', () => {
    const mounts = [
      '/dev/nvme0n1p2 / ext4 rw,relatime 0 0',
      'proc /proc proc rw 0 0',
      'tmpfs /tmp tmpfs rw 0 0',
      'overlay /var/lib/docker/overlay2/x/merged overlay rw 0 0',
      '/dev/loop0 /snap/core/1 squashfs ro 0 0',
      'efivarfs /sys/firmware/efi/efivars efivarfs rw 0 0',
      '/dev/nvme0n1p1 /boot vfat rw 0 0',
      '/dev/sda3 /mnt/my\\040data ext4 rw 0 0',
      '/dev/nvme0n1p2 /var/lib/docker ext4 rw 0 0',
    ].join('\n')
    expect(parseMounts(mounts)).toEqual([
      { device: '/dev/nvme0n1p2', mount: '/', type: 'ext4' },
      { device: '/dev/nvme0n1p1', mount: '/boot', type: 'vfat' },
      { device: '/dev/sda3', mount: '/mnt/my data', type: 'ext4' },
    ])
  })

  it('reads a process name with spaces and parentheses, its CPU ticks and resident pages', () => {
    const fields = ['S', '1', '1', '1', '0', '-1', '4194560', '0', '0', '0', '0', '700', '300', '0', '0', '20', '0', '12', '0', '100', '123456789', '2048']
    expect(parseProcStat(`4242 (Web (Content)) ${fields.join(' ')} 18446744073709551615`)).toEqual({ name: 'Web (Content)', ticks: 1000, rssPages: 2048 })
    expect(parseProcStat('garbage')).toBeNull()
  })

  it('groups processes by name and reports CPU as a share of one core over the sample', () => {
    const p = (name: string, ticks: number, rssPages: number) => ({ name, ticks, rssPages })
    const before = new Map([[1, p('chrome', 100, 0)], [2, p('chrome', 100, 0)], [3, p('mysqld', 0, 0)], [4, p('old', 0, 0)]])
    const after = new Map([[1, p('chrome', 125, 1000)], [2, p('chrome', 125, 1000)], [3, p('mysqld', 100, 5000)], [4, p('reused', 900, 1)], [5, p('new', 50, 10)]])
    const t = top(before, after, 1)
    // Over one second at 100 ticks/s: chrome 2 x 25 ticks = 50%, mysqld 100 ticks = 100%; a reused pid and a new one count as idle.
    expect(t.cpu).toEqual([{ name: 'mysqld', count: 1, cpu: 100, rss: 5000 * 4096 }, { name: 'chrome', count: 2, cpu: 50, rss: 2000 * 4096 }])
    expect(t.memory.map(r => r.name)).toEqual(['mysqld', 'chrome', 'new', 'reused'])
  })

  it('reads nvidia-smi rows and treats [N/A] as unknown', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce GTX 1060, 7, 512, 6144, 56, 7.25, [N/A]\n')).toEqual([
      { name: 'NVIDIA GeForce GTX 1060', util: 7, memUsed: 512 * 1024 ** 2, memTotal: 6144 * 1024 ** 2, temp: 56, power: 7.25, powerLimit: undefined },
    ])
    expect(parseNvidiaSmi('')).toEqual([])
  })

  it('reports a battery when there is one, otherwise AC power', () => {
    expect(powerState([{ type: 'Mains', online: '1' }])).toEqual({ kind: 'ac', online: true })
    expect(powerState([])).toEqual({ kind: 'ac', online: null })
    expect(powerState([{ type: 'Mains', online: '0' }, { type: 'Battery', capacity: '57', status: 'Discharging' }])).toEqual({ kind: 'battery', percent: 57, status: 'Discharging', ac: false })
    // A wireless mouse's battery is not the PC's.
    expect(powerState([{ type: 'Mains', online: '1' }, { type: 'Battery', scope: 'Device', capacity: '80', status: 'Discharging' }])).toEqual({ kind: 'ac', online: true })
  })

  it.skipIf(process.platform !== 'linux')('reads this machine, sharing one collection between close callers', async () => {
    const [a, b] = await Promise.all([readSystem(), readSystem()])
    expect(a).toBe(b)
    expect(a.memory.total).toBeGreaterThan(0)
    expect(a.cpu.percent).toBeGreaterThanOrEqual(0)
    expect(a.cpu.percent).toBeLessThanOrEqual(100)
    expect(a.disks.length).toBeGreaterThan(0)
  })
})
