import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:tls';
import { fileURLToPath } from 'node:url';

// Real implicit TLS, real SMTP AUTH/DATA, and the production email-code sender.
// All endpoints, credentials, certificates and recipients are synthetic/local.
// Certificate and hostname verification stay enabled in every scenario.
const root = fileURLToPath(new URL('../', import.meta.url));
const php = process.env.PHP_BINARY || 'php';
const phpDir = execFileSync(php, ['-r', 'echo dirname(PHP_BINARY);'], { encoding: 'utf8' }).trim();
const flags = process.platform === 'win32' ? ['-d', `extension_dir=${join(phpDir, 'ext')}`] : [];
const loaded = execFileSync(php, ['-r', 'echo implode(",",get_loaded_extensions());'], { encoding: 'utf8' }).split(',');
for (const extension of ['openssl', 'curl', 'mbstring']) if (!loaded.includes(extension)) flags.push('-d', `extension=${extension}`);
const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe')
  ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
mkdirSync(join(root, 'tmp'), { recursive: true });
const temporary = mkdtempSync(join(root, 'tmp/accounts-smtp-tls-'));
const certificates = {};
for (const name of ['trusted', 'unrelated']) {
  const key = join(temporary, `${name}.key`), certificate = join(temporary, `${name}.pem`);
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', certificate,
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: ['ignore', 'pipe', 'pipe'] });
  certificates[name] = { key, certificate };
}
const username = 'synthetic@example.test', password = randomBytes(24).toString('hex');
const messages = [], commands = [], sockets = new Set();
let successfulHandshakes = 0, tlsFailures = 0;
const server = createServer({ key: readFileSync(certificates.trusted.key), cert: readFileSync(certificates.trusted.certificate), minVersion: 'TLSv1.2', handshakeTimeout: 500 }, socket => {
  ++successfulHandshakes; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => undefined);
  socket.setEncoding('utf8'); socket.write('220 localhost synthetic SMTP\r\n');
  let buffer = '', auth = 0, authenticated = false, data = false, message = '';
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const at = buffer.indexOf('\r\n'), line = buffer.slice(0, at); buffer = buffer.slice(at + 2);
      if (data) {
        if (line === '.') { messages.push(message); message = ''; data = false; socket.write('250 queued\r\n'); }
        else message += (line.startsWith('..') ? line.slice(1) : line) + '\n';
      } else if (auth === 1) {
        auth = 2; authenticated = Buffer.from(line, 'base64').toString() === username; socket.write('334 UGFzc3dvcmQ6\r\n');
      } else if (auth === 2) {
        auth = 0; authenticated &&= Buffer.from(line, 'base64').toString() === password;
        socket.write(authenticated ? '235 authenticated\r\n' : '535 rejected\r\n');
      } else if (/^(EHLO|HELO) /i.test(line)) { commands.push('EHLO'); socket.write('250-localhost\r\n250-AUTH LOGIN\r\n250 SIZE 10485760\r\n'); }
      else if (line === 'AUTH LOGIN') { commands.push('AUTH'); auth = 1; socket.write('334 VXNlcm5hbWU6\r\n'); }
      else if (/^MAIL FROM:/i.test(line)) { commands.push('MAIL'); socket.write(authenticated ? '250 sender accepted\r\n' : '530 authenticate first\r\n'); }
      else if (/^RCPT TO:/i.test(line)) { commands.push('RCPT'); socket.write(authenticated ? '250 recipient accepted\r\n' : '530 authenticate first\r\n'); }
      else if (line === 'DATA' && authenticated) { commands.push('DATA'); data = true; socket.write('354 send message\r\n'); }
      else if (line === 'QUIT') { commands.push('QUIT'); socket.end('221 bye\r\n'); }
      else if (line === 'RSET') socket.write('250 reset\r\n');
      else socket.write('500 unsupported\r\n');
    }
  });
});
server.on('tlsClientError', () => { ++tlsFailures; });
// The baseline never negotiates TLS, so it is not in the secure-connection set.
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixture = join(temporary, 'fixture.json');
writeFileSync(fixture, JSON.stringify({ smtp: { host: '127.0.0.1', port: server.address().port, encryption: 'smtps', username, password, from: username } }));
async function send(mode, ca) {
  const child = spawn(php, [...flags, '-d', `openssl.cafile=${ca}`, join(root, 'tests/accounts/smtp-tls.test.php'), fixture, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); }); child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const timer = setTimeout(() => child.kill(), 15_000);
  const code = await new Promise(resolve => child.once('exit', resolve)); clearTimeout(timer);
  assert.equal(code, 0, 'Local SMTP caller must exit normally without diagnostics');
  assert.equal(stderr, '', 'SMTP caller must not print error details');
  return JSON.parse(stdout);
}
function deliveredAlternatives(message) {
  const separator = message.indexOf('\n\n');
  assert.ok(separator >= 0, 'Delivered MIME must separate headers and body');
  const headers = message.slice(0, separator).replace(/\n[ \t]+/g, ' ');
  assert.match(headers, /Content-Type:\s*multipart\/alternative;/i);
  const boundary = headers.match(/boundary="([^"\n]+)"/i)?.[1];
  assert.ok(boundary, 'Delivered multipart MIME must declare its boundary');
  const parts = message.slice(separator + 2).split(`--${boundary}`).slice(1).filter(part => !part.startsWith('--'));
  assert.equal(parts.length, 2, 'Code email must deliver one plain and one HTML alternative');
  return Object.fromEntries(parts.map(part => {
    part = part.replace(/^\n/, '');
    const split = part.indexOf('\n\n'); assert.ok(split >= 0, 'Each MIME alternative needs headers');
    const head = part.slice(0, split).replace(/\n[ \t]+/g, ' '), type = head.match(/Content-Type:\s*([^;\s]+)/i)?.[1]?.toLowerCase();
    const encoding = head.match(/Content-Transfer-Encoding:\s*(\S+)/i)?.[1]?.toLowerCase() || '7bit';
    let body = part.slice(split + 2);
    if (encoding === 'base64') body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
    else if (encoding === 'quoted-printable') body = Buffer.from(body.replace(/=\n/g, '').replace(/=([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8');
    else assert.ok(['7bit', '8bit', 'binary'].includes(encoding), 'Unsupported MIME transfer encoding');
    return [type, body.replace(/\r\n/g, '\n').replace(/\n+$/, '\n')];
  }));
}
try {
  assert.deepEqual(await send('unmapped-baseline', certificates.trusted.certificate), { sent: false }, 'The former config spelling must fail against an implicit TLS server');
  assert.equal(messages.length, 0); assert.equal(successfulHandshakes, 0); assert.equal(commands.length, 0);
  assert.deepEqual(await send('production', certificates.trusted.certificate), { sent: true }, 'Production sender must negotiate trusted TLS and deliver a code');
  assert.equal(messages.length, 1); assert.equal(successfulHandshakes, 1);
  assert.ok(commands.includes('AUTH') && commands.includes('DATA') && commands.includes('QUIT'));
  assert.ok(messages[0].includes('To: sink@example.test'));
  const alternatives = deliveredAlternatives(messages[0]);
  assert.deepEqual(Object.keys(alternatives).sort(), ['text/html', 'text/plain']);
  const plain = 'Your sign-in code is: 024691\n\nIt expires in 10 minutes and can be used once.\nIf you did not request it, you can ignore this email.\n';
  assert.ok(alternatives['text/plain'] === plain, 'Delivered plain alternative must preserve the original text and leading-zero code');
  const html = alternatives['text/html'];
  assert.ok(html.includes('024691') && html.includes('10 minutes') && html.includes('can be used once'), 'Delivered HTML must carry the same code and expiry');
  assert.doesNotMatch(html, /<(?:img|script|iframe|object|embed|link|source|video|audio|form)\b|@import\b|\burl\s*\(/i, 'Code email must not fetch remote assets or tracking resources');
  const urls = [...html.matchAll(/(?:href|src|action|background)\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  assert.deepEqual(urls.sort(), ['https://austingarrod.ca/', 'https://austingarrod.ca/account/privacy/']);
  assert.ok(urls.every(url => !url.includes('024691') && !new URL(url).search && !new URL(url).hash), 'Email URLs must contain no sign-in code or tracking parameters');
  const beforeInvalid = { messages: messages.length, commands: commands.length, handshakes: successfulHandshakes };
  assert.deepEqual(await send('invalid-code', certificates.trusted.certificate), { sent: false }, 'An invalid code must fail before SMTP transmission');
  assert.equal(messages.length, beforeInvalid.messages); assert.equal(commands.length, beforeInvalid.commands); assert.equal(successfulHandshakes, beforeInvalid.handshakes);
  const before = { messages: messages.length, commands: commands.length };
  assert.deepEqual(await send('production', certificates.unrelated.certificate), { sent: false }, 'An untrusted server certificate must be rejected');
  assert.equal(messages.length, before.messages, 'A failed TLS verification must never transmit the code');
  assert.equal(commands.length, before.commands, 'A failed TLS verification must send neither credentials nor SMTP DATA');
  assert.ok(tlsFailures >= 1);
  console.log('Accounts SMTP TLS: trusted multipart HTML/plain delivery passed, leading-zero code preserved, no tracking assets or code URLs, invalid code and untrusted certificate rejected before transmission.');
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
}
