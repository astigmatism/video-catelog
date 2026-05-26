import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { AppConfig } from './config';

export const PHOTO_THUMBNAIL_MAX_EDGE = 640;
export const PHOTO_THUMBNAIL_MIME_TYPE = 'image/webp';
export const PHOTO_THUMBNAIL_EXTENSION = '.webp';

const PHOTO_THUMBNAIL_QUALITY = 82;
const BMP_FILE_HEADER_LENGTH = 14;
const BMP_INFO_HEADER_MIN_LENGTH = 40;
const BMP_SIGNATURE = 'BM';
const BMP_COMPRESSION_RGB = 0;
const BMP_COMPRESSION_BITFIELDS = 3;
const BMP_COMPRESSION_ALPHA_BITFIELDS = 6;
const BMP_MAX_DECODE_PIXELS = 60_000_000;

export type PhotoImageDimensions = {
  width: number | null;
  height: number | null;
};

export type PhotoThumbnailSourceInput =
  | { sourceBuffer: Buffer; sourcePath?: never }
  | { sourceBuffer?: never; sourcePath: string };

export type GeneratedPhotoThumbnail = {
  absolutePath: string;
  relativePath: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

type BmpHeader = {
  width: number;
  height: number;
  topDown: boolean;
  bitsPerPixel: number;
  compression: number;
  pixelOffset: number;
  dibHeaderSize: number;
  paletteColorCount: number;
};

type BmpPaletteColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

type BmpChannelMasks = {
  red: number;
  green: number;
  blue: number;
  alpha: number | null;
};

type BmpMaskSpec = {
  mask: number;
  shift: number;
  max: number;
};

type DecodedBmpImage = {
  data: Buffer;
  width: number;
  height: number;
  channels: 4;
};

export class UnsupportedPhotoThumbnailSourceError extends Error {
  readonly sourceMessage: string | null;

  constructor(sourceError: unknown) {
    const sourceMessage = sourceError instanceof Error ? sourceError.message : null;
    super(
      sourceMessage
        ? `Photo thumbnail generation could not decode the image source: ${sourceMessage}`
        : 'Photo thumbnail generation could not decode the image source.'
    );
    this.name = 'UnsupportedPhotoThumbnailSourceError';
    this.sourceMessage = sourceMessage;
  }
}

class UnsupportedBmpImageError extends Error {
  constructor(message: string) {
    super(`Unsupported BMP image: ${message}`);
    this.name = 'UnsupportedBmpImageError';
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }

  return String(error ?? '');
}

function isSharpDecodeFailure(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('unsupported image format') ||
    message.includes('input buffer contains unsupported') ||
    message.includes('input file contains unsupported') ||
    message.includes('corrupt') ||
    message.includes('truncated') ||
    message.includes('premature end') ||
    message.includes('invalid image') ||
    message.includes('invalid data') ||
    message.includes('not enough data') ||
    message.includes('not a') ||
    message.includes('bad header')
  );
}

function isImageDecodeFailure(error: unknown): boolean {
  return error instanceof UnsupportedBmpImageError || isSharpDecodeFailure(error);
}

export function isUnsupportedPhotoThumbnailSourceError(
  error: unknown
): error is UnsupportedPhotoThumbnailSourceError {
  return error instanceof UnsupportedPhotoThumbnailSourceError;
}

function resolvePhotoThumbnailSource(input: PhotoThumbnailSourceInput): Buffer | string {
  if (input.sourceBuffer !== undefined) {
    return input.sourceBuffer;
  }

  if (input.sourcePath !== undefined) {
    return input.sourcePath;
  }

  throw new Error('Photo thumbnail generation requires a source buffer or source path.');
}

