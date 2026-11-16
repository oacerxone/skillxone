import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderTokensCss } from './css';

const target = fileURLToPath(new URL('./tokens.css', import.meta.url));
writeFileSync(target, renderTokensCss());
console.log(`Wrote ${target}`);
