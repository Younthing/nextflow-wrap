/**
 * A cluster login node the desktop reaches over SSH. Nextflow runs there (under nohup, so it outlives the
 * connection) and submits jobs to the cluster's scheduler, or runs tasks on the login node itself.
 */
export interface RemoteHost {
  /** Stable id stored in run settings, e.g. `hpc-lab`. */
  id: string;
  /** Display name. */
  name: string;
  /** Host name or an alias from `~/.ssh/config`. */
  host: string;
  user?: string;
  port?: number;
  /** Private key file. Empty uses ssh-agent and `~/.ssh/config`. */
  identityFile?: string;
  /** Directory on the cluster's shared filesystem for launch directories, run files and the default work dir. */
  baseDir: string;
  /** Nextflow command on the cluster. Default `nextflow`. */
  nextflow?: string;
  /** One shell line run before Nextflow, e.g. `module load java/17 nextflow`. */
  setup?: string;
}

export const REMOTE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** What a connection test found on the host. */
export interface RemoteProbe {
  ok: boolean;
  /** Absolute base directory after `~` and symlinks are resolved. */
  baseDir?: string;
  nextflow?: string;
  java?: string;
  /** Scheduler submit commands found on PATH (sbatch, qsub, bsub…). */
  schedulers: string[];
  /** Container and environment tools found on PATH. */
  runtimes: string[];
  error?: string;
}

/** Where a remote run lives, kept with the run so a restarted runner can watch it again. */
export interface RemoteRunState {
  hostId: string;
  hostName: string;
  /** Launch directory on the host: one per workflow, like the local one. */
  launchDir: string;
  /** This attempt's files on the host: run.config, params.json, logs, trace, results. */
  attemptDir: string;
  /** Results directory on the host (`params.outdir` there). */
  outdir: string;
  workDir: string;
  /** Process id of the Nextflow head on the login node, with its start time to tell a reused pid apart. */
  pid?: number;
  pidStart?: string;
  /** Results stayed on the host because they were larger than the fetch limit. */
  resultsLeftRemote?: boolean;
  resultsBytes?: number;
}