function readPhotoSourceHeader(input: PhotoThumbnailSourceInput, byteCount: number): Buffer {
  if (input.sourceBuffer !== undefined) {
    return input.sourceBuffer.subarray(0, byteCount);
  }

  if (input.sourcePath !== undefined) {
    const buffer = Buffer.alloc(byteCount);
    const fd = fs.openSync(input.sourcePath, 'r');
    try {
      const bytesRead = fs.readSync(fd, buffer, 0, byteCount, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  }

  throw new Error('Photo thumbnail generation requires a source buffer or source path.');
}

function readPhotoSourceBuffer(input: PhotoThumbnailSourceInput): Buffer {
  if (input.sourceBuffer !== undefined) {
    return input.sourceBuffer;
  }

  if (input.sourcePath !== undefined) {
    return fs.readFileSync(input.sourcePath);
  }

  throw new Error('Photo thumbnail generation requires a source buffer or source path.');
}

function normalizeDimension(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function hasBmpSignature(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === BMP_SIGNATURE;
}

function parseBmpHeader(buffer: Buffer): BmpHeader {
  if (!hasBmpSignature(buffer)) {
    throw new UnsupportedBmpImageError('missing bitmap file signature.');
  }

  if (buffer.length < BMP_FILE_HEADER_LENGTH + BMP_INFO_HEADER_MIN_LENGTH) {
    throw new UnsupportedBmpImageError('file header is truncated.');
  }

  const pixelOffset = buffer.readUInt32LE(10);
  const dibHeaderSize = buffer.readUInt32LE(14);
  if (dibHeaderSize < BMP_INFO_HEADER_MIN_LENGTH) {
    throw new UnsupportedBmpImageError('only Windows BMP headers are supported.');
  }

  const width = buffer.readInt32LE(18);
  const signedHeight = buffer.readInt32LE(22);
  const planes = buffer.readUInt16LE(26);
  const bitsPerPixel = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);
  const paletteColorCount = buffer.readUInt32LE(46);

  if (width <= 0 || signedHeight === 0) {
    throw new UnsupportedBmpImageError('invalid bitmap dimensions.');
  }

  const height = Math.abs(signedHeight);
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > BMP_MAX_DECODE_PIXELS) {
    throw new UnsupportedBmpImageError('bitmap dimensions are too large to process safely.');
  }

  if (planes !== 1) {
    throw new UnsupportedBmpImageError('invalid bitmap color plane count.');
  }

  return {
    width,
    height,
    topDown: signedHeight < 0,
    bitsPerPixel,
    compression,
    pixelOffset,
    dibHeaderSize,
    paletteColorCount
  };
}

function readBmpDimensionsIfPresent(input: PhotoThumbnailSourceInput): PhotoImageDimensions | null {
  const header = readPhotoSourceHeader(input, BMP_FILE_HEADER_LENGTH + BMP_INFO_HEADER_MIN_LENGTH);
  if (!hasBmpSignature(header)) {
    return null;
  }

  const parsed = parseBmpHeader(header);
  return {
    width: parsed.width,
    height: parsed.height
  };
}

function assertSupportedBmpCompression(header: BmpHeader): void {
  if (
    header.compression !== BMP_COMPRESSION_RGB &&
    header.compression !== BMP_COMPRESSION_BITFIELDS &&
    header.compression !== BMP_COMPRESSION_ALPHA_BITFIELDS
  ) {
    throw new UnsupportedBmpImageError('compressed BMP files are not supported.');
  }

  if ([1, 4, 8, 16, 24, 32].includes(header.bitsPerPixel) === false) {
    throw new UnsupportedBmpImageError(`${header.bitsPerPixel}-bit BMP files are not supported.`);
  }

  if (header.bitsPerPixel <= 8 && header.compression !== BMP_COMPRESSION_RGB) {
    throw new UnsupportedBmpImageError('compressed indexed-color BMP files are not supported.');
  }

  if (
    (header.compression === BMP_COMPRESSION_BITFIELDS || header.compression === BMP_COMPRESSION_ALPHA_BITFIELDS) &&
    header.bitsPerPixel !== 16 &&
    header.bitsPerPixel !== 32
  ) {
    throw new UnsupportedBmpImageError('bitfield BMP files must be 16-bit or 32-bit.');
  }
}

function getBmpRowStride(width: number, bitsPerPixel: number): number {
  return Math.floor((width * bitsPerPixel + 31) / 32) * 4;
}

function readBmpPalette(buffer: Buffer, header: BmpHeader): BmpPaletteColor[] {
  const maximumPaletteColors = 2 ** header.bitsPerPixel;
  const paletteColorCount = header.paletteColorCount > 0
    ? Math.min(header.paletteColorCount, maximumPaletteColors)
    : maximumPaletteColors;
  const paletteStart = BMP_FILE_HEADER_LENGTH + header.dibHeaderSize;
  const paletteEnd = paletteStart + paletteColorCount * 4;

  if (paletteStart < BMP_FILE_HEADER_LENGTH || paletteEnd > header.pixelOffset || paletteEnd > buffer.length) {
    throw new UnsupportedBmpImageError('indexed-color palette is truncated.');
  }

  const palette: BmpPaletteColor[] = [];
  for (let index = 0; index < paletteColorCount; index += 1) {
    const entryOffset = paletteStart + index * 4;
    palette.push({
      blue: buffer[entryOffset],
      green: buffer[entryOffset + 1],
      red: buffer[entryOffset + 2],
      alpha: 255
    });
  }

  return palette;
}

function readBmpBitfieldMasks(buffer: Buffer, header: BmpHeader): BmpChannelMasks {
  if (header.compression === BMP_COMPRESSION_RGB) {
    if (header.bitsPerPixel === 16) {
      return {
        red: 0x00007c00,
        green: 0x000003e0,
        blue: 0x0000001f,
        alpha: null
      };
    }

    if (header.bitsPerPixel === 32) {
      return {
        red: 0x00ff0000,
        green: 0x0000ff00,
        blue: 0x000000ff,
        alpha: null
      };
    }
  }

  const maskOffset = BMP_FILE_HEADER_LENGTH + BMP_INFO_HEADER_MIN_LENGTH;
  const requiredMaskBytes = header.compression === BMP_COMPRESSION_ALPHA_BITFIELDS ? 16 : 12;
  if (maskOffset + requiredMaskBytes > buffer.length || maskOffset + requiredMaskBytes > header.pixelOffset) {
    throw new UnsupportedBmpImageError('bitfield channel masks are truncated.');
  }

  const alphaMask = header.compression === BMP_COMPRESSION_ALPHA_BITFIELDS
    ? buffer.readUInt32LE(maskOffset + 12)
    : 0;

  return {
    red: buffer.readUInt32LE(maskOffset),
    green: buffer.readUInt32LE(maskOffset + 4),
    blue: buffer.readUInt32LE(maskOffset + 8),
    alpha: alphaMask === 0 ? null : alphaMask
  };
}

function assertBmpMasksDoNotOverlap(masks: BmpChannelMasks): void {
  const requiredMasks = [masks.red, masks.green, masks.blue];
  if (requiredMasks.some((mask) => mask === 0)) {
    throw new UnsupportedBmpImageError('bitfield channel masks are invalid.');
  }

  const maskValues = masks.alpha === null ? requiredMasks : [...requiredMasks, masks.alpha];
  for (let leftIndex = 0; leftIndex < maskValues.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < maskValues.length; rightIndex += 1) {
      if ((maskValues[leftIndex] & maskValues[rightIndex]) !== 0) {
        throw new UnsupportedBmpImageError('bitfield channel masks overlap.');
      }
    }
  }
}

