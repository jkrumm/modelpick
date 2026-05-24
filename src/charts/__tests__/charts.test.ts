import { describe, expect, it } from 'vitest'
import { VX } from '../tokens'
import { fmtAxisDate, fmtTooltipDate } from '../utils/format'
import { smartTicks } from '../utils/ticks'

describe('VX tokens', () => {
  it('has all required semantic keys', () => {
    expect(VX.lineDark).toBeDefined()
    expect(VX.lineLight).toBeDefined()
    expect(VX.good).toBeDefined()
    expect(VX.bad).toBeDefined()
    expect(VX.warn).toBeDefined()
    expect(VX.goodSolid).toBeDefined()
    expect(VX.badSolid).toBeDefined()
    expect(VX.warnSolid).toBeDefined()
    expect(VX.grid).toBeDefined()
    expect(VX.crosshair).toBeDefined()
    expect(VX.margin).toBeDefined()
    expect(VX.minPxPerTick).toBeDefined()
  })

  it('has modelpick series colors', () => {
    expect(VX.series.quality).toBeDefined()
    expect(VX.series.cost).toBeDefined()
    expect(VX.series.speed).toBeDefined()
    expect(VX.series.anthropic).toBeDefined()
    expect(VX.series.openai).toBeDefined()
    expect(VX.series.eu).toBeDefined()
    expect(VX.series.us).toBeDefined()
  })

  it('dark/light pairs both exist', () => {
    expect(VX.lineDark).not.toEqual(VX.lineLight)
    expect(VX.tooltipBgDark).not.toEqual(VX.tooltipBgLight)
    expect(VX.axisDark).not.toEqual(VX.axisLight)
  })

  it('axisFont is a number', () => {
    expect(typeof VX.axisFont).toBe('number')
    expect(VX.axisFont).toBeGreaterThan(0)
  })

  it('margin has all sides', () => {
    expect(VX.margin.top).toBeDefined()
    expect(VX.margin.right).toBeDefined()
    expect(VX.margin.bottom).toBeDefined()
    expect(VX.margin.left).toBeDefined()
  })
})

describe('fmtAxisDate', () => {
  it('formats ISO date string as DD.MM', () => {
    expect(fmtAxisDate('2026-04-15')).toBe('15.04')
  })

  it('formats Date object as DD.MM', () => {
    expect(fmtAxisDate(new Date(2026, 3, 5))).toBe('05.04')
  })

  it('passes through unknown strings', () => {
    expect(fmtAxisDate('Q1 2026')).toBe('Q1 2026')
  })

  it('handles null/undefined gracefully', () => {
    expect(fmtAxisDate(null)).toBe('')
    expect(fmtAxisDate(undefined)).toBe('')
  })
})

describe('fmtTooltipDate', () => {
  it('formats ISO date string as long date', () => {
    const result = fmtTooltipDate('2026-04-21')
    expect(result).toContain('2026')
    expect(result).toContain('Apr')
    expect(result).toContain('21')
  })

  it('formats Date object as long date', () => {
    const result = fmtTooltipDate(new Date(2026, 0, 1))
    expect(result).toContain('2026')
    expect(result).toContain('Jan')
    expect(result).toContain('1')
  })

  it('passes through unknown strings', () => {
    expect(fmtTooltipDate('custom string')).toBe('custom string')
  })
})

describe('smartTicks', () => {
  it('returns empty array for empty input', () => {
    expect(smartTicks([], 600)).toEqual([])
  })

  it('returns all dates when they fit', () => {
    const dates = ['2026-01-01', '2026-01-02', '2026-01-03']
    expect(smartTicks(dates, 600)).toEqual(dates)
  })

  it('subsamples when there are too many dates', () => {
    const dates = Array.from({ length: 60 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`)
    const result = smartTicks(dates, 300)
    expect(result.length).toBeLessThan(dates.length)
    expect(result[0]).toBe(dates[0])
    expect(result[result.length - 1]).toBe(dates[dates.length - 1])
  })

  it('always includes first and last', () => {
    const dates = Array.from({ length: 100 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`)
    const result = smartTicks(dates, 200)
    expect(result[0]).toBe(dates[0])
    expect(result[result.length - 1]).toBe(dates[dates.length - 1])
  })

  it('returns at least 2 ticks for large xMax', () => {
    const dates = ['2026-01-01', '2026-02-01']
    expect(smartTicks(dates, 10)).toHaveLength(2)
  })
})
