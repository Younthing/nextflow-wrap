import type { RemoteHost, RemoteProbe } from "./types";

/**
 * Shell text for runs on a remote host. Scripts go to the host on ssh's stdin (`sh -s` / `bash -l -s`), so the
 * user's login shell never parses them; only short commands with checked paths are passed on the ssh command line.
 */

/** A POSIX shell single-quoted word. */
export const sq = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Paths and commands that may appear unquoted on the ssh command line: no spaces, quotes or shell syntax. */
export const SAFE_PATH = /^(?:~|~\/[\w.@+/-]*|\/[\w.@+/-]*)$/;
export const SAFE_COMMAND = /^(?:~\/)?[\w.@+/-]+$/;
export const SAFE_HOST = /^[A-Za-z0-9_][\w.-]*$/;
export const SAFE_USER = /^[A-Za-z_][\w.-]*$/;

export const sshTarget = (host: Pick<RemoteHost, "host" | "user">) => (host.user ? `${host.user}@${host.host}` : host.host);

/**
 * ssh options for a host. A control socket keeps one connection open between the frequent status polls.
 * BatchMode makes a missing key fail at once instead of waiting for a password nobody can type.
 */
export function sshArgs(host: RemoteHost, controlDir?: string): string[] {
  return [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=20",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=4",
    ...(controlDir ? ["-o", "ControlMaster=auto", "-o", `ControlPath=${controlDir}/%C`, "-o", "ControlPersist=120"] : []),
    ...(host.port ? ["-p", String(host.port)] : []),
    ...(host.identityFile ? ["-i", host.identityFile, "-o", "IdentitiesOnly=yes"] : []),
    "--",
    sshTarget(host),
  ];
}

/** Paths a run uses on the host, under the resolved absolute base directory. */
export function remoteLayout(baseDir: string, workflowId: string, runId: string) {
  const base = baseDir.replace(/\/+$/, "");
  return {
    launchDir: `${base}/pipelines/${workflowId}`,
    attemptDir: `${base}/runs/${runId}`,
    outdir: `${base}/runs/${runId}/results`,
    workDir: `${base}/work`,
  };
}

const SCHEDULERS = ["sbatch", "qsub", "bsub", "hq", "flux", "condor_submit", "msub", "oarsub", "ccc_msub"];
const RUNTIMES = ["conda", "mamba", "micromamba", "singularity", "apptainer", "docker", "podman"];

const setupLine = (host: RemoteHost) => (host.setup?.trim() ? `${host.setup.trim()}\n` : "");
const nextflowCommand = (host: RemoteHost) => host.nextflow?.trim() || "nextflow";

/** Connection test: resolves the base directory and lists Nextflow, Java, schedulers and runtimes on the host. */
export function probeScript(host: RemoteHost, extraTools: string[] = []): string {
  const tools = [...new Set([...SCHEDULERS, ...RUNTIMES, ...extraTools])].filter((name) => SAFE_COMMAND.test(name));
  return [
    setupLine(host).trimEnd(),
    `mkdir -p ${host.baseDir} && cd ${host.baseDir} && echo "@@BASE $(pwd -P)"`,
    `N=$(command -v ${nextflowCommand(host)} 2>/dev/null || true)`,
    'echo "@@NEXTFLOW $N"',
    `if [ -n "$N" ]; then echo "@@NFVERSION $(NXF_ANSI_LOG=false "$N" -version 2>&1 | grep -o 'version [0-9][^ ]*' | head -n 1)"; fi`,
    'echo "@@JAVA $(java -version 2>&1 | head -n 1)"',
    `for t in ${tools.join(" ")}; do if command -v "$t" >/dev/null 2>&1; then echo "@@TOOL $t"; fi; done`,
    "",
  ].filter((line, index) => line || index > 0).join("\n");
}

export function parseProbe(output: string): RemoteProbe & { tools: string[] } {
  const field = (name: string) => output.match(new RegExp(`^@@${name} ?(.*)$`, "m"))?.[1]?.trim() || undefined;
  const tools = [...output.matchAll(/^@@TOOL (\S+)$/gm)].map((match) => match[1]);
  const baseDir = field("BASE");
  const nextflowPath = field("NEXTFLOW");
  const version = field("NFVERSION");
  const error = !baseDir ? "无法创建或进入基础目录" : !nextflowPath ? "在集群上找不到 Nextflow；填写 Nextflow 命令或「登录后执行」里加载它的命令" : undefined;
  return {
    ok: !error,
    baseDir,
    nextflow: nextflowPath ? `${nextflowPath}${version ? ` (${version})` : ""}` : undefined,
    java: field("JAVA"),
    schedulers: tools.filter((tool) => SCHEDULERS.includes(tool)),
    runtimes: tools.filter((tool) => RUNTIMES.includes(tool)),
    tools,
    error,
  };
}

const lstart = (pid: string) => `$(ps -p ${pid} -o lstart= 2>/dev/null | sed 's/^ *//;s/ *$//')`;

/**
 * Starts the Nextflow head on the login node so it outlives the ssh connection: setsid (when present) puts it in
 * its own process group for a clean stop, nohup ignores the hangup, and the exit status goes to a file.
 */
