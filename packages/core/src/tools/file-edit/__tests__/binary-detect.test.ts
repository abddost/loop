/**
 * Unit tests for binary file detection.
 */

import { describe, test, expect } from 'bun:test';
import {
  isBinaryByExtension,
  isBinaryByContent,
  isImageByExtension,
  describeBinaryFile,
} from '../binary-detect';

describe('isBinaryByExtension', () => {
  test('detects common binary extensions', () => {
    expect(isBinaryByExtension('file.exe')).toBe(true);
    expect(isBinaryByExtension('file.dll')).toBe(true);
    expect(isBinaryByExtension('file.png')).toBe(true);
    expect(isBinaryByExtension('file.jpg')).toBe(true);
    expect(isBinaryByExtension('file.zip')).toBe(true);
    expect(isBinaryByExtension('file.pdf')).toBe(true);
    expect(isBinaryByExtension('file.mp4')).toBe(true);
    expect(isBinaryByExtension('file.wasm')).toBe(true);
    expect(isBinaryByExtension('file.ttf')).toBe(true);
    expect(isBinaryByExtension('file.sqlite')).toBe(true);
  });

  test('does not detect text file extensions', () => {
    expect(isBinaryByExtension('file.ts')).toBe(false);
    expect(isBinaryByExtension('file.js')).toBe(false);
    expect(isBinaryByExtension('file.py')).toBe(false);
    expect(isBinaryByExtension('file.md')).toBe(false);
    expect(isBinaryByExtension('file.json')).toBe(false);
    expect(isBinaryByExtension('file.html')).toBe(false);
    expect(isBinaryByExtension('file.css')).toBe(false);
    expect(isBinaryByExtension('file.yaml')).toBe(false);
    expect(isBinaryByExtension('file.txt')).toBe(false);
    expect(isBinaryByExtension('file.xml')).toBe(false);
  });

  test('handles uppercase extensions', () => {
    expect(isBinaryByExtension('file.PNG')).toBe(true);
    expect(isBinaryByExtension('file.JPG')).toBe(true);
    expect(isBinaryByExtension('file.EXE')).toBe(true);
  });

  test('handles files with no extension', () => {
    expect(isBinaryByExtension('Makefile')).toBe(false);
    expect(isBinaryByExtension('.gitignore')).toBe(false);
  });

  test('handles full paths', () => {
    expect(isBinaryByExtension('/path/to/file.png')).toBe(true);
    expect(isBinaryByExtension('/path/to/file.ts')).toBe(false);
  });
});

describe('isImageByExtension', () => {
  test('detects image extensions', () => {
    expect(isImageByExtension('file.png')).toBe(true);
    expect(isImageByExtension('file.jpg')).toBe(true);
    expect(isImageByExtension('file.jpeg')).toBe(true);
    expect(isImageByExtension('file.gif')).toBe(true);
    expect(isImageByExtension('file.webp')).toBe(true);
    expect(isImageByExtension('file.svg')).toBe(true);
  });

  test('does not detect non-image binary extensions', () => {
    expect(isImageByExtension('file.exe')).toBe(false);
    expect(isImageByExtension('file.zip')).toBe(false);
    expect(isImageByExtension('file.mp4')).toBe(false);
  });
});

describe('isBinaryByContent', () => {
  test('detects null bytes as binary', () => {
    const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]); // "Hel\0o"
    expect(isBinaryByContent(buffer)).toBe(true);
  });

  test('detects high non-printable ratio as binary', () => {
    const buffer = Buffer.alloc(100);
    // Fill with non-printable characters (0x01-0x08)
    for (let i = 0; i < 100; i++) buffer[i] = (i % 8) + 1;
    expect(isBinaryByContent(buffer)).toBe(true);
  });

  test('identifies text content as non-binary', () => {
    const buffer = Buffer.from('Hello, world!\nThis is a text file.\n');
    expect(isBinaryByContent(buffer)).toBe(false);
  });

  test('handles UTF-8 text (non-ASCII) as non-binary', () => {
    const buffer = Buffer.from('こんにちは世界\n');
    expect(isBinaryByContent(buffer)).toBe(false);
  });

  test('handles empty buffer', () => {
    const buffer = Buffer.alloc(0);
    expect(isBinaryByContent(buffer)).toBe(false);
  });
});

describe('describeBinaryFile', () => {
  test('formats bytes', () => {
    expect(describeBinaryFile('test.png', 500)).toBe('[Binary file: .png, 500 bytes]');
  });

  test('formats KB', () => {
    expect(describeBinaryFile('test.jpg', 5000)).toBe('[Binary file: .jpg, 4.9 KB]');
  });

  test('formats MB', () => {
    expect(describeBinaryFile('test.mp4', 5000000)).toBe('[Binary file: .mp4, 4.8 MB]');
  });
});
