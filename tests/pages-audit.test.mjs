import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { verifyPagesAudit } from "../scripts/verify-pages-audit.mjs";

const repository = "owner/helios";
const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const runId = "123";

function fixture() {
  return {
    workflow: { id: 456, name: "Audit", path: ".github/workflows/ci.yml" },
    run: {
      id: 123, workflow_id: 456, repository: { full_name: repository },
      head_repository: { full_name: repository }, head_branch: "main", head_sha: sha,
      event: "push", status: "completed", conclusion: "success", check_suite_id: 789, run_attempt: 2,
    },
    main: { object: { sha } },
    suite: { id: 789, app: { id: 15368 }, head_sha: sha, status: "completed", conclusion: "success" },
    jobs: {
      total_count: 1,
      jobs: [{ name: "audit", run_id: 123, head_sha: sha, status: "completed", conclusion: "success" }],
    },
  };
}

async function verify(data, options = {}) {
  const requests = [];
  const routes = new Map([
    [`/repos/${repository}/actions/workflows/ci.yml`, data.workflow],
    [`/repos/${repository}/actions/runs/${runId}`, data.run],
    [`/repos/${repository}/git/ref/heads/main`, data.main],
    [`/repos/${repository}/check-suites/789`, data.suite],
    [`/repos/${repository}/actions/runs/${runId}/attempts/2/jobs?per_page=100`, data.jobs],
  ]);
  const approved = await verifyPagesAudit({
    repository, runId, sha, ...options,
    getJson: async (route) => {
      requests.push(route);
      assert.ok(routes.has(route), `unexpected API read: ${route}`);
      return routes.get(route);
    },
  });
  return { approved, requests };
}

test("Pages accepts only the successful trusted current-main Audit and its latest attempt", async () => {
  for (const event of ["push", "workflow_dispatch"]) {
    const data = fixture();
    data.run.event = event;
    const { approved, requests } = await verify(data);
    assert.equal(approved, sha);
    assert.equal(requests.length, 5);
    assert.ok(requests.includes(`/repos/${repository}/actions/runs/${runId}/attempts/2/jobs?per_page=100`));
  }
});

test("Pages rejects failed, cancelled, incomplete, or skipped Audits and audit jobs", async () => {
  for (const owner of ["run", "suite", "job"]) {
    for (const [status, conclusion] of [
      ["completed", "failure"], ["completed", "cancelled"], ["completed", "skipped"],
      ["completed", "neutral"], ["queued", null], ["in_progress", null],
    ]) {
      const data = fixture();
      Object.assign(owner === "job" ? data.jobs.jobs[0] : data[owner], { status, conclusion });
      await assert.rejects(verify(data), /must (?:be completed|have succeeded)/, `${owner} ${status}/${conclusion}`);
    }
  }
});

test("Pages rejects stale audits, changed main, wrong workflows, forks, and untrusted checks", async () => {
  const mutations = [
    (data) => { data.main.object.sha = otherSha; },
    (data) => { data.run.head_sha = otherSha; },
    (data) => { data.suite.head_sha = otherSha; },
    (data) => { data.jobs.jobs[0].head_sha = otherSha; },
    (data) => { data.run.workflow_id = 999; },
    (data) => { data.workflow.path = ".github/workflows/spoof.yml"; },
    (data) => { data.workflow.name = "Spoof"; },
    (data) => { data.run.id = 999; },
    (data) => { data.run.head_repository.full_name = "fork/helios"; },
    (data) => { data.run.repository.full_name = "fork/helios"; },
    (data) => { data.run.head_branch = "develop"; },
    (data) => { data.run.event = "pull_request"; },
    (data) => { data.run.event = "pull_request_target"; },
    (data) => { data.suite.app.id = 999; },
    (data) => { data.suite.id = 999; },
    (data) => { data.jobs.jobs[0].run_id = 999; },
    (data) => { data.jobs.jobs[0].name = "other"; },
    (data) => { data.jobs.total_count = 101; },
    (data) => { data.jobs.jobs.push({ ...data.jobs.jobs[0] }); data.jobs.total_count += 1; },
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    await assert.rejects(verify(data), assert.AssertionError);
  }
});

test("manual recovery cannot omit or inject an Audit run ID", async () => {
  for (const bad of ["", "0", "-1", "123/../456", "123\nsha=bad", "9007199254740992"]) {
    await assert.rejects(verify(fixture(), { runId: bad }), /Audit run ID/);
  }
});

test("the final Pages recheck refuses a moved main or rerun Audit", async () => {
  const data = fixture();
  await verify(data);
  data.main.object.sha = otherSha;
  await assert.rejects(verify(data), /main moved/);
  data.main.object.sha = sha;
  data.run.status = "in_progress";
  data.run.conclusion = null;
  await assert.rejects(verify(data), /Audit must be completed/);
});

test("Pages API errors fail closed", async () => {
  await assert.rejects(verifyPagesAudit({
    repository, runId, sha,
    getJson: async () => { throw new Error("API unavailable"); },
  }), /API unavailable/);
});

test("the actual Pages job condition excludes stale, PR, fork, unsuccessful and non-main triggers", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  const expression = workflow.match(/^    if: >-\n((?:      .*\n)+)/m)?.[1];
  assert.ok(expression, "Pages job condition is available for behavioral verification");
  const context = () => ({
    repository, sha, ref: "refs/heads/main", event_name: "workflow_run",
    event: { workflow_run: fixture().run },
  });
  const allowed = (github) => runInNewContext(expression, { github });
  assert.equal(allowed(context()), true);
  const manual = context();
  manual.event_name = "workflow_dispatch";
  manual.event = {};
  assert.equal(allowed(manual), true, "manual recovery reaches the same live API gate");
  manual.ref = "refs/heads/develop";
  assert.equal(allowed(manual), false);
  const mutations = [
    (github) => { github.event.workflow_run.head_sha = otherSha; },
    (github) => { github.sha = otherSha; },
    (github) => { github.ref = "refs/heads/develop"; },
    (github) => { github.event_name = "pull_request"; },
    (github) => { github.event.workflow_run.event = "pull_request"; },
    (github) => { github.event.workflow_run.event = "pull_request_target"; },
    (github) => { github.event.workflow_run.head_branch = "develop"; },
    (github) => { github.event.workflow_run.head_repository.full_name = "fork/helios"; },
    (github) => { github.event.workflow_run.conclusion = "failure"; },
    (github) => { github.event.workflow_run.conclusion = "cancelled"; },
    (github) => { github.event.workflow_run.conclusion = null; },
  ];
  for (const mutate of mutations) {
    const github = context();
    mutate(github);
    assert.equal(allowed(github), false);
  }
});
