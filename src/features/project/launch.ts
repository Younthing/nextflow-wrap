import { gstr } from "./groovy";

export type ExecutorId = "local" | "slurm" | "google-batch" | "aws-batch" | "azure-batch" | "k8s";
export type ContainerEngine = "docker" | "singularity" | "apptainer" | "podman" | "conda" | "wave";

export interface ExecutorField {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "select";
  placeholder?: string;
  options?: string[];
  required?: boolean;
  help?: string;
}

export interface ExecutorDef {
  id: ExecutorId;
  name: string;
  description: string;
  /** Default work directory; cloud executors need object storage. */
  workDirHint: string;
  fields: ExecutorField[];
  engines: ContainerEngine[];
}

export const EXECUTORS: ExecutorDef[] = [
  {
    id: "local",
    name: "本机",
    description: "在运行 Nextflow 的机器上直接执行，适合小数据和调试。",
    workDirHint: "work",
    engines: ["docker", "singularity", "apptainer", "podman", "conda", "wave"],
    fields: [
      { key: "cpus", label: "最多 CPU", type: "number", placeholder: "8" },
      { key: "memory", label: "最多内存", type: "text", placeholder: "32.GB" },
    ],
  },
  {
    id: "slurm",
    name: "SLURM 集群",
    description: "把每个任务作为作业提交到 SLURM 队列。",
    workDirHint: "/scratch/$USER/work",
    engines: ["singularity", "apptainer", "conda"],
    fields: [
      { key: "queue", label: "分区（queue）", type: "text", placeholder: "normal", required: true },
      { key: "clusterOptions", label: "额外 sbatch 参数", type: "text", placeholder: "--account=lab --qos=normal" },
      { key: "queueSize", label: "同时提交的作业数", type: "number", placeholder: "100" },
    ],
  },
  {
    id: "google-batch",
    name: "Google Batch",
    description: "在 Google Cloud Batch 上运行，数据和工作目录放在 GCS。",
    workDirHint: "gs://my-bucket/work",
    engines: ["docker", "wave"],
    fields: [
      { key: "project", label: "GCP 项目 ID", type: "text", placeholder: "my-project", required: true },
      { key: "location", label: "区域", type: "text", placeholder: "us-central1", required: true },
      { key: "spot", label: "使用 Spot 实例", type: "boolean" },
      { key: "network", label: "VPC 网络", type: "text", placeholder: "projects/my-project/global/networks/default" },
      { key: "serviceAccountEmail", label: "服务账号", type: "text", placeholder: "nextflow@my-project.iam.gserviceaccount.com" },
    ],
  },
  {
    id: "aws-batch",
    name: "AWS Batch",
    description: "提交到 AWS Batch 作业队列，工作目录放在 S3。",
    workDirHint: "s3://my-bucket/work",
    engines: ["docker", "wave"],
    fields: [
      { key: "queue", label: "作业队列", type: "text", placeholder: "nextflow-queue", required: true },
      { key: "region", label: "区域", type: "text", placeholder: "us-east-1", required: true },
      { key: "cliPath", label: "AWS CLI 路径", type: "text", placeholder: "/home/ec2-user/miniconda/bin/aws" },
    ],
  },
  {
    id: "azure-batch",
    name: "Azure Batch",
    description: "在 Azure Batch 池中运行，工作目录放在 Azure Blob。",
    workDirHint: "az://my-container/work",
    engines: ["docker", "wave"],
    fields: [
      { key: "location", label: "区域", type: "text", placeholder: "eastus", required: true },
      { key: "accountName", label: "Batch 账户", type: "text", required: true },
      { key: "storageAccount", label: "存储账户", type: "text", required: true },
      { key: "autoPools", label: "自动创建计算池", type: "boolean" },
    ],
  },
  {
    id: "k8s",
    name: "Kubernetes",
    description: "以 Pod 形式运行任务，需要共享存储卷。",
    workDirHint: "/workspace/work",
    engines: ["docker", "wave"],
    fields: [
      { key: "namespace", label: "命名空间", type: "text", placeholder: "nextflow", required: true },
      { key: "storageClaimName", label: "PVC 名称", type: "text", placeholder: "nextflow-pvc", required: true },
      { key: "serviceAccount", label: "服务账号", type: "text", placeholder: "nextflow" },
    ],
  },
];

export const ENGINE_LABELS: Record<ContainerEngine, string> = {
  docker: "Docker",
  singularity: "Singularity",
  apptainer: "Apptainer",
  podman: "Podman",
  conda: "Conda",
  wave: "Wave",
};

export const REGISTRIES = ["quay.io", "docker.rainbond.cc"] as const;

export interface LaunchConfig {
  executor: ExecutorId;
  settings: Record<string, string | number | boolean>;
  engine: ContainerEngine;
  /** Extra profiles such as `gpu` or `debug`. */
  extraProfiles: string[];
  workDir: string;
  resume: boolean;
  registry: string;
  runName?: string;
}

