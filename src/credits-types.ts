export interface Allowance { label: string; remainingPercent?: number; remaining?: string; resetsAt: string | null }
export interface CreditAccount {
  id: string; runtime: string; account: string; source: string; status: 'available' | 'unavailable' | 'stale'
  checkedAt: string; fetchedAt: string | null; reason: string | null; allowances: Allowance[]; note?: string
}
