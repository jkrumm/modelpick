import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VxThemeProvider, useVxTheme } from '../theme'
import { ChartCard } from '../primitives/ChartCard'
import { ChartLegend } from '../primitives/ChartLegend'
import { ChartTooltip, TooltipBody, TooltipHeader, TooltipRow } from '../primitives/ChartTooltip'
import { LineSparkline } from '../sparklines/LineSparkline'
import { BarSparkline } from '../sparklines/BarSparkline'

afterEach(cleanup)

function DarkWrapper({ children }: { children: React.ReactNode }) {
  return <VxThemeProvider colorScheme="dark">{children}</VxThemeProvider>
}

function LightWrapper({ children }: { children: React.ReactNode }) {
  return <VxThemeProvider colorScheme="light">{children}</VxThemeProvider>
}

describe('ChartCard', () => {
  it('renders title and children in dark mode', () => {
    render(
      <DarkWrapper>
        <ChartCard title="Quality Trend" tooltip="Model quality over time">
          <div>chart content</div>
        </ChartCard>
      </DarkWrapper>,
    )
    expect(screen.getByText('Quality Trend')).toBeDefined()
    expect(screen.getByText('chart content')).toBeDefined()
  })

  it('renders title and children in light mode', () => {
    render(
      <LightWrapper>
        <ChartCard title="Cost Trend" tooltip="Cost over time">
          <div>cost chart</div>
        </ChartCard>
      </LightWrapper>,
    )
    expect(screen.getByText('Cost Trend')).toBeDefined()
  })

  it('renders subtitle when provided', () => {
    render(
      <DarkWrapper>
        <ChartCard title="Throughput" subtitle="Tokens per second" tooltip="Throughput metric">
          <div />
        </ChartCard>
      </DarkWrapper>,
    )
    expect(screen.getByText('Tokens per second')).toBeDefined()
  })

  it('renders extra slot when provided', () => {
    render(
      <DarkWrapper>
        <ChartCard title="Chart" tooltip="info" extra={<span>badge</span>}>
          <div />
        </ChartCard>
      </DarkWrapper>,
    )
    expect(screen.getByText('badge')).toBeDefined()
  })
})

describe('ChartLegend', () => {
  const items = [
    { key: 'quality', label: 'Quality', color: '#aa00ff' },
    { key: 'cost', label: 'Cost', color: '#00b894', shape: 'bar' as const },
    { key: 'trend', label: 'Trend', color: '#1677ff', shape: 'line' as const },
  ]

  it('renders all legend labels', () => {
    render(<ChartLegend items={items} />)
    expect(screen.getByText('Quality')).toBeDefined()
    expect(screen.getByText('Cost')).toBeDefined()
    expect(screen.getByText('Trend')).toBeDefined()
  })

  it('renders without highlighted prop', () => {
    render(<ChartLegend items={items} />)
    expect(screen.getByText('Quality')).toBeDefined()
  })

  it('renders with highlighted item', () => {
    render(<ChartLegend items={items} highlighted="quality" />)
    expect(screen.getByText('Quality')).toBeDefined()
  })

  it('renders split shape', () => {
    const splitItems = [
      { key: 'a', label: 'Split', color: '#ff0000', secondColor: '#0000ff', shape: 'split' as const },
    ]
    render(<ChartLegend items={splitItems} />)
    expect(screen.getByText('Split')).toBeDefined()
  })

  it('renders splitLine shape', () => {
    const splitLineItems = [
      { key: 'b', label: 'SplitLine', color: '#ff0000', secondColor: '#0000ff', shape: 'splitLine' as const },
    ]
    render(<ChartLegend items={splitLineItems} />)
    expect(screen.getByText('SplitLine')).toBeDefined()
  })
})

