import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IncrementalGenerationParser } from '../service/incremental-generation.js';
import { parseGeneration } from '../service/validation.js';
import { readGenerationStream } from '../service/generation.js';

const value = {
  name: 'Actual app', description: 'A streamed app',
  files: { 'contract.compact': 'pragma language_version >= 0.26;\n// Unicode: 🚀 α\n', 'src/App.tsx': 'export default function App() { return <p>"text" \\ \t \b \f \r\n</p> }', 'src/styles.css': 'body { content: "\\\\"; }' },
};
function parseChunks(chunks: string[]) {
  const parser = new IncrementalGenerationParser();
  for (const chunk of chunks) parser.push(chunk);
  assert.equal(parser.error, undefined);
  return parser.snapshot();
}

test('file text equals final JSON at every chunk boundary, including raw Unicode and JSON escapes', () => {
  for (const text of [JSON.stringify(value), ` \n\`\`\`json\n${JSON.stringify(value)}\n\`\`\` `, `\`\`\`\n${JSON.stringify(value)}\n\`\`\``]) {
    for (let boundary = 0; boundary <= text.length; boundary++) {
      const parsed = parseChunks([text.slice(0, boundary), text.slice(boundary)]);
      assert.deepEqual(parsed.files, parseGeneration(text).files);
      assert.deepEqual(new Set(parsed.completedFiles), new Set(Object.keys(value.files)));
      assert.equal(parsed.activeFile, undefined);
    }
    assert.deepEqual(parseChunks(text.split('')).files, value.files);
  }
  const escaped = '{"name":"Escaped","description":"","files":{"contract.compact":"A\\uD83D\\uDE80\\u03b1\\nB","src/\\u0041pp.tsx":"Q\\\" \\\\ \\/ \\t \\r \\b \\f","src/styles.css":""}}';
  assert.deepEqual(parseChunks(escaped.split('')).files, parseGeneration(escaped).files);
});

test('only direct whitelisted files are exposed and fake JSON inside strings stays source text', () => {
  const parser = new IncrementalGenerationParser();
  parser.push('{"nested":{"files":{"src/App.tsx":"wrong"}},"files":{"../server.ts":"secret","nested":{"src/App.tsx":"wrong"},"src/App.tsx":"actual');
  assert.deepEqual(parser.snapshot().files, { 'src/App.tsx': 'actual' });
  assert.equal(parser.snapshot().activeFile, 'src/App.tsx');
  assert.deepEqual(parser.snapshot().completedFiles, []);
  parser.push('\\n\\\"files\\\":{\\\"contract.compact\\\":\\\"text\\\"}"}}');
  assert.deepEqual(parser.snapshot().files, { 'src/App.tsx': 'actual\n"files":{"contract.compact":"text"}' });
  assert.equal(parser.error, undefined);
});

test('split and malformed escapes never invent decoded text or complete a partial string', () => {
  const parser = new IncrementalGenerationParser();
  parser.push('{"files":{"contract.compact":"prefix\\');
  assert.equal(parser.snapshot().files['contract.compact'], 'prefix');
  parser.push('u00');
  assert.equal(parser.snapshot().files['contract.compact'], 'prefix');
  parser.push('4'); parser.push('1');
  assert.equal(parser.snapshot().files['contract.compact'], 'prefixA');
  parser.push('\\q');
  assert.match(parser.error!, /escape/);
  parser.push('invented tail"}}');
  assert.equal(parser.snapshot().files['contract.compact'], 'prefixA');
  assert.deepEqual(parser.snapshot().completedFiles, []);
  const malformed = new IncrementalGenerationParser();
  malformed.push('{"files":{"src/App.tsx":"kept",,"contract.compact":"never"}}');
  assert.ok(malformed.error);
  assert.deepEqual(malformed.snapshot().files, { 'src/App.tsx': 'kept' });
});

test('duplicate keys replace prior files exactly as JSON.parse does', () => {
  const parser = new IncrementalGenerationParser();
  parser.push('{"name":"Duplicate","description":"","files":{"contract.compact":"first","src/App.tsx":"first","src/App.tsx":"second');
  assert.equal(parser.snapshot().files['src/App.tsx'], 'second');
  assert.equal(parser.snapshot().completedFiles.includes('src/App.tsx'), false);
  parser.push('","src/styles.css":""},"files":{"contract.compact":"new');
  assert.deepEqual(parser.snapshot().files, { 'contract.compact': 'new' });
  assert.deepEqual(parser.snapshot().completedFiles, []);
  parser.push('","src/App.tsx":"final","src/styles.css":""}}');
  assert.deepEqual(parser.snapshot().files, { 'contract.compact': 'new', 'src/App.tsx': 'final', 'src/styles.css': '' });
  assert.equal(parser.error, undefined);
  const nonstring = new IncrementalGenerationParser();
  nonstring.push('{"files":{"src/App.tsx":"old","src/App.tsx":null}}');
  assert.deepEqual(nonstring.snapshot().files, {});
});

test('provider stream publishes actual partial text but only a validated final object settles', async () => {
  const partials: string[] = [];
  async function* chunks() { for (const chunk of JSON.stringify(value).split('')) yield chunk; }
  const generated = await readGenerationStream(chunks(), undefined, snapshot => {
    if ('src/App.tsx' in snapshot.files) partials.push(snapshot.files['src/App.tsx']);
  });
  assert.deepEqual(generated.files, value.files);
  assert.ok(partials.some(text => text.length > 0 && text.length < value.files['src/App.tsx'].length));
  async function* malformed() { yield '{"files":{"src/App.tsx":"visible but incomplete'; }
  let last = '';
  await assert.rejects(readGenerationStream(malformed(), undefined, snapshot => { last = snapshot.files['src/App.tsx']; }));
  assert.equal(last, 'visible but incomplete');
});
