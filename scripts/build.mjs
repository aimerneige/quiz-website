import {cp, rm} from 'node:fs/promises';

const source = new URL('../src/', import.meta.url);
const publicFiles = new URL('../public/', import.meta.url);
const output = new URL('../dist/', import.meta.url);

await rm(output, {recursive: true, force: true});
await cp(source, output, {recursive: true});
await cp(publicFiles, output, {recursive: true});

console.log('Built dist/ from src/ and public/.');
