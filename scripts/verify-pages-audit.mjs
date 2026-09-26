import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Only API metadata is consumed. Never execute or download a triggering run's artifacts.
export async function verifyPagesAudit({ repository, runId, sha, getJson }) {
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "valid repository required");
  assert.match(runId, /^[1-9][0-9]*$/, "an Audit run ID is required for manual recovery");
  assert.ok(Number.isSafeInteger(Number(runId)), "valid Audit run ID required");
  assert.match(sha, /^[0-9a-f]{40}$/, "immutable checkout SHA required");
  const base = `/repos/${repository}`;
  const [workflow, run] = await Promise.all([
    getJson(`${base}/actions/workflows/ci.yml`),
    getJson(`${base}/actions/runs/${runId}`),
  ]);
  assert.equal(workflow.name, "Audit", "expected Audit workflow");
  assert.equal(workflow.path, ".github/workflows/ci.yml", "expected Audit workflow file");
  assert.equal(run.id, Number(runId), "expected requested Audit run");
  assert.equal(run.workflow_id, workflow.id, "run must belong to the Audit workflow");
  assert.equal(run.repository.full_name, repository, "Audit repository must match");
  assert.equal(run.head_repository.full_name, repository, "fork Audits cannot deploy");
  assert.equal(run.head_branch, "main", "only a main Audit can deploy");
  assert.ok(["push", "workflow_dispatch"].includes(run.event), "PR Audits cannot deploy");
  assert.equal(run.head_sha, sha, "Audit must cover the exact checkout and current main");
  assert.equal(run.status, "completed", "Audit must be completed");
  assert.equal(run.conclusion, "success", "Audit must have succeeded");
  assert.ok(Number.isSafeInteger(run.check_suite_id), "Audit check suite required");
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, "Audit attempt required");
  const [suite, result] = await Promise.all([
    getJson(`${base}/check-suites/${run.check_suite_id}`),
    getJson(`${base}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`),
  ]);
  assert.equal(suite.id, run.check_suite_id, "expected Audit check suite");
  assert.equal(suite.app.id, 15368, "Audit must come from the trusted GitHub Actions app");
  assert.equal(suite.head_sha, sha, "check suite must cover the exact checkout");
  assert.equal(suite.status, "completed", "check suite must be completed");
  assert.equal(suite.conclusion, "success", "check suite must have succeeded");
  assert.equal(result.total_count, result.jobs.length, "all Audit jobs must be inspected");
  const auditJobs = result.jobs.filter((job) => job.name === "audit");
  assert.equal(auditJobs.length, 1, "exactly one audit job is required");
  const [audit] = auditJobs;
  assert.equal(audit.run_id, run.id, "audit job must belong to the selected run");
  assert.equal(audit.head_sha, sha, "audit job must cover the exact checkout");
  assert.equal(audit.status, "completed", "audit job must be completed");
  assert.equal(audit.conclusion, "success", "audit job must have succeeded, not been skipped");
  const main = await getJson(`${base}/git/ref/heads/main`);
  assert.equal(main.object.sha, sha, "main moved; wait for its own Audit before deploying");
  return sha;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "Pages runs only from main");
  assert.ok(["workflow_run", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME), "unsupported Pages trigger");
  assert.ok(process.env.GH_TOKEN, "GitHub API token required");
  const sha = await verifyPagesAudit({
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.HELIOS_AUDIT_RUN_ID ?? "",
    sha: process.env.GITHUB_SHA,
    getJson: async (route) => {
      const response = await fetch(`https://api.github.com${route}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${process.env.GH_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      assert.ok(response.ok, `GitHub Audit verification failed: HTTP ${response.status}`);
      return response.json();
    },
  });
  console.log(`Verified successful trusted Audit ${process.env.HELIOS_AUDIT_RUN_ID} for current main ${sha}`);
}
