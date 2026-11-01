import type { SetupStatus } from "./types";

/** Deterministic setup states shared by the demo backend and stories. */
export function sampleSetupStatus(kind: "ready" | "fresh" | "installing" = "ready"): SetupStatus {
  const fresh = kind !== "ready";
  return {
    platform: "darwin-arm64",
    dataDirectory: "~/Library/Application Support/Nextflow Studio",
    ready: !fresh,
    desktop: true,
    condaEnvironments: fresh ? [] : [
      { name: "scanpy", prefix: "/opt/miniforge3/envs/scanpy", hasKernel: true },
      { name: "vina", prefix: "/opt/miniforge3/envs/vina", hasKernel: false },
    ],
    tools: [
      fresh
        ? { id: "java", label: "Java 运行时（Temurin JRE）", required: true, state: kind === "installing" ? "installing" : "missing", detail: "Nextflow 需要 Java 17–26", install: { label: "下载 Temurin JRE", version: "21.0.10+7" }, log: kind === "installing" ? ["下载 https://github.com/adoptium/temurin21-binaries/…"] : undefined }
        : { id: "java", label: "Java 运行时（Temurin JRE）", required: true, state: "ok", version: "openjdk version \"21.0.10\"", source: "managed", path: "~/Library/Application Support/Nextflow Studio/toolchain/jre/21.0.10+7" },
      fresh
        ? { id: "nextflow", label: "Nextflow", required: true, state: "missing", install: { label: "下载 Nextflow", version: "26.10.4" } }
        : { id: "nextflow", label: "Nextflow", required: true, state: "ok", version: "26.10.4", source: "system", path: "/usr/local/bin/nextflow" },
      fresh
        ? { id: "weblog", label: "nf-weblog 插件（实时进度）", required: false, state: "missing", detail: "没有它也能运行，进度改为每隔几秒读取 trace 文件", install: { label: "预装 nf-weblog@1.2.0", version: "1.2.0" } }
        : { id: "weblog", label: "nf-weblog 插件（实时进度）", required: false, state: "ok", version: "1.2.0", source: "managed" },
      { id: "conda", label: "conda / mamba", required: false, state: fresh ? "missing" : "ok", version: fresh ? undefined : "conda 24.11.3", install: { label: "安装 micromamba", version: "2.4.0-1" } },
      { id: "jupyter", label: "Jupyter 内核", required: false, state: fresh ? "missing" : "ok", version: fresh ? undefined : "python3、scanpy", install: { label: "创建笔记本环境（ipykernel + scanpy）", version: "2.4.0-1" } },
      { id: "docker", label: "Docker", required: false, state: "missing", detail: "可选：只有选择 docker profile 时需要" },
    ],
  };
}
