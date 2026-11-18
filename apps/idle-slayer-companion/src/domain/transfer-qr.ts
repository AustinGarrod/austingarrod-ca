import qrcode from 'qrcode-generator'

// Version 20 is 97 modules across. Larger transfers keep their link/JSON fallback
// instead of rendering increasingly dense codes in the progress dialog.
export const TRANSFER_QR_MAX_VERSION = 20
export const TRANSFER_QR_MAX_BYTES = 666
export const TRANSFER_QR_QUIET_ZONE = 4

export type TransferQrResult = {
  status: 'ready'
  svg: string
  moduleCount: number
  version: number
} | {
  status: 'too-large'
  maxVersion: typeof TRANSFER_QR_MAX_VERSION
}

/** Encode an already validated transfer link locally; no payload enters markup. */
export function createTransferQr(link: string): TransferQrResult {
  const bytes = new TextEncoder().encode(link)
  // Level M, byte mode, version 20: 3*41 + 13*42 = 669 data codewords,
  // minus the 20-bit mode/length header. The published generator confirms the
  // 666/667-byte boundary; checking first also bounds work on large profiles.
  if (bytes.length > TRANSFER_QR_MAX_BYTES) return { status: 'too-large', maxVersion: TRANSFER_QR_MAX_VERSION }

  const code = qrcode(0, 'M')
  // The package's default byte encoder maps each character to its low byte.
  // Supply UTF-8 bytes explicitly without mutating its shared encoder function.
  code.addData(String.fromCharCode(...bytes), 'Byte')
  code.make()
  const moduleCount = code.getModuleCount()
  const version = (moduleCount - 17) / 4
  if (version > TRANSFER_QR_MAX_VERSION) return { status: 'too-large', maxVersion: TRANSFER_QR_MAX_VERSION }

  const path: string[] = []
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount;) {
      if (!code.isDark(row, col)) { col++; continue }
      const start = col
      while (col < moduleCount && code.isDark(row, col)) col++
      const length = col - start
      path.push(`M${start + TRANSFER_QR_QUIET_ZONE} ${row + TRANSFER_QR_QUIET_ZONE}h${length}v1h-${length}z`)
    }
  }

  const side = moduleCount + TRANSFER_QR_QUIET_ZONE * 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" role="img" aria-label="Progress transfer QR code" shape-rendering="crispEdges"><rect width="${side}" height="${side}" fill="#fff"/><path d="${path.join('')}" fill="#000"/></svg>`
  return { status: 'ready', svg, moduleCount, version }
}
