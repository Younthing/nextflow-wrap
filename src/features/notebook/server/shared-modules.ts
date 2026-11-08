import type { StudioStore } from "@/lib/server/database";
import { ProjectFileError } from "@/features/workspace/server/project-files";

/** A shared version is a portable bundle; installing always materializes it in the target project. */
export function shareModule(project: StudioStore, library: StudioStore, id: string) {
  if (!/^modules\/[\w.-]+\/v\d+\/module\.json$/.test(id)) throw new ProjectFileError(400, "模块版本路径无效");
  const definition = project.scriptModule(id);
  const copy = project.libraryCopy(id);
  if (!definition || !copy || !project.documents) throw new ProjectFileError(404, "模块版本或来源副本不存在");
  const existing = library.scriptModule(id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(definition)) throw new ProjectFileError(409, "共享库已有内容不同的同名版本，请发布新版本或使用其他模块名");
  const source = project.documents.files.read(`${id.slice(0, -"module.json".length)}source.ipynb`).content;
  library.transaction(() => {
    library.saveScriptModule(definition);
    library.saveLibraryCopy(copy);
    library.setMeta(`moduleSource:${id}`, source);
  });
  return definition;
}

export function installModule(library: StudioStore, project: StudioStore, id: string) {
  if (!/^modules\/[\w.-]+\/v\d+\/module\.json$/.test(id)) throw new ProjectFileError(400, "模块版本路径无效");
  const definition = library.scriptModule(id);
  const copy = library.libraryCopy(id);
  const source = library.meta(`moduleSource:${id}`);
  if (!definition || !copy || !source || !project.documents) throw new ProjectFileError(404, "共享模块版本不完整或不存在");
  const existing = project.scriptModule(id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(definition)) throw new ProjectFileError(409, "项目中已有内容不同的同名模块版本");
    return existing;
  }
  project.documents.files.initialize();
  project.saveScriptModule(definition);
  project.saveLibraryCopy(copy);
  project.documents.files.write(`${id.slice(0, -"module.json".length)}source.ipynb`, source, null);
  return definition;
}
