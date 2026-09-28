import { useEffect, useRef, useState } from 'react';
import type { GenerationProgress, GenerationStreamEvent } from '../../shared/generation';
import { readToken, readableError, SESSION_EXPIRED_EVENT } from '../api';
import { applyGenerationEvent } from './generationProtocol';

export function useGenerationStream(projectId: string, enabled: boolean, saved?: GenerationProgress) {
  const [progress, setProgress] = useState<GenerationProgress | null>(saved ?? null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'closed' | 'error'>('closed');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  useEffect(() => {
    if (!saved || enabled) return;
    setProgress((current) => !current || current.runId !== saved.runId || saved.sequence > current.sequence ? saved : current);
  }, [saved, enabled]);

  useEffect(() => {
    if (!enabled) { setConnection('closed'); return; }
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const connect = async () => {
      controller = new AbortController();
      const signal = controller.signal;
      setConnection(failures ? 'reconnecting' : 'connecting');
      let current: GenerationProgress | null = null;
      let receivedSnapshot = false;
      let ended = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let quietTimer: ReturnType<typeof setTimeout> | undefined;
      const resetQuietTimer = () => {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => controller?.abort(), 45000);
      };
      try {
        const headers = new Headers({ Accept: 'application/x-ndjson' });
        const token = readToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        resetQuietTimer();
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/generation`, { headers, credentials: 'same-origin', signal });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          if (response.status === 401) { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)); return; }
          if (response.status === 403 || response.status === 404) { if (!disposed) { setError(data?.error || 'Live code is unavailable for this project.'); setConnection('error'); } return; }
          throw new Error(data?.error || 'The code stream disconnected.');
        }
        if (!response.body) throw new Error('The service did not provide a code stream.');
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const consumeLine = (line: string) => {
          if (!line.trim()) return;
          const event = JSON.parse(line) as GenerationStreamEvent;
          if (event.type === 'heartbeat') return;
          if (event.type === 'error') {
            if (event.status === 401) { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)); ended = true; return; }
            throw new Error(event.message);
          }
          if (event.type === 'end') { ended = true; return; }
          if (event.type !== 'snapshot' && event.type !== 'update') throw new Error('An unknown code update was received.');
          if (event.type === 'update' && !receivedSnapshot) throw new Error('Waiting for a complete code snapshot.');
          current = applyGenerationEvent(current, event);
          if (event.type === 'snapshot') receivedSnapshot = true;
          if (event.type === 'update') failures = 0;
          if (!disposed) { setProgress(current); setConnection('live'); setError(''); }
        };
        while (!disposed && !ended) {
          const { value, done } = await reader.read();
          resetQuietTimer();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0 && !ended) { consumeLine(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
          if (buffer.length > 8_000_000) throw new Error('A code update exceeded the stream limit.');
          if (done) { if (buffer.trim() && !ended) consumeLine(buffer); break; }
        }
        if (!disposed && !ended) throw new Error('The code stream disconnected. Reconnecting…');
        if (!disposed) { setConnection('closed'); setError(''); }
      } catch (failure) {
        if (disposed) return;
        failures++;
        setConnection('reconnecting');
        setError(signal.aborted ? 'The code stream paused. Reconnecting…' : readableError(failure));
        timer = setTimeout(() => { void connect(); }, Math.min(500 * 2 ** Math.min(failures - 1, 5), 10000));
      } finally {
        if (quietTimer) clearTimeout(quietTimer);
        await reader?.cancel().catch(() => {});
      }
    };
    setProgress(savedRef.current ?? null);
    setError('');
    void connect();
    return () => { disposed = true; controller?.abort(); if (timer) clearTimeout(timer); };
  }, [projectId, enabled, retry]);

  return { progress, connection, error, reconnect: () => setRetry((value) => value + 1) };
}
