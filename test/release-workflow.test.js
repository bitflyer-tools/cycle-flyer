const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('js-yaml');

const workflowPath = path.join(__dirname, '../.github/workflows/release.yml');
const workflowSource = readFileSync(workflowPath, 'utf8');
const release = load(workflowSource);
const { jobs } = release;
const { version } = require('../package.json');
const validation = jobs.validate.steps.find(({ name }) => name === 'Validate release tag');

test('pins external release actions to full commit SHAs with version comments', () => {
  const actionReferences = Object.values(jobs)
    .flatMap((job) => [job.uses, ...(job.steps ?? []).map(({ uses }) => uses)])
    .filter((uses) => uses && !uses.startsWith('./') && !uses.startsWith('docker://'));
  const documentedReferences = workflowSource.split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:-\s+)?uses:\s+(\S+)\s+#\s+v\d+\.\d+\.\d+\s*$/)?.[1]);

  actionReferences.forEach((uses) => {
    assert.match(uses, /@[0-9a-f]{40}$/);
  });
  assert.deepEqual(documentedReferences.filter((uses) => actionReferences.includes(uses)), actionReferences);
});

function validateTag(tag) {
  const result = spawnSync('bash', ['-e', '-c', validation.run], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_NAME: tag },
  });
  assert.ifError(result.error);
  return result;
}

test('builds the tagged revision and publishes its artifacts with release notes', () => {
  assert.deepEqual(release.on, { push: { tags: ['v*.*.*'] } });
  assert.equal(jobs.build.needs, 'validate');
  const validationCheckout = jobs.validate.steps[0];
  assert.match(validationCheckout.uses, /^actions\/checkout@/);
  assert.equal(validationCheckout.with['fetch-depth'], 0);
  const checkout = jobs.build.steps.find(({ uses }) => uses?.startsWith('actions/checkout@'));
  assert.ok(checkout);
  assert.equal(checkout.with?.ref, undefined);
  assert.equal(jobs.publish.needs, 'build');
  const publish = jobs.publish.steps.find(({ uses }) => uses?.startsWith('softprops/action-gh-release@'));
  assert.equal(publish.with.tag_name, '${{ github.ref_name }}');
  assert.equal(publish.with.generate_release_notes, true);
});

test('accepts the version tag that matches both manifests', () => {
  const result = validateTag(`v${version}`);
  assert.equal(result.status, 0, result.stderr);
});

test('requires the tagged revision to be in the history of master', (t) => {
  const cwd = mkdtempSync(path.join(__dirname, 'release-git-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync(
    'git', [
      '-c', 'user.name=Release Test', '-c', 'user.email=test@example.com',
      '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', ...args,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  git('init');
  git('commit', '--allow-empty', '-m', 'Release revision');
  git('tag', '-a', `v${version}`, '-m', 'Release');
  git('commit', '--allow-empty', '-m', 'Advance master');
  git('update-ref', 'refs/remotes/origin/master', 'HEAD');
  git('checkout', '--detach', `refs/tags/v${version}`);

  const step = jobs.validate.steps.find(({ name }) => name === 'Require the tagged commit on master');
  const validate = () => spawnSync('bash', ['-e', '-c', step.run], { cwd, encoding: 'utf8' });
  const accepted = validate();
  assert.ifError(accepted.error);
  assert.equal(accepted.status, 0, accepted.stderr);

  git('commit', '--allow-empty', '-m', 'Revision outside master');
  git('tag', '-f', `v${version}`);
  git('checkout', '--detach', `refs/tags/v${version}`);
  const rejected = validate();
  assert.ifError(rejected.error);
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.match(rejected.stdout, /::error::The tagged commit must be in the history of master/);
});

test('rejects a mismatched release tag or a prerelease tag', () => {
  [`v${version}.1`, `v${version}-rc.1`].forEach((tag) => {
    const result = validateTag(tag);
    assert.equal(result.status, 1, tag);
    assert.match(result.stderr, /::error::The release tag must match/);
  });
});

test('limits CI jobs to repository read access', () => {
  const ciPath = path.join(__dirname, '../.github/workflows/ci.yml');
  const ci = load(readFileSync(ciPath, 'utf8'));
  Object.values(ci.jobs).forEach((job) => {
    assert.deepEqual(job.permissions ?? ci.permissions, { contents: 'read' });
  });
});

test('grants release write access only for publishing', () => {
  assert.deepEqual(release.permissions, { contents: 'read' });
  assert.deepEqual(
    Object.fromEntries(Object.entries(jobs).map(([name, job]) => [name, job.permissions ?? release.permissions])),
    { validate: { contents: 'read' }, build: { contents: 'read' }, publish: { contents: 'write' } },
  );
});
