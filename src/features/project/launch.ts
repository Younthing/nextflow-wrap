import { gstr } from "./groovy";

export type GridExecutorId =
  | "slurm"
  | "sge"
  | "pbs"
  | "pbspro"
  | "lsf"
  | "moab"
  | "oar"
  | "nqsii"
  | "condor"
  | "hq"
  | "flux"
  | "bridge";
export type ExecutorId = "local" | GridExecutorId | "google-batch" | "aws-batch" | "azure-batch" | "k8s";
export type ContainerEngine =
  | "shell"
  | "conda"
  | "mamba"
  | "micromamba"
  | "docker"
  | "podman"
  | "singularity"
  | "apptainer"
  | "charliecloud"
  | "shifter"
  | "sarus"
  | "spack"
  | "wave";

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
  /** Commands that must be on PATH where Nextflow runs. Each entry lists alternatives. */
  tools: string[][];
}

/** Every software runtime Nextflow can switch on through `-profile`. Shell means none. */
export const ENGINES: ContainerEngine[] = [
  "shell",
  "conda",
  "mamba",
  "micromamba",
  "docker",
  "podman",
  "singularity",
  "apptainer",
  "charliecloud",
  "shifter",
  "sarus",
  "spack",
  "wave",
];

const CONTAINER_ONLY: ContainerEngine[] = ["docker", "wave"];

interface GridSpec {
  id: GridExecutorId;
  name: string;
  description: string;
  submit: string;
  queue: boolean;
}

const GRID: GridSpec[] = [
  { id: "slurm", name: "SLURM", description: "把每个任务作为作业提交到 SLURM。", submit: "sbatch", queue: true },
  { id: "hq", name: "HyperQueue", description: "提交到 HyperQueue 服务器，适合在一个大分配里调度大量小任务。", submit: "hq", queue: false },
  { id: "pbspro", name: "PBS Pro", description: "提交到 PBS Professional / OpenPBS 队列。", submit: "qsub", queue: true },
  { id: "pbs", name: "PBS / Torque", description: "提交到 PBS 或 Torque 队列。", submit: "qsub", queue: true },
  { id: "sge", name: "SGE / UGE", description: "提交到 Sun / Univa Grid Engine 队列。", submit: "qsub", queue: true },
  { id: "lsf", name: "LSF", description: "提交到 IBM Spectrum LSF 队列。", submit: "bsub", queue: true },
  { id: "flux", name: "Flux", description: "提交到 Flux 框架。", submit: "flux", queue: true },
  { id: "condor", name: "HTCondor", description: "提交到 HTCondor 资源池。", submit: "condor_submit", queue: false },
  { id: "moab", name: "Moab", description: "提交到 Moab 调度器。", submit: "msub", queue: true },
  { id: "oar", name: "OAR", description: "提交到 OAR 资源管理器。", submit: "oarsub", queue: true },
  { id: "nqsii", name: "NQSII", description: "提交到 NQSII 队列。", submit: "qsub", queue: true },
  { id: "bridge", name: "Bridge", description: "提交到 Bridge 批处理系统。", submit: "ccc_msub", queue: true },
];

/** Nextflow's own name for each executor, as written to `process.executor`. */
export const NEXTFLOW_EXECUTOR: Record<ExecutorId, string> = {
  local: "local",
  ...(Object.fromEntries(GRID.map((g) => [g.id, g.id])) as Record<GridExecutorId, string>),
  "google-batch": "google-batch",
  "aws-batch": "awsbatch",
  "azure-batch": "azurebatch",
  k8s: "k8s",
};

const gridDef = (g: GridSpec): ExecutorDef => ({
  id: g.id,
  name: g.name,
  description: `${g.description}Nextflow 在本机提交作业，工作目录需要计算节点也能访问。`,
  workDirHint: "/shared/scratch/work",
  engines: ENGINES,
  tools: [[g.submit]],
  fields: [
    ...(g.queue ? [{ key: "queue", label: "队列 / 分区（queue）", type: "text" as const, placeholder: "normal" }] : []),
    { key: "clusterOptions", label: "额外提交参数（clusterOptions）", type: "text", placeholder: g.id === "slurm" ? "--account=lab --qos=normal" : "" },
    { key: "queueSize", label: "同时提交的作业数", type: "number", placeholder: "100" },
  ],
});

