import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const comparisonJobs = ["comparison-baseline", "visual-capture", "focus-history"];

// Applicability comes from the event, never from an upstream job's optional output.
export function verifyAuditJobs({ eventName, ref, repository, event, needs }) {
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "valid repository required");
  assert.ok(event && typeof event === "object", "Audit event payload required");
  let comparisonRequired = false;
  if (eventName === "pull_request") {
    const pullRequest = event.pull_request;
    assert.ok(["main", "develop"].includes(pullRequest?.base?.ref), "supported PR base required");
    assert.equal(pullRequest.base.repo?.full_name, repository, "PR must target this repository");
    assert.match(pullRequest.head?.repo?.full_name ?? "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "PR head repository required");
    comparisonRequired = pullRequest.base.ref === "develop" && pullRequest.head.repo.full_name === repository;
  } else if (eventName === "push") {
    assert.ok(["refs/heads/main", "refs/heads/develop"].includes(ref), "supported push branch required");
  } else {
    assert.equal(eventName, "workflow_dispatch", "unsupported Audit event");
    assert.equal(ref, "refs/heads/main", "manual Audits are restricted to main");
  }

  assert.ok(needs && typeof needs === "object", "Audit dependency results required");
  assert.deepEqual(Object.keys(needs).sort(), ["functional", ...comparisonJobs].sort(), "every Audit dependency must be reported");
  assert.equal(needs.functional?.result, "success", "functional must succeed");
  for (const job of comparisonJobs) {
    const expected = comparisonRequired ? "success" : "skipped";
    assert.equal(needs[job]?.result, expected, `${job} must be ${expected} for this event`);
  }
  if (comparisonRequired) {
    const baseline = needs["comparison-baseline"].outputs;
    assert.match(baseline?.main_sha ?? "", /^[0-9a-f]{40}$/, "frozen main commit required");
    assert.match(baseline?.main_tree ?? "", /^[0-9a-f]{40}$/, "frozen main tree required");
  }
  return { comparisonRequired };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const { comparisonRequired } = verifyAuditJobs({
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
    event,
    needs: JSON.parse(process.env.HELIOS_AUDIT_NEEDS ?? "null"),
  });
  console.log(comparisonRequired
    ? "Audit passed: functional checks, frozen baseline, every visual group, and historical focus succeeded."
    : "Audit passed: functional checks succeeded; comparison and history jobs do not apply to this event.");
}
