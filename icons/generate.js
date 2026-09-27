#!/usr/bin/env node
/**
 * Icon Generator for Super Debug Extension
 * Generates valid PNG icons at 16x16, 48x48, and 128x128 sizes.
 * No external dependencies — uses only Node.js built-in modules.
 *
 * Dark background (#1a1a2e) with green-teal (#00d4aa) "SD" text / debug symbol.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Colors
const BG_COLOR = { r: 26, g: 26, b: 46, a: 255 };        // #1a1a2e
const ACCENT_COLOR = { r: 0, g: 212, b: 170, a: 255 };   // #00d4aa

/**
 * Simple bitmap font for "SD" characters — each char is a 5x7 grid.
 */
const FONT = {
    S: [
        [0, 1, 1, 1, 0],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 0],
        [0, 1, 1, 1, 0],
        [0, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [0, 1, 1, 1, 0],
    ],
    D: [
        [1, 1, 1, 1, 0],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 1, 1, 1, 0],
    ],
};

/**
 * Creates a raw RGBA pixel buffer for an icon with "SD" text.
 */
function createIconPixels(size, textColor) {
    const pixels = Buffer.alloc(size * size * 4);

    // Fill background
    for (let i = 0; i < size * size; i++) {
        pixels[i * 4] = BG_COLOR.r;
        pixels[i * 4 + 1] = BG_COLOR.g;
        pixels[i * 4 + 2] = BG_COLOR.b;
        pixels[i * 4 + 3] = BG_COLOR.a;
    }

    // Calculate text placement — "SD" centered
    const charW = 5;
    const charH = 7;
    const gap = 1; // gap between S and D
    const totalCharW = charW * 2 + gap; // 11 units wide

    // Scale factor: how many pixels per font unit
    const scale = Math.max(1, Math.floor(size * 0.7 / totalCharW));
    const textW = totalCharW * scale;
    const textH = charH * scale;
    const offsetX = Math.floor((size - textW) / 2);
    const offsetY = Math.floor((size - textH) / 2);

    // Draw "S"
    drawChar(pixels, size, FONT.S, textColor, offsetX, offsetY, scale);
    // Draw "D"
    drawChar(pixels, size, FONT.D, textColor, offsetX + (charW + gap) * scale, offsetY, scale);

    // Draw a small accent bar at the bottom
    const barHeight = Math.max(1, Math.floor(size * 0.06));
    const barY = size - barHeight - Math.floor(size * 0.08);
    const barXStart = Math.floor(size * 0.2);
    const barXEnd = Math.floor(size * 0.8);
    for (let y = barY; y < barY + barHeight; y++) {
        for (let x = barXStart; x < barXEnd; x++) {
            if (x >= 0 && x < size && y >= 0 && y < size) {
                const idx = (y * size + x) * 4;
                pixels[idx] = textColor.r;
                pixels[idx + 1] = textColor.g;
                pixels[idx + 2] = textColor.b;
                pixels[idx + 3] = textColor.a;
            }
        }
    }

    return pixels;
}

function drawChar(pixels, size, charGrid, color, startX, startY, scale) {
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
            if (charGrid[row][col]) {
                // Draw a scaled pixel block
                for (let sy = 0; sy < scale; sy++) {
                    for (let sx = 0; sx < scale; sx++) {
                        const px = startX + col * scale + sx;
                        const py = startY + row * scale + sy;
                        if (px >= 0 && px < size && py >= 0 && py < size) {
                            const idx = (py * size + px) * 4;
                            pixels[idx] = color.r;
                            pixels[idx + 1] = color.g;
                            pixels[idx + 2] = color.b;
                            pixels[idx + 3] = color.a;
                        }
                    }
                }
            }
        }
    }
}

/**
 * Encode RGBA pixel data as a valid PNG file buffer.
 */
function encodePNG(width, height, rgbaPixels) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 6;  // color type: RGBA
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace
    const ihdrChunk = createChunk('IHDR', ihdrData);

    // IDAT chunk
    const rawData = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        const rowStart = y * (1 + width * 4);
        rawData[rowStart] = 0; // filter type: None
        rgbaPixels.copy(rawData, rowStart + 1, y * width * 4, (y + 1) * width * 4);
    }
    const compressed = zlib.deflateSync(rawData);
    const idatChunk = createChunk('IDAT', compressed);

    // IEND chunk
    const iendChunk = createChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBuffer, data]);
    const crc = crc32(crcInput);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) {
                crc = (crc >>> 1) ^ 0xedb88320;
            } else {
                crc = crc >>> 1;
            }
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// Generate icons
const sizes = [16, 48, 128];
const outputDir = __dirname;

console.log('Generating Super Debug extension icons...\n');

for (const size of sizes) {
    const pixels = createIconPixels(size, ACCENT_COLOR);
    const png = encodePNG(size, size, pixels);
    const filePath = path.join(outputDir, `icon-${size}.png`);
    fs.writeFileSync(filePath, png);
    console.log(`  ✓ icon-${size}.png (${png.length} bytes)`);
}

console.log('\nDone! All icons generated successfully.');
