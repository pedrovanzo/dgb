import { describe, expect, it } from 'vitest'
import { KeyboardInput } from './keymap.ts'

describe('KeyboardInput', () => {
  it('maps physical keys to buttons', () => {
    const input = new KeyboardInput()
    expect(input.press('ArrowLeft')).toBe(true)
    expect(input.press('KeyX')).toBe(true)
    expect(input.buttons().sort()).toEqual(['a', 'left'])
  })

  it('ignores unbound keys and key repeat', () => {
    const input = new KeyboardInput()
    expect(input.press('KeyQ')).toBe(false)
    input.press('Enter')
    expect(input.press('Enter')).toBe(false)
    expect(input.buttons()).toEqual(['start'])
  })

  it('releases buttons and clears on blur', () => {
    const input = new KeyboardInput()
    input.press('KeyZ')
    input.press('ArrowUp')
    expect(input.release('KeyZ')).toBe(true)
    expect(input.release('KeyZ')).toBe(false)
    expect(input.buttons()).toEqual(['up'])
    expect(input.clear()).toBe(true)
    expect(input.buttons()).toEqual([])
  })
})
