import NodeClam from 'clamscan';
import { env } from '../../config/env';
import { createLogger } from '../../config/logger';

const log = createLogger('av-scan');

let _scanner: NodeClam | null = null;

async function getScanner() {
  if (!_scanner) {
    _scanner = await new NodeClam().init({
      clamdscan: { host: env.clamscan.host, port: env.clamscan.port, timeout: 60000 },
    });
  }
  return _scanner;
}

/**
 * Mandatory malware scan step before any extraction job touches an upload
 * (architecture doc §13.2, §19.8). If ClamAV is unreachable in a local dev
 * environment, this fails safe by rejecting the file rather than silently
 * skipping the scan — a missing security control should never be invisible.
 */
export async function scanBuffer(buffer: Buffer): Promise<{ clean: boolean; reason?: string }> {
  try {
    const scanner = await getScanner();
    const { isInfected, viruses } = await scanner.scanStream(bufferToStream(buffer));
    if (isInfected) {
      log.warn({ viruses }, 'Upload flagged by AV scan');
      return { clean: false, reason: viruses.join(', ') };
    }
    return { clean: true };
  } catch (err) {
    log.error({ err }, 'AV scan unavailable — failing safe (rejecting upload)');
    return { clean: false, reason: 'AV_SCAN_UNAVAILABLE' };
  }
}

function bufferToStream(buffer: Buffer) {
  const { Readable } = require('stream');
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
