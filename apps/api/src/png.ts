import {deflateSync} from 'node:zlib';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf: Buffer): number => {
  let c = 0xFFFFFFFF;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
};

const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export const encodePng = (width: number, height: number, rgba: Buffer): Buffer => {
  if (rgba.length !== width * height * 4) throw new Error('RGBA buffer size does not match dimensions');
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    rgba.copy(raw, row * stride + 1, row * width * 4, (row + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([pngSignature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

export const solidMaskPng = (width: number, height: number): Buffer =>
  encodePng(width, height, Buffer.alloc(width * height * 4, 255));
