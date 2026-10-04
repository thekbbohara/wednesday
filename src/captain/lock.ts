// Cross-process turn lock: the terminal and the web server share one memory
// file and one captain session, so only one turn may run at a time.
import { openSync, closeSync, readFileSync, unlinkSync, writeSync } from 'node:fs'

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function withFileLock<T>(path: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      let pid = NaN
      try {
        pid = Number(readFileSync(path, 'utf8'))
      } catch {
        continue // removed between our open and read
      }
      if (!Number.isInteger(pid) || !alive(pid)) {
        // Left behind by a crashed process.
        try {
          unlinkSync(path)
        } catch {}
        continue
      }
      if (Date.now() > deadline) throw new Error(`captain is busy in another process (pid ${pid})`)
      await sleep(250)
    }
  }
  try {
    return await fn()
  } finally {
    try {
      unlinkSync(path)
    } catch {}
  }
}