function createBmpMaskSpec(mask: number): BmpMaskSpec {
  const unsignedMask = mask >>> 0;
  let shift = 0;
  while (shift < 32 && ((unsignedMask >>> shift) & 1) === 0) {
    shift += 1;
  }

  let bitCount = 0;
  while (shift + bitCount < 32 && ((unsignedMask >>> (shift + bitCount)) & 1) === 1) {
    bitCount += 1;
  }

  if (bitCount === 0) {
    throw new UnsupportedBmpImageError('bitfield channel mask is empty.');
  }

  const max = 2 ** bitCount - 1;
  const contiguousMask = (max << shift) >>> 0;
  if (contiguousMask !== unsignedMask) {
    throw new UnsupportedBmpImageError('bitfield channel mask must be contiguous.');
  }

  return {
    mask: unsignedMask,
    shift,
    max
  };
}

function readMaskedBmpChannel(value: number, spec: BmpMaskSpec): number {
  return Math.round((((value & spec.mask) >>> spec.shift) / spec.max) * 255);
}

function writeRgbaPixel(
  output: Buffer,
  offset: number,
  red: number,
  green: number,
  blue: number,
  alpha = 255
): void {
  output[offset] = red;
  output[offset + 1] = green;
  output[offset + 2] = blue;
  output[offset + 3] = alpha;
}

