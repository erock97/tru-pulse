import { access } from 'node:fs/promises';
import { join } from 'node:path';

const requiredAssets = [
  'TRU-lockup-square.jpg',
  'TRU-lockup.jpg',
  'TRU-reveal-square.mp4',
  'TRU-reveal.mp4',
  'hero-loop.mp4',
  'hero-poster.jpg',
  join('book', 'index.html'),
];

const missing = [];
for (const asset of requiredAssets) {
  try {
    await access(join('dist', asset));
  } catch {
    missing.push(asset);
  }
}

if (missing.length) {
  console.error(
    'Build is missing required TrueHQ public assets:\n' +
      missing.map((asset) => `- ${asset}`).join('\n'),
  );
  process.exit(1);
}

console.log(`Verified ${requiredAssets.length} required TrueHQ public assets.`);
