/**
 * Compile server to a single Bun executable.
 */

import { $ } from 'bun';

const targets = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-x64',
  'bun-windows-x64',
];

async function compile() {
  console.log('Compiling server to executables...');

  for (const target of targets) {
    const outputName = `coding-assistant-server-${target.replace('bun-', '')}`;
    console.log(`  Building ${outputName}...`);

    try {
      await $`bun build --compile --target=${target} src/index.ts --outfile dist/${outputName}`;
      console.log(`  ✓ ${outputName}`);
    } catch (error) {
      console.error(`  ✗ ${outputName}: ${error}`);
    }
  }

  console.log('Done.');
}

compile();
