/**
 * Generate icons for "Super Debug Mode Ultra Pro Max Plus"
 * 
 * Design: A shield with a lightning bolt and bug silhouette
 * Colors: Teal (#00d4aa) on dark (#0f0f1a) background
 * 
 * Run: node icons/generate-new.js
 * Requires: canvas package (npm install canvas) OR just use the SVG below
 * 
 * For now, manually create PNG from this SVG:
 */

const SVG_16 = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="3" fill="#0f0f1a"/>
  <path d="M8 2L3 4.5v4c0 3.5 2.5 5.5 5 6 2.5-.5 5-2.5 5-6v-4L8 2z" fill="#00d4aa" opacity="0.2" stroke="#00d4aa" stroke-width="0.8"/>
  <path d="M9.5 4L6.5 8.5h2.5L7 12l4-5h-2.5L9.5 4z" fill="#00d4aa"/>
</svg>`;

const SVG_48 = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="8" fill="#0f0f1a"/>
  <path d="M24 6L9 13.5v12c0 10.5 7.5 16.5 15 18 7.5-1.5 15-7.5 15-18v-12L24 6z" fill="#00d4aa" opacity="0.15" stroke="#00d4aa" stroke-width="2"/>
  <path d="M28 12L19 25h7.5L21 36l12-15h-7.5L28 12z" fill="#00d4aa"/>
  <circle cx="15" cy="38" r="2" fill="#00d4aa" opacity="0.4"/>
  <circle cx="33" cy="38" r="2" fill="#00d4aa" opacity="0.4"/>
  <path d="M14 36c0 0 1.5-1 2-2M32 36c0 0 1.5-1 2-2" stroke="#00d4aa" stroke-width="0.8" opacity="0.4"/>
</svg>`;

const SVG_128 = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="20" fill="#0f0f1a"/>
  <path d="M64 16L24 36v32c0 28 20 44 40 48 20-4 40-20 40-48V36L64 16z" fill="#00d4aa" opacity="0.12" stroke="#00d4aa" stroke-width="3"/>
  <path d="M74 32L51 67h20L56 96l32-40H68L74 32z" fill="#00d4aa"/>
  <circle cx="40" cy="100" r="4" fill="#ffc107" opacity="0.6"/>
  <circle cx="88" cy="100" r="4" fill="#ffc107" opacity="0.6"/>
  <path d="M38 96c1-2 3-3 4-5M86 96c1-2 3-3 4-5" stroke="#ffc107" stroke-width="1.5" opacity="0.5" stroke-linecap="round"/>
  <text x="64" y="118" text-anchor="middle" font-family="monospace" font-size="8" fill="#6b6b80">ULTRA PRO MAX+</text>
</svg>`;

console.log('Icon SVGs generated. To create PNGs:');
console.log('1. Open each SVG in a browser');
console.log('2. Right-click → Save as PNG');
console.log('3. Or use: npx svg2png-many icons/*.svg');
console.log('');
console.log('--- 16x16 ---');
console.log(SVG_16);
console.log('');
console.log('--- 48x48 ---');
console.log(SVG_48);
console.log('');
console.log('--- 128x128 ---');
console.log(SVG_128);