export const EXECUTORS: ExecutorDef[] = [
  {
    id: "local",
    name: "本机",
    description: "在运行 Nextflow 的机器上直接执行。",
    workDirHint: "work",
    engines: ENGINES,
    tools: [],
    fields: [
      { key: "cpus", label: "最多 CPU", type: "number", placeholder: "8" },
      { key: "memory", label: "最多内存", type: "text", placeholder: "32.GB" },
    ],
  },
  ...GRID.map(gridDef),
  {
    id: "google-batch",
    name: "Google Batch",
    description: "在 Google Cloud Batch 上运行，数据和工作目录放在 GCS。",
    workDirHint: "gs://my-bucket/work",
    engines: CONTAINER_ONLY,
    tools: [],
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
    engines: CONTAINER_ONLY,
    tools: [],
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
    engines: CONTAINER_ONLY,
    tools: [],
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
    engines: CONTAINER_ONLY,
    tools: [],
    fields: [
      { key: "namespace", label: "命名空间", type: "text", placeholder: "nextflow", required: true },
      { key: "storageClaimName", label: "PVC 名称", type: "text", placeholder: "nextflow-pvc", required: true },
      { key: "serviceAccount", label: "服务账号", type: "text", placeholder: "nextflow" },
    ],
  },
];

export const ENGINE_LABELS: Record<ContainerEngine, string> = {
  shell: "Shell（不用 -profile）",
  conda: "Conda",
  mamba: "Mamba",
  micromamba: "Micromamba",
  docker: "Docker",
  podman: "Podman",
  singularity: "Singularity",
  apptainer: "Apptainer",
  charliecloud: "Charliecloud",
  shifter: "Shifter",
  sarus: "Sarus",
  spack: "Spack",
  wave: "Wave",
};

/** The command each runtime needs where its tasks run. Wave works through another engine. */
const ENGINE_TOOLS: Record<ContainerEngine, string[]> = {
  shell: [],
  conda: ["conda"],
  mamba: ["mamba"],
  micromamba: ["micromamba"],
  docker: ["docker"],
  podman: ["podman"],
  singularity: ["singularity"],
  apptainer: ["apptainer"],
  charliecloud: ["ch-run"],
  shifter: ["shifterimg"],
  sarus: ["sarus"],
  spack: ["spack"],
  wave: [],
};

/**
 * Commands the runner must find before it starts Nextflow. Each entry lists alternatives.
 * Engine commands are only checked for the local executor; on a cluster they live on the compute nodes.
 */
export function launchTools(config: LaunchConfig): string[][] {
  const def = executorDef(config.executor);
  const engine = config.executor === "local" && ENGINE_TOOLS[config.engine].length ? [ENGINE_TOOLS[config.engine]] : [];
  return [...def.tools, ...engine];
}

/** The runtime switches Nextflow reads. `shell` turns all of them off. */
const RUNTIME_SWITCHES = ["conda", "docker", "podman", "singularity", "apptainer", "charliecloud", "shifter", "sarus", "spack"] as const;

/**
 * A runtime that brings its own software keeps the user's Python and R libraries out of tasks.
 * Shell runs keep them, because there the host's own packages are the software.
 */
const RUNTIME_ISOLATION = ["env.PYTHONNOUSERSITE = 1", 'env.R_PROFILE_USER = "/.Rprofile"', 'env.R_ENVIRON_USER = "/.Renviron"'];