export function launchScript(host: RemoteHost, opts: { launchDir: string; attemptDir: string; args: string[] }): string {
  const nextflow = nextflowCommand(host);
  const command = `${nextflow} ${opts.args.map(sq).join(" ")}; echo $? > ${sq(`${opts.attemptDir}/exit-code`)}`;
  return [
    setupLine(host).trimEnd(),
    `cd ${sq(opts.launchDir)} || exit 3`,
    `command -v ${nextflow} >/dev/null 2>&1 || { echo "@@ERROR 在集群上找不到 ${nextflow}"; exit 3; }`,
    `rm -f ${sq(`${opts.attemptDir}/exit-code`)}`,
    "export NXF_ANSI_LOG=false",
    "if command -v setsid >/dev/null 2>&1; then L=setsid; else L=; fi",
    `$L nohup sh -c ${sq(command)} > ${sq(`${opts.attemptDir}/console.log`)} 2>&1 < /dev/null &`,
    "P=$!",
    "sleep 1",
    'echo "@@PID $P"',
    `echo "@@START ${lstart("$P")}"`,
    "",
  ].filter((line, index) => line || index > 0).join("\n");
}

export function parseLaunch(output: string): { pid: number; pidStart: string } {
  const error = output.match(/^@@ERROR (.*)$/m)?.[1];
  if (error) throw new Error(error);
  const pid = Number(output.match(/^@@PID (\d+)$/m)?.[1]);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`没能在集群上启动 Nextflow：${output.slice(-2000)}`);
  return { pid, pidStart: output.match(/^@@START (.*)$/m)?.[1]?.trim() ?? "" };
}

/** Whether the head is still the same process, its exit status once written, and the trace so far. */
export function pollScript(opts: { attemptDir: string; pid: number; pidStart: string }): string {
  return [
    `if kill -0 ${opts.pid} 2>/dev/null && [ "${lstart(String(opts.pid))}" = ${sq(opts.pidStart)} ]; then echo "@@ALIVE 1"; else echo "@@ALIVE 0"; fi`,
    `if [ -f ${sq(`${opts.attemptDir}/exit-code`)} ]; then echo "@@EXIT $(cat ${sq(`${opts.attemptDir}/exit-code`)})"; fi`,
    'echo "@@TRACE"',
    `cat ${sq(`${opts.attemptDir}/trace.tsv`)} 2>/dev/null || true`,
    'echo "@@CONSOLE"',
    `tail -n 300 ${sq(`${opts.attemptDir}/console.log`)} 2>/dev/null || true`,
    "",
  ].join("\n");
}

export function parsePoll(output: string): { alive: boolean; exitCode?: number; trace: string; console: string } {
  const traceAt = output.indexOf("@@TRACE\n");
  const consoleAt = output.indexOf("@@CONSOLE\n", Math.max(traceAt, 0));
  const head = traceAt >= 0 ? output.slice(0, traceAt) : output;
  const exit = head.match(/^@@EXIT (-?\d+)\s*$/m)?.[1];
  return {
    alive: /^@@ALIVE 1$/m.test(head),
    exitCode: exit === undefined ? undefined : Number(exit),
    trace: traceAt >= 0 ? output.slice(traceAt + "@@TRACE\n".length, consoleAt >= 0 ? consoleAt : undefined) : "",
    console: consoleAt >= 0 ? output.slice(consoleAt + "@@CONSOLE\n".length) : "",
  };
}

/** The tail of a task's log files on the host, like the local task log view. */
export function taskLogScript(workdir: string): string {
  return [
    `cd ${sq(workdir)} 2>/dev/null || { echo "任务目录已不在集群上"; exit 0; }`,
    "for f in .command.log .command.err .command.out .command.sh; do",
    '  if [ -f "$f" ]; then printf "\n--- %s ---\n" "$f"; tail -c 64000 "$f"; fi',
    "done",
    "",
  ].join("\n");
}

/** SIGTERM to the head's process group (or the head alone without setsid); a Nextflow head then cancels its jobs. */
export function cancelScript(opts: { pid: number; pidStart: string }, signal: "TERM" | "KILL" = "TERM"): string {
  return [
    `if [ "${lstart(String(opts.pid))}" = ${sq(opts.pidStart)} ]; then kill -${signal} -- -${opts.pid} 2>/dev/null || kill -${signal} ${opts.pid} 2>/dev/null; fi`,
    "true",
    "",
  ].join("\n");
}

/** Size of a directory in bytes (`du -sk`), or -1 when it does not exist. */
export function sizeScript(dir: string): string {
  return `if [ -d ${sq(dir)} ]; then echo "@@KB $(du -sk ${sq(dir)} | cut -f1)"; else echo "@@KB -1"; fi\n`;
}

export const parseSize = (output: string) => {
  const kb = Number(output.match(/^@@KB (-?\d+)$/m)?.[1] ?? -1);
  return kb < 0 ? -1 : kb * 1024;
};

/** A tar stream of the entries of `dir` that exist, on stdout. Prints nothing when none exists. */
export function packScript(dir: string, entries: string[]): string {
  return [
    `cd ${sq(dir)} 2>/dev/null || exit 0`,
    "set --",
    ...entries.map((entry) => `[ -e ${sq(entry)} ] && set -- "$@" ${sq(entry)}`),
    '[ "$#" -gt 0 ] && tar -cf - "$@"',
    "exit 0",
    "",
  ].join("\n");
}
