import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StudioStore } from "@/lib/server/database";
import { fixtureNotebooks, fixtureScriptModules } from "../test-fixtures";
import { buildLibraryCopy } from "../library-copy";
import { serializeIpynb } from "../ipynb";
import { installModule, shareModule } from "./shared-modules";

describe("portable shared modules", () => {
  it("installs a complete local version which remains usable without the shared library", () => {
    const root = mkdtempSync(join(tmpdir(), "studio-shared-"));
    const sourceRoot = join(root, "source"); const targetRoot = join(root, "target");
    mkdirSync(sourceRoot); mkdirSync(targetRoot);
    const source = new StudioStore(":memory:", sourceRoot, "source");
    const target = new StudioStore(":memory:", targetRoot, "target");
    const library = new StudioStore(":memory:");
    try {
      const definition = { ...fixtureScriptModules()[0], id: "modules/example/v1/module.json", version: "v1" };
      const notebook = fixtureNotebooks()[0];
      source.saveScriptModule(definition);
      source.saveLibraryCopy(buildLibraryCopy({ notebook, module: definition }));
      source.documents!.files.write("modules/example/v1/source.ipynb", serializeIpynb(notebook), null);
      shareModule(source, library, definition.id);
      installModule(library, target, definition.id);
      library.close();
      expect(target.scriptModule(definition.id)?.script).toBe(definition.script);
      expect(target.libraryCopy(definition.id)?.percent).toBeTruthy();
      const independent = new StudioStore(":memory:", targetRoot, "independent");
      try { expect(independent.scriptModule(definition.id)?.script).toBe(definition.script); } finally { independent.close(); }
    } finally { source.close(); target.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
