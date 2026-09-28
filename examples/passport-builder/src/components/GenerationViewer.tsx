import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Check, FileCode2, LoaderCircle, Pause, RefreshCw } from 'lucide-react';
import type { GenerationProgress } from '../../shared/generation';

const FileButton = memo(function FileButton({ path, selected, writing, done, onSelect }: { path: string; selected: boolean; writing: boolean; done: boolean; onSelect: (path: string) => void }) {
  return <button className={`generation-file ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(path)} title={path}>{writing ? <LoaderCircle size={14} className="spin" /> : done ? <Check size={14} /> : <FileCode2 size={14} />}<span>{path}</span><small>{writing ? 'Writing' : done ? 'Done' : 'Received'}</small></button>;
});

export function GenerationViewer({ progress, connection, error, onReconnect, onSavedSource }: { progress: GenerationProgress | null; connection: string; error: string; onReconnect: () => void; onSavedSource?: () => void }) {
  const [selected, setSelected] = useState('');
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLPreElement>(null);
  const previousFile = useRef('');
  const mostRecentActiveFile = useRef('');
  const pathKey = Object.keys(progress?.files ?? {}).sort().join('\n');
  const paths = useMemo(() => pathKey ? pathKey.split('\n') : [], [pathKey]);
  const active = progress?.activeFile;
  if (active && paths.includes(active)) mostRecentActiveFile.current = active;
  const followPath = active || mostRecentActiveFile.current;
  const path = follow && paths.includes(followPath) ? followPath : paths.includes(selected) ? selected : paths[0] ?? '';
  const source = progress?.files[path] ?? '';
  const streaming = progress?.status === 'streaming';
  const failed = progress?.status === 'failed';
  const chooseFile = useCallback((next: string) => { setSelected(next); setFollow(false); }, []);
  useLayoutEffect(() => {
    if (!scroller.current) return;
    if (follow) scroller.current.scrollTop = scroller.current.scrollHeight;
    else if (previousFile.current !== path) scroller.current.scrollTop = 0;
    previousFile.current = path;
  }, [source, path, follow]);
  return <section className="generation-viewer" aria-label="Live generated code">
    <div className="generation-heading"><div><strong>{failed ? 'Build needs attention' : progress?.status === 'complete' ? 'Files received' : 'Writing your app'}</strong><span>{failed ? 'Generated output · read-only' : 'Live code · read-only'}</span></div>{progress && <span className="generation-attempt">Attempt {progress.attempt}</span>}</div>
    {(error || progress?.error) && <div className="generation-notice" role="status"><span>{progress?.error || error}</span>{!failed && <button className="text-button" onClick={onReconnect}><RefreshCw size={13} />Reconnect</button>}</div>}
    <div className="generation-files" aria-label="Generated files">{paths.map((file) => <FileButton key={file} path={file} selected={path === file} writing={streaming && active === file} done={!!progress?.completedFiles.includes(file)} onSelect={chooseFile} />)}</div>
    {path ? <><div className="generation-code-heading"><code>{path}</code><button className="text-button generation-follow" aria-pressed={follow} onClick={() => { if (follow) setSelected(path); setFollow((current) => !current); }}>{follow ? <Pause size={13} /> : <ArrowDownToLine size={13} />}{follow ? 'Following writer' : 'Follow writer'}</button></div><pre ref={scroller} className="generation-source" tabIndex={0} aria-label={`Generated ${path}, read-only`} onScroll={(event) => { const target = event.currentTarget; if (follow && target.scrollHeight - target.clientHeight - target.scrollTop > 32) { setSelected(path); setFollow(false); } }}><code>{source}</code></pre></> : <div className="panel-empty"><FileCode2 size={30} /><h2>Waiting for the first file</h2><p>{connection === 'reconnecting' ? 'Reconnecting to the latest code. Your build continues on the service.' : 'The agent’s code will appear here as it arrives.'}</p></div>}
    <div className="generation-footer"><span role="status">{connection === 'reconnecting' ? 'Reconnecting…' : connection === 'connecting' ? 'Connecting to live code…' : failed ? 'Generated output preserved' : streaming ? active ? `Writing ${active}` : 'Receiving files…' : 'Waiting for validated project files'}</span>{onSavedSource && <button className="text-button" onClick={onSavedSource}>View saved source</button>}</div>
  </section>;
}
