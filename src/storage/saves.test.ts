import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { SAVE_HISTORY_LIMIT, SaveStore, sha1Hex } from './saves.ts'

const open = () => SaveStore.open(new IDBFactory())

describe('SaveStore', () => {
  it('returns null for unknown games', async () => {
    const store = await open()
    expect(await store.get('nope')).toBeNull()
    expect(await store.checkpoint('nope')).toBeNull()
  })

  it('stores and overwrites the current save', async () => {
    const store = await open()
    await store.put('abc', 'GAME', Uint8Array.of(1, 2), 10)
    await store.put('abc', 'GAME', Uint8Array.of(3, 4), 20)
    const rec = await store.get('abc')
    expect(rec?.data).toEqual(Uint8Array.of(3, 4))
    expect(rec?.updatedAt).toBe(20)
    expect(rec?.history).toEqual([])
  })

  it('checkpoints sessions into a bounded history without duplicates', async () => {
    const store = await open()
    for (let i = 0; i < SAVE_HISTORY_LIMIT + 2; i++) {
      await store.put('abc', 'GAME', Uint8Array.of(i), i)
      await store.checkpoint('abc')
      await store.checkpoint('abc') // reopening without changes adds nothing
    }
    const rec = await store.get('abc')
    expect(rec?.history.map((v) => v.data[0])).toEqual([6, 5, 4, 3, 2])
  })
})

describe('sha1Hex', () => {
  it('hashes like the SHA-1 reference', async () => {
    expect(await sha1Hex(new TextEncoder().encode('abc'))).toBe(
      'a9993e364706816aba3e25717850c26c9cd0d89d',
    )
  })
})
