// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

if (typeof window !== 'undefined') {
  const store = new Map<string, string>()
  const mockStorage: Storage = {
    clear: () => {
      store.clear()
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
  }
  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: mockStorage,
      writable: true,
    })
  } catch {
    // Ignore if already configured
  }
}
