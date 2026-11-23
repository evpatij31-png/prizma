/**
 * The only module that knows IndexedDB exists.
 *
 * Three rules shape this file, all of them aimed at the cloud sync that is
 * deliberately *not* in V1:
 *   1. Deletes are tombstones (`deletedAt`), never physical removals, so a
 *      future sync can tell "deleted here" from "never arrived here".
 *   2. Every record gets an iCalendar `uid` and an `updatedAt` merge clock on
 *      write, so callers never have to remember to set them.
 *   3. Nothing above this layer sees a raw transaction or an index name.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CalEvent, Calendar, Settings, Syncable, Task } from './types.ts'
import type { Local } from './datetime.ts'

export const DB_NAME = 'prizma'
export const DB_VERSION = 1

/** Tombstones older than this are swept at startup. */
export const TOMBSTONE_MAX_AGE_DAYS = 90

/** The settings row is a singleton; this is its key. */
const SETTINGS_KEY = 'app'

interface StoredSettings extends Settings {
  id: typeof SETTINGS_KEY
}

interface PrizmaDB extends DBSchema {
  calendars: {
    key: string
    value: Calendar
    indexes: { order: number }
  }
  events: {
    key: string
    value: CalEvent
    // No index on `rrule`: see inRange() for why recurring events are always
    // candidates rather than something we can narrow with a key range.
    indexes: { calendarId: string; start: string; uid: string }
  }
  tasks: {
    key: string
    value: Task
    // No index on `done`: IndexedDB keys may only be string | number | Date |
    // binary | array. A boolean field is silently absent from its index, so an
    // index on `done` would quietly match nothing. Filtered in memory instead.
    indexes: { calendarId: string; due: string }
  }
  settings: {
    key: string
    value: StoredSettings
  }
}

export type RecordStore = 'calendars' | 'events' | 'tasks'

/* ------------------------------ connection ------------------------------- */

let connection: Promise<IDBPDatabase<PrizmaDB>> | null = null

/** One connection per process, opened lazily. */
export function db(): Promise<IDBPDatabase<PrizmaDB>> {
  connection ??= openDB<PrizmaDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      // Version 1 is the initial schema. Later versions add their migration
      // as `if (oldVersion < 2) { ... }` — never by editing the block below.
      if (oldVersion < 1) {
        const calendars = database.createObjectStore('calendars', { keyPath: 'id' })
        calendars.createIndex('order', 'order')

        const events = database.createObjectStore('events', { keyPath: 'id' })
        events.createIndex('calendarId', 'calendarId')
        events.createIndex('start', 'start')
        events.createIndex('uid', 'uid')

        const tasks = database.createObjectStore('tasks', { keyPath: 'id' })
        tasks.createIndex('calendarId', 'calendarId')
        tasks.createIndex('due', 'due')

        database.createObjectStore('settings', { keyPath: 'id' })
      }
    },
    blocked() {
      console.warn('[db] another tab holds an older version of the database open')
    },
  })
  return connection
}

/** Test seam: drop the cached connection so the next call reopens. */
export async function closeDb(): Promise<void> {
  if (!connection) return
  const open = await connection
  open.close()
  connection = null
}

/* -------------------------------- metadata -------------------------------- */

function newUid(): string {
  return `${crypto.randomUUID()}@prizma`
}

export function newId(): string {
  return crypto.randomUUID()
}

/**
 * Stamp a record on its way to disk. `uid` is generated once and then left
 * alone: it is the identity a remote server will match on, so rewriting it
 * would duplicate the record on the next sync.
 */
function stamp<T extends Syncable>(record: T): T {
  return {
    ...record,
    id: record.id || newId(),
    uid: record.uid || newUid(),
    updatedAt: Date.now(),
  }
}

/* ------------------------------- operations ------------------------------- */

export interface ListOptions {
  /** Include tombstones. Off by default — callers want live records. */
  includeDeleted?: boolean
}

type ValueOf<S extends RecordStore> = PrizmaDB[S]['value']

const isLive = (r: { deletedAt?: number | null }) => r.deletedAt == null

function makeStore<S extends RecordStore>(name: S) {
  type V = ValueOf<S>

  return {
    name,

    async list(opts: ListOptions = {}): Promise<V[]> {
      const all = (await (await db()).getAll(name)) as V[]
      return opts.includeDeleted ? all : all.filter(isLive)
    },

    /** Returns `undefined` for a tombstone, as if the record were gone. */
    async get(id: string, opts: ListOptions = {}): Promise<V | undefined> {
      const record = (await (await db()).get(name, id)) as V | undefined
      if (!record) return undefined
      if (!opts.includeDeleted && !isLive(record)) return undefined
      return record
    },

    /** Stamps `id`, `uid` and `updatedAt`, then writes. Returns what was stored. */
    async put(record: V): Promise<V> {
      const stamped = stamp(record)
      await (await db()).put(name, stamped)
      return stamped
    },

    /** One transaction for the whole batch — an import of 500 events is one commit. */
    async putMany(records: V[]): Promise<V[]> {
      if (!records.length) return []
      const stamped = records.map(stamp)
      const tx = (await db()).transaction(name, 'readwrite')
      await Promise.all([...stamped.map((r) => tx.store.put(r)), tx.done])
      return stamped
    },

    /** Soft delete: the record stays, marked, so sync can propagate it. */
    async remove(id: string): Promise<void> {
      const database = await db()
      const existing = (await database.get(name, id)) as V | undefined
      if (!existing) return
      await database.put(name, { ...existing, deletedAt: Date.now(), updatedAt: Date.now() })
    },

    /** Physically drop tombstones older than `maxAgeDays`. The only hard delete. */
    async purge(maxAgeDays = TOMBSTONE_MAX_AGE_DAYS): Promise<number> {
      const cutoff = Date.now() - maxAgeDays * 86_400_000
      const database = await db()
      const tx = database.transaction(name, 'readwrite')
      const doomed = ((await tx.store.getAll()) as V[]).filter(
        (r) => r.deletedAt != null && r.deletedAt < cutoff,
      )
      await Promise.all([...doomed.map((r) => tx.store.delete(r.id)), tx.done])
      return doomed.length
    },

    async clear(): Promise<void> {
      await (await db()).clear(name)
    },

    async count(): Promise<number> {
      return (await db()).count(name)
    },
  }
}

