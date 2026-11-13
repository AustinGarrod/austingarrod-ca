import { readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../dist/_astro/', import.meta.url));
for (const file of readdirSync(directory)) if (file.endsWith('.map')) unlinkSync(directory + file);
