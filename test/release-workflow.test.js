const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('js-yaml');

const workflowPath = path.join(__dirname, '../.github/workflows/release.yml');
const release = load(readFileSync(workflowPath, 'utf8'));
const { jobs } = release;
const { version } = require('../package.json');
const validation = jobs.validate.steps.find(({ name }) => name === 'Validate release tag');

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
