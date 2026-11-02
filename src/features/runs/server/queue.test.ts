import { describe, expect, it } from "vitest";

import type { StoredExecution } from "@/lib/server/database";
import { historySession, historyStatus, nextQueued, slotLimits } from "./queue";

const run = (id: string, executor: string, status: string, phase: string | undefined, submittedAt: string, projectDir = `/pipelines/${id}`) => ({
  projectDir, detail: { id, status, phase, submittedAt, launch: { executor } },
}) as unknown as StoredExecution;
const limits = { local: 1, remote: 2 };

describe("nextQueued", () => {
  it("takes the oldest queued run first", () => {
    const runs = [run("b", "local", "submitted", "queued", "2026-01-02"), run("a", "local", "submitted", "queued", "2026-01-01")];
    expect(nextQueued(runs, limits)?.detail.id).toBe("a");
  });

  it("holds a run while another run of the same project is active", () => {
    const runs = [
      run("s1", "slurm", "running", "executing", "2026-01-01", "/pipelines/pbmc"),
      run("s2", "slurm", "submitted", "queued", "2026-01-02", "/pipelines/pbmc"),
      run("s3", "slurm", "submitted", "queued", "2026-01-03", "/pipelines/docking"),
    ];
    expect(nextQueued(runs, limits)?.detail.id).toBe("s3");
  });

  it("keeps local runs serial", () => {
    const runs = [run("busy", "local", "running", "executing", "2026-01-01"), run("wait", "local", "submitted", "queued", "2026-01-02")];
    expect(nextQueued(runs, limits)).toBeUndefined();
  });

  it("counts a preparing run as holding its slot", () => {
    const runs = [run("busy", "local", "submitted", "preparing", "2026-01-01"), run("wait", "local", "submitted", "queued", "2026-01-02")];
    expect(nextQueued(runs, limits)).toBeUndefined();
  });

  it("lets a cluster run start while a local run is busy", () => {
    const runs = [
      run("busy", "local", "running", "executing", "2026-01-01"),
      run("local-wait", "local", "submitted", "queued", "2026-01-02"),
      run("slurm", "slurm", "submitted", "queued", "2026-01-03"),
    ];
    expect(nextQueued(runs, limits)?.detail.id).toBe("slurm");
  });

  it("caps concurrent cluster and cloud runs", () => {
    const runs = [
      run("s1", "slurm", "running", "executing", "2026-01-01"),
      run("s2", "awsbatch", "running", "finalizing", "2026-01-02"),
      run("s3", "hq", "submitted", "queued", "2026-01-03"),
    ];
    expect(nextQueued(runs, limits)).toBeUndefined();
    expect(nextQueued(runs, { local: 1, remote: 3 })?.detail.id).toBe("s3");
  });

  it("ignores finished runs", () => {
    const runs = [run("done", "local", "failed", undefined, "2026-01-01"), run("next", "local", "submitted", "queued", "2026-01-02")];
    expect(nextQueued(runs, limits)?.detail.id).toBe("next");
  });
});

describe("slotLimits", () => {
  it("defaults to one local slot and four remote slots", () => {
    expect(slotLimits({})).toEqual({ local: 1, remote: 4 });
  });

  it("reads the remote slot count and rejects bad values", () => {
    expect(slotLimits({ NEXTFLOW_STUDIO_REMOTE_SLOTS: "8" }).remote).toBe(8);
    expect(slotLimits({ NEXTFLOW_STUDIO_REMOTE_SLOTS: "0" }).remote).toBe(4);
    expect(slotLimits({ NEXTFLOW_STUDIO_REMOTE_SLOTS: "x" }).remote).toBe(4);
  });
});

describe("historyStatus", () => {
  // Copied from `.nextflow/history` written by Nextflow 26.10.4.
  const history = [
    "2026-11-01 16:38:32\t2.3s\tokrun\tOK\t19bf80c49ebb2bd1557250c04924bc75\t0a6cd5f5-38a9-4da9-8ea8-bb4ec0f171f7\tnextflow run main.nf -name okrun",
    "2026-11-01 16:38:36\t2.3s\tbadrun\tERR\t1944a6e5d6fc64310d696515ef18ad82\t51b46c56-5311-4c21-bffb-dff647ef2868\tnextflow run bad.nf -name badrun",
    "2026-11-01 16:38:40\t-\tlive\t-\t19bf80c49ebb2bd1557250c04924bc75\t953a4eef-738b-44b7-aa85-52e4932d746e\tnextflow run main.nf -name live",
  ].join("\n");

  it("reads the recorded outcome of a run", () => {
    expect(historyStatus(history, "okrun")).toBe("OK");
    expect(historyStatus(history, "badrun")).toBe("ERR");
  });

  it("returns undefined when the run never finished or is missing", () => {
    expect(historyStatus(history, "live")).toBeUndefined();
    expect(historyStatus(history, "other")).toBeUndefined();
    expect(historyStatus("", "okrun")).toBeUndefined();
  });

  it("reads the session id a run used, for resume without weblog", () => {
    expect(historySession(history, "badrun")).toBe("51b46c56-5311-4c21-bffb-dff647ef2868");
    expect(historySession(history, "other")).toBeUndefined();
  });
});
