import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { verifyAuditJobs } from "../scripts/verify-audit-jobs.mjs";

const repository = "owner/helios";
const comparisonJobs = ["comparison-baseline", "visual-capture", "focus-history"];
const jobNames = ["functional", ...comparisonJobs];

function fixture({ eventName = "pull_request", base = "develop", headRepository = repository, ref = "refs/pull/1/merge" } = {}) {
  const comparisonRequired = eventName === "pull_request" && base === "develop" && headRepository === repository;
  return {
    eventName, ref, repository,
    event: eventName === "pull_request" ? {
      pull_request: {
        base: { ref: base, repo: { full_name: repository } },
        head: { ref: "agent/issue-168-audits", repo: { full_name: headRepository } },
      },
    } : {},
    needs: Object.fromEntries(jobNames.map((job) => [job, {
      result: job === "functional" || comparisonRequired ? "success" : "skipped",
      outputs: job === "comparison-baseline" && comparisonRequired ? {
        main_sha: "a".repeat(40), main_tree: "b".repeat(40),
      } : {},
    }])),
  };
}

test("develop PR gate requires functional, every visual group, history, and the frozen baseline", () => {
  assert.deepEqual(verifyAuditJobs(fixture()), { comparisonRequired: true });
  for (const job of jobNames) {
    for (const result of ["failure", "cancelled", "skipped", "neutral", "", undefined]) {
      const input = fixture();
      input.needs[job].result = result;
      assert.throws(() => verifyAuditJobs(input), assert.AssertionError, `${job}: ${result}`);
    }
    const input = fixture();
    delete input.needs[job];
    assert.throws(() => verifyAuditJobs(input), /every Audit dependency/);
  }
});

test("inapplicable comparisons are explicitly skipped for push, main PR, manual main, and fork PR", () => {
  const cases = [
    { eventName: "push", ref: "refs/heads/main" },
    { eventName: "push", ref: "refs/heads/develop" },
    { eventName: "workflow_dispatch", ref: "refs/heads/main" },
    { base: "main" },
    { headRepository: "fork/helios" },
    { base: "main", headRepository: "fork/helios" },
  ];
  for (const options of cases) {
    assert.deepEqual(verifyAuditJobs(fixture(options)), { comparisonRequired: false });
    for (const job of jobNames) {
      for (const result of ["failure", "cancelled", "neutral", "", undefined]) {
        const input = fixture(options);
        input.needs[job].result = result;
        assert.throws(() => verifyAuditJobs(input), assert.AssertionError, `${JSON.stringify(options)} ${job}: ${result}`);
      }
    }
    const missingFunctional = fixture(options);
    missingFunctional.needs.functional.result = "skipped";
    assert.throws(() => verifyAuditJobs(missingFunctional), /functional must succeed/);
    for (const job of comparisonJobs) {
      const unexpectedlyRun = fixture(options);
      unexpectedlyRun.needs[job].result = "success";
      assert.throws(() => verifyAuditJobs(unexpectedlyRun), /must be skipped/);
    }
  }
});

test("missing or malformed baseline outputs never exempt a develop PR from comparisons", () => {
  for (const outputs of [undefined, {}, { main_sha: "main", main_tree: "b".repeat(40) }, { main_sha: "a".repeat(40) }]) {
    const input = fixture();
    input.needs["comparison-baseline"].outputs = outputs;
    assert.throws(() => verifyAuditJobs(input), /frozen main/);
  }
  const input = fixture();
  input.needs["comparison-baseline"] = { result: "skipped", outputs: { comparisonRequired: "false" } };
  assert.throws(() => verifyAuditJobs(input), /comparison-baseline must be success/);
});

test("unsupported or incomplete event contexts and dependency sets fail closed", () => {
  const mutations = [
    (input) => { input.eventName = "pull_request_target"; },
    (input) => { input.event = {}; },
    (input) => { input.event = null; },
    (input) => { input.event.pull_request.base.ref = "other"; },
    (input) => { delete input.event.pull_request.head.repo; },
    (input) => { input.event.pull_request.base.repo.full_name = "other/helios"; },
    (input) => { input.needs = null; },
    (input) => { input.needs.unexpected = { result: "success" }; },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    assert.throws(() => verifyAuditJobs(input), assert.AssertionError);
  }
  assert.throws(() => verifyAuditJobs(fixture({ eventName: "push", ref: "refs/heads/other" })), /supported push/);
  assert.throws(() => verifyAuditJobs(fixture({ eventName: "workflow_dispatch", ref: "refs/heads/develop" })), /restricted to main/);
});

test("actual workflow conditions match aggregate applicability and preserve all visual groups", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const jobsSource = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
  const jobs = Object.fromEntries([...jobsSource.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|$(?![\s\S]))/gm)].map((match) => [match[1], match[2]]));
  assert.deepEqual(Object.keys(jobs).sort(), [...jobNames, "audit"].sort());
  assert.match(jobs.audit, /^    name: audit$/m);
  assert.match(jobs.audit, /^    if: always\(\)$/m);
  const dependencies = jobs.audit.match(/^    needs: \[([^\]]+)\]$/m)?.[1].split(/,\s*/).sort();
  assert.deepEqual(dependencies, jobNames.toSorted());
  assert.match(jobs.audit, /run: node scripts\/verify-audit-jobs\.mjs/);
  assert.match(jobs.audit, /HELIOS_AUDIT_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  for (const job of comparisonJobs) {
    const expression = jobs[job].match(/^    if: >-\n((?:      .*\n)+)/m)?.[1];
    assert.ok(expression, `${job} declares event applicability`);
    for (const options of [
      {}, { base: "main" }, { headRepository: "fork/helios" },
      { eventName: "push", ref: "refs/heads/main" },
      { eventName: "push", ref: "refs/heads/develop" },
      { eventName: "workflow_dispatch", ref: "refs/heads/main" },
    ]) {
      const input = fixture(options);
      const github = { event_name: input.eventName, base_ref: input.event.pull_request?.base.ref ?? "", event: input.event, repository };
      assert.equal(runInNewContext(expression, { github }), verifyAuditJobs(input).comparisonRequired, `${job}: ${JSON.stringify(options)}`);
    }
  }
  assert.match(jobs["visual-capture"], /^    needs: comparison-baseline$/m);
  assert.match(jobs["visual-capture"], /fail-fast: false/);
  assert.match(jobs["visual-capture"], /group: \[bodies, desktop-moons, touch-moons, other, ordinary\]/);
  assert.match(jobs["visual-capture"], /ref: \$\{\{ needs\.comparison-baseline\.outputs\.main_sha \}\}/);
  assert.doesNotMatch(jobs["visual-capture"], /ref: refs\/heads\/main/);
  assert.match(jobs["comparison-baseline"], /ref: refs\/heads\/main/);
  assert.match(jobs["focus-history"], /ref: c1f76d63c06853f8012569d2c19df6f499788a3c/);
  assert.match(jobs["focus-history"], /--group focus/);
});