function decodeBmpToRgba(buffer: Buffer): DecodedBmpImage {
  const header = parseBmpHeader(buffer);
  assertSupportedBmpCompression(header);

  if (header.pixelOffset < BMP_FILE_HEADER_LENGTH + header.dibHeaderSize || header.pixelOffset > buffer.length) {
    throw new UnsupportedBmpImageError('pixel data offset is invalid.');
  }

  const rowStride = getBmpRowStride(header.width, header.bitsPerPixel);
  const pixelDataBytes = rowStride * header.height;
  if (
    !Number.isSafeInteger(pixelDataBytes) ||
    header.pixelOffset + pixelDataBytes > buffer.length
  ) {
    throw new UnsupportedBmpImageError('pixel data is truncated.');
  }

  const output = Buffer.alloc(header.width * header.height * 4);
  const palette = header.bitsPerPixel <= 8 ? readBmpPalette(buffer, header) : null;
  const masks = header.bitsPerPixel === 16 || header.bitsPerPixel === 32
    ? readBmpBitfieldMasks(buffer, header)
    : null;
  if (masks) {
    assertBmpMasksDoNotOverlap(masks);
  }
  const redSpec = masks ? createBmpMaskSpec(masks.red) : null;
  const greenSpec = masks ? createBmpMaskSpec(masks.green) : null;
  const blueSpec = masks ? createBmpMaskSpec(masks.blue) : null;
  const alphaSpec = masks?.alpha ? createBmpMaskSpec(masks.alpha) : null;

  for (let y = 0; y < header.height; y += 1) {
    const sourceRow = header.topDown ? y : header.height - 1 - y;
    const rowStart = header.pixelOffset + sourceRow * rowStride;

    for (let x = 0; x < header.width; x += 1) {
      const outputOffset = (y * header.width + x) * 4;

      if (header.bitsPerPixel === 24) {
        const pixelOffset = rowStart + x * 3;
        writeRgbaPixel(output, outputOffset, buffer[pixelOffset + 2], buffer[pixelOffset + 1], buffer[pixelOffset]);
        continue;
      }

      if (header.bitsPerPixel === 32 && redSpec && greenSpec && blueSpec) {
        const value = buffer.readUInt32LE(rowStart + x * 4);
        writeRgbaPixel(
          output,
          outputOffset,
          readMaskedBmpChannel(value, redSpec),
          readMaskedBmpChannel(value, greenSpec),
          readMaskedBmpChannel(value, blueSpec),
          alphaSpec ? readMaskedBmpChannel(value, alphaSpec) : 255
        );
        continue;
      }

      if (header.bitsPerPixel === 16 && redSpec && greenSpec && blueSpec) {
        const value = buffer.readUInt16LE(rowStart + x * 2);
        writeRgbaPixel(
          output,
          outputOffset,
          readMaskedBmpChannel(value, redSpec),
          readMaskedBmpChannel(value, greenSpec),
          readMaskedBmpChannel(value, blueSpec),
          255
        );
        continue;
      }

      if (palette) {
        let paletteIndex: number;
        if (header.bitsPerPixel === 8) {
          paletteIndex = buffer[rowStart + x];
        } else if (header.bitsPerPixel === 4) {
          const packed = buffer[rowStart + Math.floor(x / 2)];
          paletteIndex = x % 2 === 0 ? (packed >> 4) & 0x0f : packed & 0x0f;
        } else {
          const packed = buffer[rowStart + Math.floor(x / 8)];
          paletteIndex = (packed >> (7 - (x % 8))) & 0x01;
        }

        const color = palette[paletteIndex];
        if (!color) {
          throw new UnsupportedBmpImageError('indexed-color pixel references a missing palette entry.');
        }

        writeRgbaPixel(output, outputOffset, color.red, color.green, color.blue, color.alpha);
      }
    }
  }

  return {
    data: output,
    width: header.width,
    height: header.height,
    channels: 4
  };
}

function decodeBmpSourceIfPresent(input: PhotoThumbnailSourceInput): DecodedBmpImage | null {
  const header = readPhotoSourceHeader(input, 2);
  if (!hasBmpSignature(header)) {
    return null;
  }

  return decodeBmpToRgba(readPhotoSourceBuffer(input));
}

