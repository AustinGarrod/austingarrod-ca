// Node 24 runs the shared TypeScript validator directly; no loader or new dependency.
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { noticeHash, readNoticeManifest, renderNoticeIndex, validateNoticeSources } from './runtime-notices.ts'

const usage = 'Usage: node scripts/maintain-runtime-notices.mjs <check|refresh>'
const mode = process.argv[2]
if (process.argv.length !== 3 || !['check', 'refresh'].includes(mode)) {
  console.error(usage)
  process.exitCode = 1
} else {
  try {
    maintain(process.cwd(), mode)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function maintain(root, operation) {
  const manifest = readNoticeManifest(root)
  const directory = resolve(root, 'public/licenses')
  const copies = []
  const names = new Set(), files = new Set()
  // Preflight every reviewed identity, metadata field and complete source before
  // writing anything. Hashes alone are mechanical; the remaining fields are human input.
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages) || !manifest.packages.length) {
    throw new Error('Invalid runtime notice manifest.')
  }
  for (const item of manifest.packages) {
    if (!item || typeof item.name !== 'string' || !/^(?:@[a-z0-9][a-z0-9_.-]*\/)?[a-z0-9][a-z0-9_.-]*$/.test(item.name)
      || names.has(item.name) || typeof item.version !== 'string' || !item.version.trim()
      || typeof item.license !== 'string' || !item.license.trim() || !['module', 'embedded', 'helper'].includes(item.inclusion)
      || !Array.isArray(item.notices) || !item.notices.length) {
      throw new Error('Invalid or duplicate reviewed runtime notice identity.')
    }
    names.add(item.name)
    const installed = JSON.parse(readFileSync(resolve(root, 'node_modules', item.name, 'package.json'), 'utf8'))
    if (installed.version !== item.version || installed.license !== item.license) {
      throw new Error(`Review required for ${item.name}: manifest version ${item.version}, license ${item.license}; installed version ${installed.version}, license ${installed.license}. Review the upstream package and complete notices, then edit public/licenses/notices.json. Refresh never approves or changes versions, licenses, inclusion kinds or source filenames.`)
    }
    for (const notice of item.notices) {
      if (!notice || !['LICENSE', 'LICENSE.md', 'THIRD-PARTY-LICENSE'].includes(notice.source)
        || typeof notice.file !== 'string' || !/^[a-zA-Z0-9_-]+\.txt$/.test(notice.file) || files.has(notice.file.toLowerCase())
        || typeof notice.sha256 !== 'string' || !/^(?:[a-f0-9]{64})?$/.test(notice.sha256)) {
        throw new Error('Invalid or duplicate reviewed notice file: ' + item.name)
      }
      // Windows aliases ASCII case variants; reject them before planning any writes.
      files.add(notice.file.toLowerCase())
      const bytes = readFileSync(resolve(root, 'node_modules', item.name, notice.source))
      if (!bytes.length) throw new Error('Empty upstream notice: ' + item.name + '/' + notice.source)
      copies.push({ file: notice.file, bytes })
      if (operation === 'refresh') notice.sha256 = noticeHash(bytes)
    }
  }
  for (const font of manifest.fonts ?? []) {
    if (!/^src\/assets\/fonts\/[a-z0-9.-]+\.woff2$/.test(font.source)
      || !/^src\/assets\/fonts\/[a-zA-Z0-9_-]+\.txt$/.test(font.notice.source)
      || !/^[a-zA-Z0-9_-]+\.txt$/.test(font.notice.file) || files.has(font.notice.file.toLowerCase())) throw new Error('Invalid or duplicate local font notice.')
    if (noticeHash(readFileSync(resolve(root, font.source))) !== font.sha256) throw new Error('Review required for changed local font: ' + font.name)
    const bytes = readFileSync(resolve(root, font.notice.source))
    files.add(font.notice.file.toLowerCase()); copies.push({ file: font.notice.file, bytes })
    if (operation === 'refresh') font.notice.sha256 = noticeHash(bytes)
  }
  const existingNotices = readdirSync(directory).filter((file) => file.toLowerCase().endsWith('.txt'))
  for (const existing of existingNotices) {
    const reviewed = copies.find((copy) => copy.file.toLowerCase() === existing.toLowerCase())
    if (reviewed && reviewed.file !== existing) {
      throw new Error(`Case-only notice filename changes require manual rename review: ${existing} -> ${reviewed.file}. Rename the reviewed copy explicitly before running check or refresh.`)
    }
  }
  const unused = existingNotices.filter((file) => !files.has(file.toLowerCase())).sort()
  if (unused.length) {
    throw new Error('Unreferenced notice files require manual removal review: ' + unused.join(', ') + '. Remove only the confirmed obsolete files from public/licenses, then rerun.')
  }
  if (operation === 'check') {
    validateNoticeSources(root, manifest)
    console.log(`Notice check passed: ${manifest.packages.length} reviewed packages and ${copies.length} complete upstream notices. Run yarn build and yarn check:release to verify actual bundle coverage and distribution.`)
    return
  }
  const outputs = [
    ...copies,
    { file: 'notices.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
    { file: 'index.html', bytes: Buffer.from(renderNoticeIndex(manifest)) },
  ]
  // Refuse redirected destinations, and inspect the whole plan before any writes.
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Notice directory must be a real directory.')
  for (const output of outputs) {
    const destination = resolve(directory, output.file)
    try {
      if (!lstatSync(destination).isFile() || lstatSync(destination).isSymbolicLink()) throw new Error('Notice destination must be a regular file: ' + output.file)
      output.changed = !readFileSync(destination).equals(output.bytes)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      output.changed = true
    }
  }
  for (const output of outputs.filter((item) => item.changed)) {
    writeFileSync(resolve(directory, output.file), output.bytes)
    console.log('Updated public/licenses/' + output.file)
  }
  validateNoticeSources(root, manifest)
  console.log(`Refreshed ${manifest.packages.length} reviewed packages and ${copies.length} complete upstream notices; ${outputs.filter((item) => item.changed).length} files changed. Review git diff, then run yarn build and yarn check:release. License approval remains a human responsibility.`)
}
