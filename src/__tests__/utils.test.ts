import { describe, it, expect } from 'vitest'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeScore(raw: number, min: number, max: number): number {
  if (max === min) return 0
  return clamp((raw - min) / (max - min), 0, 1)
}

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })
  it('clamps to min', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
  })
  it('clamps to max', () => {
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('normalizeScore', () => {
  it('normalizes a value to [0, 1]', () => {
    expect(normalizeScore(5, 0, 10)).toBe(0.5)
    expect(normalizeScore(0, 0, 10)).toBe(0)
    expect(normalizeScore(10, 0, 10)).toBe(1)
  })
  it('returns 0 when min equals max', () => {
    expect(normalizeScore(5, 5, 5)).toBe(0)
  })
})
