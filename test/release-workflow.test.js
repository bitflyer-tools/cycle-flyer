const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('js-yaml');

const workflowPath = path.join(__dirname, '../.github/workflows/release.yml');
const { jobs } = load(readFileSync(workflowPath, 'utf8'));
const [firstStep] = jobs['bump-version'].steps;

function runFirstStep(ref) {
  assert.equal(firstStep.name, 'Require the master branch');
  const result = spawnSync('bash', ['-e', '-c', firstStep.run], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF: ref },
  });
  assert.ifError(result.error);
  return result;
}

test('allows a master branch dispatch and builds from the new version tag', () => {
  assert.equal(runFirstStep('refs/heads/master').status, 0);
  assert.equal(jobs.build.needs, 'bump-version');
  const checkout = jobs.build.steps.find(({ uses }) => uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, 'v${{ needs.bump-version.outputs.version }}');
});

test('rejects other branches and tags before checkout with a branch error', () => {
  ['refs/heads/feature', 'refs/tags/master'].forEach((ref) => {
    const result = runFirstStep(ref);
    assert.equal(result.status, 1, ref);
    assert.match(result.stdout, /::error::Dispatch the release workflow from the master branch\./);
  });
});

test('limits CI jobs to repository read access', () => {
  const ciPath = path.join(__dirname, '../.github/workflows/ci.yml');
  const ci = load(readFileSync(ciPath, 'utf8'));
  Object.values(ci.jobs).forEach((job) => {
    assert.deepEqual(job.permissions ?? ci.permissions, { contents: 'read' });
  });
});

test('grants release write access only for version bumps and publishing', () => {
  const release = load(readFileSync(workflowPath, 'utf8'));
  assert.deepEqual(release.permissions, { contents: 'read' });
  assert.deepEqual(
    Object.fromEntries(Object.entries(jobs).map(([name, job]) => [name, job.permissions ?? release.permissions])),
    { 'bump-version': { contents: 'write' }, build: { contents: 'read' }, publish: { contents: 'write' } },
  );
});
