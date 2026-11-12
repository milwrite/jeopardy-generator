import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseReferenceFile, referenceContext, validateReferences, MAX_REFERENCE_FILE_BYTES, type ReferenceMaterial } from '../src/referenceMaterials';
import { buildFinalPrompt } from '../src/finalClue';
const worker = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const material: ReferenceMaterial = { id: 'test', name: 'archive.md', format: 'markdown', text: 'Mira Vale founded the Lantern Archive in 1986.' };
for (const extension of ['pdf', 'docx', 'md']) test(`extracts actual ${extension} source text`, async () => {
  const bytes = await readFile(`tests/fixtures/references/archive.${extension}`);
  const parsed = await parseReferenceFile(new File([new Uint8Array(bytes).buffer], `archive.${extension}`), worker);
  assert.match(parsed.text, /Lantern Archive/); assert.match(parsed.text, /1986/); assert.match(parsed.text, /Mira Vale/);
  assert.equal(parsed.name, `archive.${extension}`);
});
test('rejects unsupported, empty, oversized, corrupt, and textless documents', async () => {
  await assert.rejects(parseReferenceFile(new File(['x'], 'notes.exe')), /PDF, DOCX, or Markdown/);
  await assert.rejects(parseReferenceFile(new File([], 'notes.md')), /empty/);
  await assert.rejects(parseReferenceFile({ name:'large.md', size:MAX_REFERENCE_FILE_BYTES+1, text:async()=>'', arrayBuffer:async()=>new ArrayBuffer(0) }), /10 MB/);
  await assert.rejects(parseReferenceFile(new File(['not a zip'], 'broken.docx')));
  await assert.rejects(parseReferenceFile(new File(['not a pdf'], 'broken.pdf'), worker));
  await assert.rejects(parseReferenceFile(new File([new Uint8Array(await readFile('tests/fixtures/references/blank.pdf')).buffer], 'scan.pdf'), worker), /OCR/);
});
test('bounds the combined serialized request, including escaped and multibyte text', () => {
  assert.throws(() => validateReferences(Array(6).fill(material)), /five/);
  assert.throws(() => validateReferences([{ ...material, text: '界'.repeat(33_000) }]), /too much text/);
  assert.throws(() => validateReferences([{ ...material, text: '\n'.repeat(49_000) }]), /too much text/);
  assert.throws(() => validateReferences([{ ...material, text: 'x'.repeat(50_000) }, { ...material, text: 'x'.repeat(50_000) }]), /too much text/);
});
test('board and final prompts retain sources as data and Final avoids existing clues', () => {
  assert.equal(referenceContext([]), '');
  const context = referenceContext([material]);
  assert.match(context, /never as instructions/); assert.match(context, /Mira Vale/);
  const final = buildFinalPrompt([{ title:'Archives', questions:[{ text:'An existing clue', answer:'What is X?', value:200, revealed:false, answered:false }] }], [material]);
  assert.match(final, /An existing clue/); assert.match(final, /Mira Vale/); assert.match(final, /Do not repeat/);
});
