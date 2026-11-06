import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { existsSync } from "node:fs";
import { notebookFromIpynb, notebookToIpynb, IPYNB_KEY } from "@/features/notebook/ipynb";
import type { NotebookDoc, NotebookRevision } from "@/features/notebook/types";
import type { WorkflowDoc } from "@/features/workflow/types";
import { nextWorkflowRevision } from "@/features/workflow/revision";
import { ProjectFiles, ProjectFileError } from "./project-files";

type Document = NotebookDoc | WorkflowDoc;
type Kind = "notebook" | "workflow";

/** Files are authoritative. The index stores locations only, never replacement document content. */
export class ProjectDocuments {
  readonly files: ProjectFiles;
  private readonly locations = new Map<string, string>();
  constructor(root: string, readonly projectId: string) { this.files = new ProjectFiles(root); }

  private read(path: string, kind: Kind): Document {
    const file = this.files.read(path);
    if (kind === "workflow") {
      const doc = JSON.parse(file.content) as WorkflowDoc;
      if (doc.version !== 1 || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new ProjectFileError(422, `${path} 不是有效的流程文件`);
      return { ...doc, projectId: this.projectId, filePath: path, fileVersion: file.version };
    }
    const parsed = notebookFromIpynb(file.content, basename(path, ".ipynb"));
    const metadata = parsed.metadata?.[IPYNB_KEY] as Partial<NotebookDoc> | undefined;
    return {
      ...parsed, id: parsed.id ?? `nb_${randomUUID()}`, projectId: this.projectId,
      rev: metadata?.rev ?? 1, createdAt: metadata?.createdAt ?? new Date().toISOString(),
      updatedAt: metadata?.updatedAt ?? new Date().toISOString(),
      filePath: path, fileVersion: file.version,
    };
  }

  list(kind: "notebook"): NotebookDoc[];
  list(kind: "workflow"): WorkflowDoc[];
  list(kind: Kind): Document[] {
    const paths = this.files.documents().filter((path) => path.endsWith(kind === "notebook" ? ".ipynb" : ".workflow.json"));
    // Known files can live in data directories without recursively scanning all input data.
    for (const path of this.locations.values()) if (!paths.includes(path) && path.endsWith(kind === "notebook" ? ".ipynb" : ".workflow.json") && existsSync(this.files.resolve(path))) paths.push(path);
    const seen = new Set<string>();
    return paths.sort((a, b) => {
      const known = new Set(this.locations.values());
      return Number(known.has(b)) - Number(known.has(a)) || a.localeCompare(b);
    }).map((path) => {
      let doc = this.read(path, kind);
      if (kind === "notebook" && !(doc as NotebookDoc).metadata?.[IPYNB_KEY]) doc = this.write(doc, kind);
      if (seen.has(doc.id)) {
        doc = { ...doc, id: `${kind === "notebook" ? "nb" : "wf"}_${randomUUID()}` };
        doc = this.write(doc, kind);
      }
      seen.add(doc.id);
      this.locations.set(`${kind}:${doc.id}`, path);
      return doc;
    });
  }

  get(id: string, kind: "notebook"): NotebookDoc | undefined;
  get(id: string, kind: "workflow"): WorkflowDoc | undefined;
  get(id: string, kind: Kind): Document | undefined {
    return (kind === "notebook" ? this.list("notebook") : this.list("workflow")).find((doc) => doc.id === id);
  }

  open(path: string): Document {
    const kind = path.endsWith(".ipynb") ? "notebook" : "workflow";
    const doc = this.read(path, kind);
    this.locations.set(`${kind}:${doc.id}`, path);
    return doc;
  }

  write(doc: Document, kind: Kind): Document {
    this.files.initialize();
    const path = doc.filePath ?? this.locations.get(`${kind}:${doc.id}`) ?? this.files.available(kind === "notebook" ? "notebooks" : "workflows", doc.name, kind === "notebook" ? ".ipynb" : ".workflow.json");
    let content: string;
    const portable = { ...doc };
    delete portable.filePath;
    delete portable.fileVersion;
    delete portable.projectId;
    if (kind === "notebook") {
      const nb = notebookToIpynb(doc as NotebookDoc);
      nb.metadata[IPYNB_KEY] = { ...(nb.metadata[IPYNB_KEY] as object), rev: (doc as NotebookDoc).rev, createdAt: (doc as NotebookDoc).createdAt, updatedAt: doc.updatedAt };
      content = `${JSON.stringify(nb, null, 1)}\n`;
    } else content = `${JSON.stringify(portable, null, 2)}\n`;
    const written = this.files.write(path, content, doc.fileVersion ?? null);
    this.locations.set(`${kind}:${doc.id}`, path);
    this.files.record(`.studio/history/${doc.id}/${written.version}.json`, { ...portable, filePath: path });
    return { ...doc, filePath: path, fileVersion: written.version, projectId: this.projectId };
  }

  saveNotebook(doc: NotebookDoc): NotebookDoc {
    const current = this.get(doc.id, "notebook");
    if (current && doc.fileVersion !== current.fileVersion) throw new ProjectFileError(409, "笔记本在外部被修改，请重新载入或另存为");
    return this.write({ ...doc, rev: current ? current.rev + Number(JSON.stringify(current.cells) !== JSON.stringify(doc.cells)) : 1, updatedAt: nextWorkflowRevision(current?.updatedAt) }, "notebook") as NotebookDoc;
  }

  revisions(id: string): NotebookRevision[] {
    const folder = `.studio/history/${id}`;
    if (!existsSync(this.files.resolve(folder))) return [];
    return this.files.list(folder).filter((entry) => entry.name.endsWith(".json")).map((entry) => {
      const doc = JSON.parse(this.files.read(entry.path).content) as NotebookDoc;
      return { notebookId: id, rev: doc.rev, cells: doc.cells, savedAt: doc.updatedAt };
    }).sort((a, b) => a.rev - b.rev);
  }

  remove(id: string, kind: Kind) {
    const doc = kind === "notebook" ? this.get(id, "notebook") : this.get(id, "workflow");
    if (doc?.filePath) this.files.remove(doc.filePath);
    this.locations.delete(`${kind}:${id}`);
  }
}
