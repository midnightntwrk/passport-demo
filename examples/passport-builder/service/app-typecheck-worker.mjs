import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const appPath = join(root, '__generated_app.tsx');
const assetsPath = join(root, '__generated_assets.d.ts');
let source = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  source += chunk.toString();
  if (Buffer.byteLength(source) > 400_000) process.exit(1);
}
const parsed = ts.createSourceFile(appPath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const allowed = new Set(['react', 'lucide-react', '@midnight-passport/app', '@midnight-passport/ui', '@midnight-passport/assets']);
const errors = [];
if (parsed.referencedFiles.length || parsed.typeReferenceDirectives.length || parsed.libReferenceDirectives.length || /@ts-(?:ignore|nocheck|expect-error)\b/.test(source)) {
  errors.push('Generated apps must not disable typechecking or add compiler references.');
}
function visit(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    if (!ts.isStringLiteral(node.moduleSpecifier) || !allowed.has(node.moduleSpecifier.text)) errors.push(`Generated apps may not import '${node.moduleSpecifier.text}'.`);
  }
  if (ts.isImportEqualsDeclaration(node) || ts.isImportTypeNode(node) || (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')))) {
    errors.push('Generated apps may not import with dynamic, require, or type-query syntax. Use static imports from maintained modules.');
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
if (!errors.length) {
  const options = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, esModuleInterop: true, noEmit: true,
    types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    baseUrl: root, paths: {
      '@midnight-passport/app': [join(root, 'runtime/client.tsx')],
      '@midnight-passport/ui': [join(root, 'runtime/ui.tsx')],
      '@midnight-passport/assets': [assetsPath],
    },
  };
  const virtual = new Map([
    [appPath, source],
    [assetsPath, "import type { ImgHTMLAttributes, ReactElement } from 'react'; export function Asset(props: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {name:string}): ReactElement;"],
  ]);
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = path => virtual.get(path) ?? readFile(path);
  host.fileExists = path => virtual.has(path) || fileExists(path);
  const program = ts.createProgram([appPath], options, host);
  for (const diagnostic of ts.getPreEmitDiagnostics(program).slice(0, 12)) {
    const at = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const location = diagnostic.file?.fileName === appPath ? `src/App.tsx:${(at?.line ?? 0) + 1}:${(at?.character ?? 0) + 1}` : 'Application types';
    errors.push(`${location}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ').slice(0, 700)}`);
  }
}
process.stdout.write(JSON.stringify({ errors: errors.slice(0, 12) }));
