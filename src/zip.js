// zip.js — minimal "stored" (uncompressed) ZIP encoder, zero dependencies.
// Sufficient for our use case: ship a handful of small text files in one
// .zip download. Format references: PKWARE APPNOTE.TXT, sections 4.3.7–4.3.16.

const SIG_LFH  = 0x04034b50;  // local file header
const SIG_CD   = 0x02014b50;  // central directory entry
const SIG_EOCD = 0x06054b50;  // end of central directory

// CRC-32 (polynomial 0xEDB88320, PKZip-standard).
let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[i] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ bytes[i]) & 0xFF];
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTimestamp(d = new Date()) {
  const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
  const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
  return { time, date };
}

// files: [{name: string, content: string | Uint8Array}, ...]
// Returns a Blob with MIME application/zip.
export function createZip(files) {
  const encoder = new TextEncoder();
  const { time, date } = dosTimestamp();
  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const f of files) {
    const data = f.content instanceof Uint8Array ? f.content : encoder.encode(f.content);
    const nameBytes = encoder.encode(f.name);
    const crc = crc32(data);

    // Local file header (30 + nameLen bytes)
    const lfh = new ArrayBuffer(30 + nameBytes.length);
    const v = new DataView(lfh);
    v.setUint32(0,  SIG_LFH, true);
    v.setUint16(4,  20, true);             // version needed
    v.setUint16(6,  0, true);              // flags
    v.setUint16(8,  0, true);              // method = stored
    v.setUint16(10, time, true);
    v.setUint16(12, date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);    // compressed size
    v.setUint32(22, data.length, true);    // uncompressed size
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);              // extra field length
    new Uint8Array(lfh, 30).set(nameBytes);

    parts.push(new Uint8Array(lfh));
    parts.push(data);

    centralDir.push({ name: nameBytes, crc, size: data.length, offset });
    offset += 30 + nameBytes.length + data.length;
  }

  const cdStart = offset;
  for (const e of centralDir) {
    // Central directory entry (46 + nameLen bytes)
    const cd = new ArrayBuffer(46 + e.name.length);
    const v = new DataView(cd);
    v.setUint32(0,  SIG_CD, true);
    v.setUint16(4,  20, true);
    v.setUint16(6,  20, true);
    v.setUint16(8,  0, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, time, true);
    v.setUint16(14, date, true);
    v.setUint32(16, e.crc, true);
    v.setUint32(20, e.size, true);
    v.setUint32(24, e.size, true);
    v.setUint16(28, e.name.length, true);
    v.setUint16(30, 0, true);
    v.setUint16(32, 0, true);
    v.setUint16(34, 0, true);
    v.setUint16(36, 0, true);
    v.setUint32(38, 0, true);
    v.setUint32(42, e.offset, true);
    new Uint8Array(cd, 46).set(e.name);
    parts.push(new Uint8Array(cd));
    offset += 46 + e.name.length;
  }

  // End of central directory (22 bytes)
  const eocd = new ArrayBuffer(22);
  const v = new DataView(eocd);
  v.setUint32(0,  SIG_EOCD, true);
  v.setUint16(4,  0, true);
  v.setUint16(6,  0, true);
  v.setUint16(8,  centralDir.length, true);
  v.setUint16(10, centralDir.length, true);
  v.setUint32(12, offset - cdStart, true);
  v.setUint32(16, cdStart, true);
  v.setUint16(20, 0, true);
  parts.push(new Uint8Array(eocd));

  return new Blob(parts, { type: 'application/zip' });
}
