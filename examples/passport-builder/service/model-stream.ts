/** Provider failures are operational failures, never instructions to rewrite an app. */
export class ModelServiceError extends Error {}

/** OpenRouter chat SSE, tolerant of metadata and split UTF-8, strict about completion/errors. */
export async function* modelTextStream(input: { model: string; instructions: string; prompt: string }, request: typeof fetch = fetch): AsyncGenerator<string> {
  let response: Response;
  try {
    response = await request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: input.model, messages: [{ role: 'system', content: input.instructions }, { role: 'user', content: input.prompt }], response_format: { type: 'json_object' }, max_tokens: 14000, stream: true }),
      signal: AbortSignal.timeout(240_000),
    });
  } catch { throw new ModelServiceError('The coding service could not be reached. Your saved source is unchanged; no automatic request was repeated.'); }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new ModelServiceError(`The coding service returned HTTP ${response.status}. Check provider availability and credits before retrying.`);
  }
  yield* readModelSse(response.body);
}

export async function* readModelSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; let data: string[] = []; let received = 0; let completed = false; let stopped = false;
  const event = () => {
    const text = data.join('\n'); data = [];
    if (!text) return '';
    if (text === '[DONE]') { completed = true; return ''; }
    let chunk: any;
    try { chunk = JSON.parse(text); } catch { throw new ModelServiceError('The coding service returned a malformed stream. No automatic request was repeated.'); }
    if (chunk.error) throw new ModelServiceError('The coding provider interrupted the response. Your saved source is unchanged; retry when the provider is available.');
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new ModelServiceError(`The model did not finish the application (${String(choice.finish_reason).slice(0, 40)}). Refine the request before retrying.`);
    if (choice?.finish_reason === 'stop') stopped = true;
    const content = choice?.delta?.content;
    if (content === undefined || content === null) return '';
    if (typeof content !== 'string') throw new ModelServiceError('The model returned an unsupported content format.');
    return content;
  };
  try {
    while (!completed) {
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > 4 * 1024 * 1024) throw new ModelServiceError('The model stream exceeded the response limit.');
      buffer += decoder.decode(next.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line === '') { const content = event(); if (content) yield content; }
        if (completed) break;
      }
    }
    if (!completed || !stopped) throw new ModelServiceError('The coding stream ended before completion. Saved source is unchanged; no automatic request was repeated.');
  } catch (cause) {
    if (cause instanceof ModelServiceError) throw cause;
    throw new ModelServiceError('The coding connection was interrupted. Saved source is unchanged; no automatic request was repeated.');
  } finally { await reader.cancel().catch(() => {}); }
}
