export type ImageDimensions = {width: number; height: number};

const pngSize = (buffer: Buffer): ImageDimensions | undefined => {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(signature)) {
    return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
  }
  return undefined;
};

const webpSize = (buffer: Buffer): ImageDimensions | undefined => {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return undefined;
  }
  const fourcc = buffer.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    return {width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3)};
  }
  if (fourcc === 'VP8 ') {
    return {width: buffer.readUInt16LE(26) & 0x3FFF, height: buffer.readUInt16LE(28) & 0x3FFF};
  }
  if (fourcc === 'VP8L' && buffer.length >= 25) {
    const b0 = buffer[21]; const b1 = buffer[22]; const b2 = buffer[23]; const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3F) << 8) | b0),
      height: 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6)),
    };
  }
  return undefined;
};

const jpegSize = (buffer: Buffer): ImageDimensions | undefined => {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xFF) return undefined;
    let marker = buffer[offset + 1];
    offset += 2;
    while (marker === 0xFF && offset < buffer.length) {
      marker = buffer[offset];
      offset += 1;
    }
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) continue;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return undefined;
    if ((marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC)) {
      return {height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5)};
    }
    offset += length;
  }
  return undefined;
};

export const imageSize = (buffer: Buffer): ImageDimensions => {
  const size = pngSize(buffer) ?? webpSize(buffer) ?? (buffer.length > 4 && buffer[0] === 0xFF && buffer[1] === 0xD8 ? jpegSize(buffer) : undefined);
  if (!size) throw new Error('Unsupported or corrupt image: could not decode dimensions');
  return size;
};
