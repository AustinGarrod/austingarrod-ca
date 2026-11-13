import { describe, expect, it } from 'vitest'
import qrcode from 'qrcode-generator'
import { createTransferQr, TRANSFER_QR_MAX_BYTES, TRANSFER_QR_MAX_VERSION, TRANSFER_QR_QUIET_ZONE } from './transfer-qr'

const link = 'https://austingarrod.github.io/idle-slayer-ascension-map/#progress=v1.example'

describe('local progress transfer QR rendering', () => {
  it('renders the complete byte-mode M matrix with a white four-module quiet zone', () => {
    const rendered = createTransferQr(link)
    expect(rendered.status).toBe('ready')
    if (rendered.status !== 'ready') throw new Error('Expected QR fixture to fit')
    const source = qrcode(0, 'M')
    source.addData(link, 'Byte')
    source.make()
    expect(rendered.moduleCount).toBe(source.getModuleCount())
    expect(rendered.version).toBe((rendered.moduleCount - 17) / 4)
    const side = rendered.moduleCount + 8
    expect(TRANSFER_QR_QUIET_ZONE).toBe(4)
    expect(rendered.svg).toContain(`viewBox="0 0 ${side} ${side}"`)
    expect(rendered.svg).toContain(`<rect width="${side}" height="${side}" fill="#fff"/>`)
    expect(rendered.svg).toContain('shape-rendering="crispEdges"')
    expect(rendered.svg).toContain('fill="#000"')

    const renderedCells = new Set<string>()
    for (const match of rendered.svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const [, x, y, length] = match.map(Number)
      for (let offset = 0; offset < length; offset++) renderedCells.add(`${y - 4},${x + offset - 4}`)
      expect(x).toBeGreaterThanOrEqual(4)
      expect(y).toBeGreaterThanOrEqual(4)
      expect(x + length).toBeLessThanOrEqual(side - 4)
      expect(y + 1).toBeLessThanOrEqual(side - 4)
    }
    for (let row = 0; row < rendered.moduleCount; row++) {
      for (let col = 0; col < rendered.moduleCount; col++) expect(renderedCells.has(`${row},${col}`)).toBe(source.isDark(row, col))
    }
  })

  it('encodes the same link deterministically without inserting payload text or active markup', () => {
    const rendered = createTransferQr(link)
    expect(rendered).toEqual(createTransferQr(link))
    if (rendered.status !== 'ready') throw new Error('Expected QR fixture to fit')
    expect(rendered.svg).not.toContain(link)
    expect(rendered.svg).not.toMatch(/<script|<foreignObject|href=|on\w+=/i)
  })

  it('accepts the version 20 boundary and rejects larger codes before generation', () => {
    const maximum = createTransferQr('a'.repeat(TRANSFER_QR_MAX_BYTES))
    expect(maximum.status).toBe('ready')
    if (maximum.status !== 'ready') throw new Error('Expected maximum QR fixture to fit')
    expect(maximum.version).toBe(TRANSFER_QR_MAX_VERSION)
    expect(maximum.moduleCount).toBe(97)
    expect(createTransferQr('a'.repeat(TRANSFER_QR_MAX_BYTES + 1))).toEqual({ status: 'too-large', maxVersion: 20 })
    expect(createTransferQr('a'.repeat(1_000_000))).toEqual({ status: 'too-large', maxVersion: 20 })
    expect(createTransferQr('é'.repeat(334))).toEqual({ status: 'too-large', maxVersion: 20 })
  })
})
