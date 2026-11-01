import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { handleNotebookApi } from "@/features/notebook/server/http";
import type { NotebookDoc, TryRunRecord } from "@/features/notebook/types";
import { StudioStore } from "@/lib/server/database";

const shimPath = fileURLToPath(new URL("../../../../scripts/e2e-docker-shim.sh", import.meta.url));

function post(path: string, body: unknown) {
  return new Request(`http://studio.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function notebook(): NotebookDoc {
  const now = "2026-11-01T00:00:00.000Z";
  return {
    id: "nb_env",
    name: "round_trip",
    description: "说明",
    kernel: "py311-pandas",
    language: "python",
    rev: 1,
    createdAt: now,
    updatedAt: now,
    cells: [
      { id: "in", role: "input", source: "# @input name=title type=str default=\"hi\"\ntitle = \"hi\"\n" },
      { id: "out", role: "output", source: "# @output name=report type=path pattern=\"report.txt\"\nopen('report.txt','w').write(title)\n" },
    ],
  };
}

describe("try-run http", () => {
  it("runs the posted conda and container instead of the host interpreter", async () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-try-"));
    const previous = process.env.TRY_RUN_CONTAINER_BIN;
    process.env.TRY_RUN_CONTAINER_BIN = shimPath;
    const yaml = join(directory, "py311-pandas.yml");
    writeFileSync(yaml, "name: py311-pandas\ndependencies:\n  - python\n");
    try {
      const db = new StudioStore(join(directory, "studio.sqlite"));
      const saved = db.saveNotebook(notebook());
      const response = await handleNotebookApi("POST", ["notebooks", saved.id, "try-run"], post("/api/notebooks/nb_env/try-run", {
        args: { title: "hi" },
        condaYaml: yaml,
        containerImage: "python:3.11-slim",
      }), db);
      expect(response.status).toBe(200);
      const record = await response.json() as TryRunRecord;
      expect(record.passed).toBe(true);
      expect(record.envVia).toBe("container");
      expect(record.condaYaml).toBe(yaml);
      expect(record.containerImage).toBe("python:3.11-slim");
      expect(record.log).toContain(`conda '${yaml}'`);
      expect(record.log).toContain("选用 container 'python:3.11-slim'");
      expect(record.log).toContain("e2e docker shim: image python:3.11-slim");
      expect(record.log).not.toContain("选用本机");
      expect(db.tryRun(saved.id, saved.rev)?.envVia).toBe("container");

      await expect(handleNotebookApi("POST", ["notebooks", saved.id, "try-run"], post("/api/notebooks/nb_env/try-run", {
        condaYaml: "/envs/a\n.yml",
      }), db)).rejects.toThrow(/换行/);
      const owned = await handleNotebookApi("POST", ["notebooks", saved.id, "try-run"], post("/api/notebooks/nb_env/try-run", {
        bindings: [{ port: "title", source: "path", value: "bound" }],
        condaYaml: yaml,
        containerImage: "python:3.11-slim",
      }), db);
      expect(owned.status).toBe(200);
      const bound = await owned.json() as TryRunRecord;
      expect(bound.passed).toBe(true);
      expect(bound.envVia).toBe("container");
      expect(bound.log).toContain("输入 title · 路径 · bound");
      expect(bound.bindings).toEqual([{ port: "title", source: "path", label: "bound" }]);
      expect(bound.log).toContain("选用 container 'python:3.11-slim'");

      db.close();
    } finally {
      if (previous === undefined) delete process.env.TRY_RUN_CONTAINER_BIN;
      else process.env.TRY_RUN_CONTAINER_BIN = previous;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
