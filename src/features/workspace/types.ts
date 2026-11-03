/**
 * A project is one folder on disk. The welcome page lists recent ones; opening one makes it the workspace that
 * the workbench, its file tree and its notebooks belong to.
 */
export interface Project {
  /** Stable id derived from the folder path, so opening the same folder again finds the same project. */
  id: string;
  name: string;
  /** Absolute folder path on the machine the runner uses. */
  path: string;
  createdAt: string;
  /** Last time it was opened; the welcome page sorts by this. */
  openedAt: string;
}

export interface ProjectList {
  projects: Project[];
  /** The project open in this app, if any. */
  current?: string;
}

export interface CreateProjectRequest {
  name: string;
  /** Folder the new project folder is created in. */
  parent: string;
}

export interface OpenProjectRequest {
  path: string;
}