export function defaultLaunchConfig(): LaunchConfig {
  return {
    executor: "local",
    settings: {},
    engine: "docker",
    extraProfiles: [],
    workDir: "work",
    resume: true,
    registry: "quay.io",
  };
}

export const executorDef = (id: ExecutorId) => EXECUTORS.find((e) => e.id === id)!;

/** Missing required settings, as user-facing messages. */
export function launchProblems(config: LaunchConfig): string[] {
  const def = executorDef(config.executor);
  const problems = def.fields
    .filter((f) => f.required && (config.settings[f.key] === undefined || config.settings[f.key] === ""))
    .map((f) => `${def.name}：请填写「${f.label}」`);
  if (!def.engines.includes(config.engine)) {
    problems.push(`${def.name} 不支持 ${ENGINE_LABELS[config.engine]}`);
  }
  const cloudPrefix = { "google-batch": "gs://", "aws-batch": "s3://", "azure-batch": "az://" }[config.executor as string];
  if (cloudPrefix && !config.workDir.startsWith(cloudPrefix)) {
    problems.push(`${def.name} 的工作目录需要以 ${cloudPrefix} 开头`);
  }
  return problems;
}

// Unset required values render as null; launchProblems blocks the launch until they are filled.
const val = (v: string | number | boolean | undefined) =>
  v === undefined || v === "" ? "null" : typeof v === "string" ? gstr(v) : String(v);

/** `run.config`, passed with `-c`: executor and storage for this launch. */
export function renderRunConfig(config: LaunchConfig): string {
  const s = config.settings;
  const has = (k: string) => s[k] !== undefined && s[k] !== "";
  const lines = [
    "// Generated by Nextflow Studio for this run: executor and storage settings.",
    `workDir = ${gstr(config.workDir || executorDef(config.executor).workDirHint)}`,
    "",
  ];
  switch (config.executor) {
    case "local": {
      lines.push("process.executor = 'local'");
      const limits = [has("cpus") && `cpus: ${Number(s.cpus)}`, has("memory") && `memory: ${gstr(String(s.memory))}`].filter(Boolean);
      if (limits.length) lines.push(`process.resourceLimits = [ ${limits.join(", ")} ]`);
      break;
    }
    case "slurm":
      lines.push("process.executor = 'slurm'", `process.queue = ${val(s.queue)}`);
      if (has("clusterOptions")) lines.push(`process.clusterOptions = ${val(s.clusterOptions)}`);
      if (has("queueSize")) lines.push(`executor.queueSize = ${Number(s.queueSize)}`);
      break;
    case "google-batch":
      lines.push("process.executor = 'google-batch'", "", "google {", `    project  = ${val(s.project)}`, `    location = ${val(s.location)}`);
      if (s.spot) lines.push("    batch.spot = true");
      if (has("network")) lines.push(`    batch.network = ${val(s.network)}`);
      if (has("serviceAccountEmail")) lines.push(`    batch.serviceAccountEmail = ${val(s.serviceAccountEmail)}`);
      lines.push("}");
      break;
    case "aws-batch":
      lines.push("process.executor = 'awsbatch'", `process.queue = ${val(s.queue)}`, "", "aws {", `    region = ${val(s.region)}`);
      if (has("cliPath")) lines.push(`    batch.cliPath = ${val(s.cliPath)}`);
      lines.push("}");
      break;
    case "azure-batch":
      lines.push(
        "process.executor = 'azurebatch'",
        "",
        "azure {",
        "    batch {",
        `        location    = ${val(s.location)}`,
        `        accountName = ${val(s.accountName)}`,
        `        autoPoolMode = ${s.autoPools ? "true" : "false"}`,
        "    }",
        `    storage.accountName = ${val(s.storageAccount)}`,
        "}",
      );
      break;
    case "k8s":
      lines.push(
        "process.executor = 'k8s'",
        "",
        "k8s {",
        `    namespace        = ${val(s.namespace)}`,
        `    storageClaimName = ${val(s.storageClaimName)}`,
      );
      if (has("serviceAccount")) lines.push(`    serviceAccount   = ${val(s.serviceAccount)}`);
      lines.push("}");
      break;
  }
  return `${lines.join("\n")}\n`;
}

export function profileList(config: LaunchConfig): string {
  return [config.engine, ...config.extraProfiles].join(",");
}

/** The command the backend runs inside the materialised project directory. */
export function launchCommand(config: LaunchConfig): string {
  const parts = [
    "nextflow run .",
    `-profile ${profileList(config)}`,
    "-c run.config",
    "-params-file params.json",
  ];
  if (config.runName) parts.push(`-name ${config.runName}`);
  if (config.resume) parts.push("-resume");
  return parts.join(" \\\n    ");
}