const ENGINE_EXTRAS: Partial<Record<ContainerEngine, string[]>> = {
  conda: ["conda.channels = ['conda-forge', 'bioconda']"],
  mamba: ["conda.useMamba = true", "conda.channels = ['conda-forge', 'bioconda']"],
  micromamba: ["conda.useMicromamba = true", "conda.channels = ['conda-forge', 'bioconda']"],
  docker: ["docker.runOptions = '-u $(id -u):$(id -g)'"],
  singularity: ["singularity.autoMounts = true"],
  apptainer: ["apptainer.autoMounts = true"],
};

/** Profiles a generated project defines besides the runtimes, usable as extra `-profile` entries. */
export const EXTRA_PROFILES = ["debug", "gpu", "arm64", "emulate_amd64", "wave"] as const;
export type ExtraProfile = (typeof EXTRA_PROFILES)[number];

/** One `-profile` per runtime: it switches that runtime on and every other one off. */
export function runtimeProfiles(indent = "    "): string {
  return ENGINES.filter((engine) => engine !== "shell" && engine !== "wave")
    .map((engine) => {
      const on = engine === "mamba" || engine === "micromamba" ? "conda" : engine;
      const lines = [
        ...RUNTIME_SWITCHES.map((name) => `${name}.enabled = ${name === on}`),
        ...(ENGINE_EXTRAS[engine] ?? []),
        ...RUNTIME_ISOLATION,
      ];
      return [`${indent}${engine} {`, ...lines.map((line) => `${indent}    ${line}`), `${indent}}`].join("\n");
    })
    .join("\n");
}

export const REGISTRIES = ["quay.io", "docker.rainbond.cc"] as const;

/**
 * A real launch keeps the chosen executor and runtime, as `nextflow run -profile` would.
 * The local executor gets a modest default budget; new runs never resume implicitly.
 */
export function realLaunchConfig(config: LaunchConfig): LaunchConfig {
  return {
    ...config,
    settings: config.executor === "local" ? { cpus: 2, memory: "2.GB", ...config.settings } : config.settings,
    resume: false,
  };
}

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
    engine: "shell",
    extraProfiles: [],
    workDir: "work",
    resume: false,
    registry: "quay.io",
  };
}

export const executorDef = (id: ExecutorId) => EXECUTORS.find((e) => e.id === id)!;

export const isGridExecutor = (id: ExecutorId): id is GridExecutorId => GRID.some((g) => g.id === id);

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
  if (isGridExecutor(config.executor)) {
    lines.push(`process.executor = ${gstr(NEXTFLOW_EXECUTOR[config.executor])}`);
    if (has("queue")) lines.push(`process.queue = ${val(s.queue)}`);
    if (has("clusterOptions")) lines.push(`process.clusterOptions = ${val(s.clusterOptions)}`);
    if (has("queueSize")) lines.push(`executor.queueSize = ${Number(s.queueSize)}`);
  }
  switch (config.executor) {
    case "local": {
      lines.push("process.executor = 'local'");
      const limits = [has("cpus") && `cpus: ${Number(s.cpus)}`, has("memory") && `memory: ${gstr(String(s.memory))}`].filter(Boolean);
      if (limits.length) lines.push(`process.resourceLimits = [ ${limits.join(", ")} ]`);
      break;
    }
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
  if (config.engine === "shell") lines.push(...RUNTIME_SWITCHES.map((name) => `${name}.enabled = false`));
  return `${lines.join("\n")}\n`;
}

export function profileList(config: LaunchConfig): string {
  return [config.engine === "shell" ? "" : config.engine, ...config.extraProfiles]
    .map((name) => name.trim())
    .filter(Boolean)
    .join(",");
}

/** The command the backend runs inside the materialised project directory. */
export function launchCommand(config: LaunchConfig): string {
  const parts = ["nextflow run ."];
  const profile = profileList(config);
  if (profile) parts.push(`-profile ${profile}`);
  parts.push("-c run.config", "-params-file params.json");
  if (config.runName) parts.push(`-name ${config.runName}`);
  if (config.resume) parts.push("-resume");
  return parts.join(" \\\n    ");
}
