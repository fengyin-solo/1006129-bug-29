import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'
const BACKUP_KEY = 'shield-tunnel-construction:entries:backup'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

/**
 * 直接读取用户存下的泛型表（不合并种子）。
 * 监测领域首次加载时用它补录存量测点；没存过就返回空表，绝不拿种子占位行当老数据。
 */
export function rawLegacyEntries(): Partial<Record<string, EntryRow[]>> {
  if (!hasStorage()) return {}
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Partial<Record<string, EntryRow[]>>
  } catch {
    const backup = window.localStorage.getItem(BACKUP_KEY)
    if (backup) {
      try {
        return JSON.parse(backup) as Partial<Record<string, EntryRow[]>>
      } catch {
        return {}
      }
    }
    return {}
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (!hasStorage()) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    // 主副本损坏：优先用上一次成功写入的备份，不覆盖用户数据、不静默回退种子。
    const backup = window.localStorage.getItem(BACKUP_KEY)
    if (backup) {
      try {
        return { ...fallback, ...(JSON.parse(backup) as Record<string, EntryRow[]>) }
      } catch {
        // 备份也坏：只读返回种子，不做任何写入，等用户处置，避免把坏数据之外的改动盖掉。
        return fallback
      }
    }
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (hasStorage()) {
    const payload = JSON.stringify(next)
    // 瞬时写失败重试 3 次；成功后再核对一遍并刷新备份。
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        window.localStorage.setItem(STORAGE_KEY, payload)
        if (window.localStorage.getItem(STORAGE_KEY) === payload) {
          window.localStorage.setItem(BACKUP_KEY, payload)
          return
        }
        throw new Error('落盘后核对不一致')
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(
      `数据写入失败，请重试：${lastError instanceof Error ? lastError.message : String(lastError)}`,
    )
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
