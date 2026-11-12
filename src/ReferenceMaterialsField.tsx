import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { MAX_REFERENCE_FILES, parseReferenceFile, validateReferences, type ReferenceMaterial } from './referenceMaterials';

interface Props {
  materials: ReferenceMaterial[];
  onChange: (materials: ReferenceMaterial[]) => void;
  onBusyChange: (busy: boolean) => void;
}

export default function ReferenceMaterials({ materials, onChange, onBusyChange }: Props) {
  const { basePath } = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const addFiles = async (files: File[]) => {
    if (busy || !files.length) return;
    setError('');
    if (materials.length + files.length > MAX_REFERENCE_FILES) {
      setError('Add up to five reference files.'); return;
    }
    setBusy(true); onBusyChange(true);
    const next = [...materials];
    const errors: string[] = [];
    for (const file of files) {
      if (!mounted.current) return;
      setStatus(`Reading ${file.name}…`);
      try {
        const parsed = await parseReferenceFile(file, `${basePath}/pdf.worker.min.mjs`);
        validateReferences([...next, parsed]);
        next.push(parsed);
      } catch (cause) {
        errors.push(`${file.name}: ${cause instanceof Error ? cause.message : 'This file could not be read. Try exporting it again.'}`);
      }
    }
    if (!mounted.current) return;
    onChange(next);
    setStatus(`${next.length} reference ${next.length === 1 ? 'file' : 'files'} ready.`);
    setError(errors.join('\n'));
    setBusy(false); onBusyChange(false);
  };

  return <fieldset className="ai-field-group reference-materials">
    <legend className="ai-field-label">Reference materials</legend>
    <p id="reference-help" className="ai-optional">Optional: PDF, DOCX, or Markdown. Up to five files, 10 MB each. Scanned PDFs need OCR first.</p>
    <label htmlFor="reference-upload" className="topic-label">Add source files</label>
    <input id="reference-upload" type="file" multiple accept=".pdf,.docx,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown"
      aria-describedby="reference-help" disabled={busy || materials.length >= MAX_REFERENCE_FILES}
      onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void addFiles(files); }} />
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="reference-error">{error}</p>}
    {materials.length > 0 && <>
      <ul className="reference-list">{materials.map(material => <li key={material.id}>
        <div><strong>{material.name}</strong> <span>{material.text.length.toLocaleString()} characters</span>
          <button type="button" className="btn-ghost" disabled={busy} aria-label={`Remove ${material.name}`} onClick={() => { onChange(materials.filter(item => item.id !== material.id)); setStatus(''); }}>Remove</button></div>
        <details><summary>Preview extracted text</summary><pre>{material.text.slice(0, 2000)}{material.text.length > 2000 ? '\n…' : ''}</pre></details>
      </li>)}</ul>
      <p className="ai-optional">Extracted text is saved with this board and sent to the selected model for board and Final Jeopardy generation.</p>
    </>}
  </fieldset>;
}
