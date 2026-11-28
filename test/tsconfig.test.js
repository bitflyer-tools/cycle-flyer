const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

test('the project type-checks under tsconfig.json', () => {
  const configPath = resolve(__dirname, '../tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const formatDiagnostics = (diagnostics) => ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  });

  assert.ok(!config.error, config.error && formatDiagnostics([config.error]));

  const { fileNames, options, errors } = ts.parseJsonConfigFileContent(
    config.config, ts.sys, resolve(__dirname, '..')
  );
  const program = ts.createProgram(fileNames, { ...options, noEmit: true });
  const diagnostics = [
    ...errors,
    ...program.getOptionsDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];
  assert.equal(diagnostics.length, 0, formatDiagnostics(diagnostics));
});
