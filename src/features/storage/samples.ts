import type { StorageReport } from "./types";

export const sampleStorageReport = (): StorageReport => ({
  truncated: false,
  caches: [
    { id: "work", label: "共享 work 目录", path: "~/Library/Application Support/Nextflow Studio/work", bytes: 38_200_000_000 },
    { id: "executions", label: "运行记录与结果", path: "~/Library/Application Support/Nextflow Studio/executions", bytes: 1_900_000_000 },
    { id: "conda", label: "conda 环境缓存", path: "~/Library/Caches/Nextflow Studio/conda", bytes: 7_400_000_000 },
    { id: "singularity", label: "Singularity / Apptainer 镜像", path: "~/Library/Caches/Nextflow Studio/singularity", bytes: 0 },
  ],
  sessions: [
    {
      key: "0a6cd5f5-38a9-4da9-8ea8-bb4ec0f171f7", sessionId: "0a6cd5f5-38a9-4da9-8ea8-bb4ec0f171f7", workflowId: "pbmc", workflowName: "PBMC 3k 单细胞",
      runs: [
        { id: "r1", runName: "studio_a1b2c3d4e5f6", status: "failed", submittedAt: "2026-10-30T09:12:00Z" },
        { id: "r2", runName: "studio_b2c3d4e5f6a1", status: "succeeded", submittedAt: "2026-10-30T10:02:00Z" },
      ],
      workDirs: 14, workBytes: 31_500_000_000, reclaimableBytes: 29_800_000_000, resultBytes: 1_700_000_000, active: false, remote: false,
    },
    {
      key: "51b46c56-5311-4c21-bffb-dff647ef2868", sessionId: "51b46c56-5311-4c21-bffb-dff647ef2868", workflowId: "docking", workflowName: "分子对接（Vina）",
      runs: [{ id: "r3", runName: "studio_c3d4e5f6a1b2", status: "running", submittedAt: "2026-11-01T08:00:00Z" }],
      workDirs: 52, workBytes: 6_700_000_000, reclaimableBytes: 6_500_000_000, resultBytes: 200_000_000, active: true, remote: false,
    },
    {
      key: "953a4eef-738b-44b7-aa85-52e4932d746e", sessionId: "953a4eef-738b-44b7-aa85-52e4932d746e", workflowId: "pbmc", workflowName: "PBMC 3k 单细胞",
      runs: [{ id: "r0", runName: "studio_d4e5f6a1b2c3", status: "succeeded", submittedAt: "2026-10-28T14:40:00Z" }],
      workDirs: 0, workBytes: 0, reclaimableBytes: 0, resultBytes: 1_600_000_000, active: false, remote: false, cleanedAt: "2026-10-29T08:00:00Z",
    },
  ],
});