describe('ChartTooltip + subcomponents', () => {
  it('renders nothing when tip is null', () => {
    const { container } = render(
      <DarkWrapper>
        <ChartTooltip tip={null} styles={{}}>
          <div>content</div>
        </ChartTooltip>
      </DarkWrapper>,
    )
    expect(container.querySelector('[style*="fixed"]')).toBeNull()
  })

  it('renders content when tip is provided', () => {
    render(
      <DarkWrapper>
        <ChartTooltip tip={{ x: 100, y: 200 }} styles={{ position: 'fixed' }}>
          <div>tooltip content</div>
        </ChartTooltip>
      </DarkWrapper>,
    )
    expect(screen.getByText('tooltip content')).toBeDefined()
  })

  it('renders TooltipHeader with date', () => {
    render(
      <DarkWrapper>
        <TooltipHeader date="2026-04-21" />
      </DarkWrapper>,
    )
    expect(screen.getByText(/Apr/)).toBeDefined()
  })

  it('renders TooltipHeader with label', () => {
    render(
      <DarkWrapper>
        <TooltipHeader date="2026-04-21" label="EU" labelColor="#00b894" />
      </DarkWrapper>,
    )
    expect(screen.getByText('EU')).toBeDefined()
  })

  it('renders TooltipRow', () => {
    render(
      <DarkWrapper>
        <TooltipRow color="#aa00ff" label="Quality" value="0.85" />
      </DarkWrapper>,
    )
    expect(screen.getByText('Quality')).toBeDefined()
    expect(screen.getByText('0.85')).toBeDefined()
  })

  it('renders TooltipRow with line shape', () => {
    render(
      <DarkWrapper>
        <TooltipRow color="#1677ff" label="Throughput" value="120 t/s" shape="line" />
      </DarkWrapper>,
    )
    expect(screen.getByText('Throughput')).toBeDefined()
  })

  it('renders TooltipBody', () => {
    render(
      <DarkWrapper>
        <TooltipBody>
          <span>body content</span>
        </TooltipBody>
      </DarkWrapper>,
    )
    expect(screen.getByText('body content')).toBeDefined()
  })
})

describe('LineSparkline', () => {
  it('renders an svg', () => {
    const { container } = render(
      <DarkWrapper>
        <LineSparkline data={[1, 2, 3, 4, 5]} width={100} height={30} />
      </DarkWrapper>,
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders empty svg for < 2 data points', () => {
    const { container } = render(
      <DarkWrapper>
        <LineSparkline data={[1]} width={100} height={30} />
      </DarkWrapper>,
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('accepts custom color', () => {
    const { container } = render(
      <DarkWrapper>
        <LineSparkline data={[1, 2, 3]} width={100} height={30} color="#aa00ff" />
      </DarkWrapper>,
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('BarSparkline', () => {
  it('renders an svg', () => {
    const { container } = render(
      <DarkWrapper>
        <BarSparkline data={[1, 2, 3, 4, 5]} width={100} height={30} />
      </DarkWrapper>,
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders empty svg for empty data', () => {
    const { container } = render(
      <DarkWrapper>
        <BarSparkline data={[]} width={100} height={30} />
      </DarkWrapper>,
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('VxThemeProvider theme resolution', () => {
  it('resolves dark theme line color', () => {
    let capturedLine = ''
    function ThemeCapture() {
      const theme = useVxTheme()
      capturedLine = theme.line
      return null
    }
    render(
      <DarkWrapper>
        <ThemeCapture />
      </DarkWrapper>,
    )
    expect(capturedLine).toBe('#c9d1d9')
  })

  it('resolves light theme line color', () => {
    let capturedLine = ''
    function ThemeCapture() {
      const theme = useVxTheme()
      capturedLine = theme.line
      return null
    }
    render(
      <LightWrapper>
        <ThemeCapture />
      </LightWrapper>,
    )
    expect(capturedLine).toBe('#57606a')
  })

  it('dark tooltip background differs from light', () => {
    let darkBg = ''
    let lightBg = ''
    function CaptureTheme({ setter }: { setter: (v: string) => void }) {
      const theme = useVxTheme()
      setter(theme.tooltipBg)
      return null
    }
    render(
      <DarkWrapper>
        <CaptureTheme setter={(v) => { darkBg = v }} />
      </DarkWrapper>,
    )
    cleanup()
    render(
      <LightWrapper>
        <CaptureTheme setter={(v) => { lightBg = v }} />
      </LightWrapper>,
    )
    expect(darkBg).not.toBe('')
    expect(lightBg).not.toBe('')
    expect(darkBg).not.toBe(lightBg)
  })
})
