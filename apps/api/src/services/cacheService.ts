interface CacheEntry<T> {
  data: T
  expiresAt: number
}

class CacheService {
  private store = new Map<string, CacheEntry<unknown>>()
  private readonly defaultTtl = 7 * 24 * 60 * 60 * 1000

  get<T>(key: string): T | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.data as T
  }

  set<T>(key: string, data: T, ttlMs: number = this.defaultTtl): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs })
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key)
      }
    }
  }

  clear(): void {
    this.store.clear()
  }
}

export const cacheService = new CacheService()