function createSharpThumbnailInput(input: PhotoThumbnailSourceInput): sharp.Sharp {
  const bmp = decodeBmpSourceIfPresent(input);
  if (bmp) {
    return sharp(bmp.data, {
      raw: {
        width: bmp.width,
        height: bmp.height,
        channels: bmp.channels
      }
    });
  }

  return sharp(resolvePhotoThumbnailSource(input), { animated: false, failOn: 'none' });
}

export async function readPhotoImageDimensions(input: PhotoThumbnailSourceInput): Promise<PhotoImageDimensions> {
  try {
    const bmpDimensions = readBmpDimensionsIfPresent(input);
    if (bmpDimensions) {
      return bmpDimensions;
    }

    const metadata = await sharp(resolvePhotoThumbnailSource(input), { animated: false, failOn: 'none' }).metadata();
    return {
      width: normalizeDimension(metadata.width),
      height: normalizeDimension(metadata.height)
    };
  } catch (error) {
    if (isImageDecodeFailure(error)) {
      throw new UnsupportedPhotoThumbnailSourceError(error);
    }

    throw error;
  }
}

function normalizeStoredNameForDerivative(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const basename = path.posix.basename(normalized);
  const parsed = path.posix.parse(basename);
  const stem = parsed.name
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);

  return stem === '' ? 'photo' : stem;
}

export function getPhotoOriginalCollectionStorageRoot(config: AppConfig, collectionId: string): string {
  return path.join(config.photoStoreRoot, 'originals', 'collections', collectionId);
}

export function getPhotoThumbnailCollectionStorageRoot(config: AppConfig, collectionId: string): string {
  return path.join(config.photoStoreRoot, 'derivatives', 'thumbnails', 'collections', collectionId);
}

export function getPhotoCollectionStorageRootsForCleanup(config: AppConfig, collectionId: string): string[] {
  return [
    getPhotoOriginalCollectionStorageRoot(config, collectionId),
    getPhotoThumbnailCollectionStorageRoot(config, collectionId),
    path.join(config.mediaStoreRoot, 'photos', collectionId)
  ];
}

export function createPhotoThumbnailStoredName(originalStoredName: string): string {
  return `${normalizeStoredNameForDerivative(originalStoredName)}-thumb${PHOTO_THUMBNAIL_EXTENSION}`;
}

export async function generatePhotoThumbnailFile(input: PhotoThumbnailSourceInput & {
  config: AppConfig;
  collectionId: string;
  thumbnailStoredName: string;
}): Promise<GeneratedPhotoThumbnail> {
  const thumbnailRoot = getPhotoThumbnailCollectionStorageRoot(input.config, input.collectionId);
  fs.mkdirSync(thumbnailRoot, { recursive: true });

  const absolutePath = path.join(thumbnailRoot, input.thumbnailStoredName);
  const temporaryPath = path.join(
    thumbnailRoot,
    `${input.thumbnailStoredName}.${process.pid}.${Date.now()}.tmp`
  );

  let data: Buffer;
  let info: sharp.OutputInfo;

  try {
    const thumbnail = await createSharpThumbnailInput(input)
      .rotate()
      .resize({
        width: PHOTO_THUMBNAIL_MAX_EDGE,
        height: PHOTO_THUMBNAIL_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: PHOTO_THUMBNAIL_QUALITY })
      .toBuffer({ resolveWithObject: true });
    data = thumbnail.data;
    info = thumbnail.info;
  } catch (error) {
    if (isImageDecodeFailure(error)) {
      throw new UnsupportedPhotoThumbnailSourceError(error);
    }

    throw error;
  }

  try {
    fs.writeFileSync(temporaryPath, data, { flag: 'wx' });
    fs.renameSync(temporaryPath, absolutePath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }

  return {
    absolutePath,
    relativePath: path.relative(input.config.mediaRoot, absolutePath),
    storedName: input.thumbnailStoredName,
    mimeType: PHOTO_THUMBNAIL_MIME_TYPE,
    sizeBytes: data.length,
    width: normalizeDimension(info.width),
    height: normalizeDimension(info.height)
  };
}