export const calendars = makeStore('calendars')
export const tasks = makeStore('tasks')

const eventStore = makeStore('events')

export const events = {
  ...eventStore,

  /**
   * Events that could produce an occurrence inside [from, to).
   *
   * The `start` index narrows away everything that begins after the window,
   * which is the cheap half. The expensive half cannot be indexed: a weekly
   * event that started two years ago has a `start` far below `from` but still
   * occurs inside the window. So every recurring event survives the filter and
   * is left for the expander to judge. Single events are kept only when they
   * genuinely overlap.
   */
  async inRange(from: Local, to: Local, opts: ListOptions = {}): Promise<CalEvent[]> {
    const database = await db()
    // IDBKeyRange.upperBound is exclusive here: an event starting exactly at
    // `to` is outside a half-open [from, to) window.
    const candidates = await database.getAllFromIndex('events', 'start', IDBKeyRange.upperBound(to, true))
    return candidates.filter((e) => {
      if (!opts.includeDeleted && !isLive(e)) return false
      if (e.rrule) return true
      return e.end > from
    })
  },

  async byUid(uid: string): Promise<CalEvent | undefined> {
    return (await db()).getFromIndex('events', 'uid', uid)
  },

  async byCalendar(calendarId: string, opts: ListOptions = {}): Promise<CalEvent[]> {
    const all = await (await db()).getAllFromIndex('events', 'calendarId', calendarId)
    return opts.includeDeleted ? all : all.filter(isLive)
  },
}

/* -------------------------------- settings -------------------------------- */

export async function getSettings(): Promise<Settings | undefined> {
  const stored = await (await db()).get('settings', SETTINGS_KEY)
  if (!stored) return undefined
  const { id: _id, ...settings } = stored
  return settings
}

export async function putSettings(settings: Settings): Promise<void> {
  await (await db()).put('settings', { ...settings, id: SETTINGS_KEY })
}

/* ---------------------------------- dump ---------------------------------- */

export interface Dump {
  version: number
  exportedAt: number
  calendars: Calendar[]
  events: CalEvent[]
  tasks: Task[]
  settings: Settings | null
}

/** Tombstones are included: a backup that drops them resurrects deleted items. */
export async function exportDump(): Promise<Dump> {
  const [cal, ev, tk, settings] = await Promise.all([
    calendars.list({ includeDeleted: true }),
    eventStore.list({ includeDeleted: true }),
    tasks.list({ includeDeleted: true }),
    getSettings(),
  ])
  return {
    version: DB_VERSION,
    exportedAt: Date.now(),
    calendars: cal,
    events: ev,
    tasks: tk,
    settings: settings ?? null,
  }
}

export type ImportMode = 'replace' | 'merge'

export interface ImportResult {
  calendars: number
  events: number
  tasks: number
  skipped: number
}

/**
 * `replace` wipes first. `merge` keeps whichever copy of a given id has the
 * newer `updatedAt` — the same last-write-wins rule a cloud sync will use, so
 * importing a backup and syncing a device behave identically.
 */
export async function importDump(dump: Dump, mode: ImportMode = 'replace'): Promise<ImportResult> {
  if (!dump || typeof dump !== 'object' || !Array.isArray(dump.events)) {
    throw new Error('Not a Prizma backup: expected an object with an "events" array')
  }
  if (dump.version > DB_VERSION) {
    throw new Error(`Backup version ${dump.version} is newer than this app understands (${DB_VERSION})`)
  }

  const result: ImportResult = { calendars: 0, events: 0, tasks: 0, skipped: 0 }

  if (mode === 'replace') {
    await Promise.all([calendars.clear(), eventStore.clear(), tasks.clear()])
  }

  const database = await db()

  // Written raw, not through put(): a restore must preserve the original
  // `updatedAt`, and stamping would overwrite it with "now" and make every
  // imported record look like the newest version everywhere.
  async function write<S extends RecordStore>(name: S, incoming: ValueOf<S>[], counter: keyof ImportResult) {
    for (const record of incoming) {
      if (!record?.id) {
        result.skipped++
        continue
      }
      if (mode === 'merge') {
        const existing = (await database.get(name, record.id)) as ValueOf<S> | undefined
        if (existing && (existing.updatedAt ?? 0) >= (record.updatedAt ?? 0)) {
          result.skipped++
          continue
        }
      }
      await database.put(name, record)
      result[counter]++
    }
  }

  await write('calendars', dump.calendars ?? [], 'calendars')
  await write('events', dump.events ?? [], 'events')
  await write('tasks', dump.tasks ?? [], 'tasks')

  if (dump.settings) await putSettings(dump.settings)

  return result
}

/** Sweep stale tombstones across every store. Called once at startup. */
export async function purgeAll(maxAgeDays = TOMBSTONE_MAX_AGE_DAYS): Promise<number> {
  const counts = await Promise.all([
    calendars.purge(maxAgeDays),
    eventStore.purge(maxAgeDays),
    tasks.purge(maxAgeDays),
  ])
  return counts.reduce((a, b) => a + b, 0)
}
