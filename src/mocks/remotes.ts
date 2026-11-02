import { delay, http, HttpResponse } from "msw";

import type { RemoteHost, RemoteProbe } from "@/features/remote/types";

/** The demo's cluster. Nothing connects to it; the connection test answers from here. */
export const DEMO_REMOTE_HOST: RemoteHost = {
  id: "hpc-lab",
  name: "实验室集群（演示）",
  host: "login.hpc.example.org",
  user: "you",
  baseDir: "~/nextflow-studio",
  setup: "module load java/17 nextflow",
};

export const sampleProbe = (host: Pick<RemoteHost, "baseDir" | "user">): RemoteProbe => ({
  ok: true,
  baseDir: host.baseDir.replace(/^~/, `/home/${host.user ?? "you"}`),
  nextflow: "/opt/nextflow/bin/nextflow (version 26.10.4)",
  java: 'openjdk version "21.0.4" 2024-07-16',
  schedulers: ["sbatch"],
  runtimes: ["apptainer", "conda"],
});

export const remoteHandlers = [
  http.post("/api/remotes/test", async ({ request }) => {
    const host = (await request.json()) as RemoteHost;
    await delay(400);
    if (host.host.endsWith(".invalid")) {
      return HttpResponse.json({ ok: false, schedulers: [], runtimes: [], error: `${host.host}：找不到这个主机名。\nssh: Could not resolve hostname ${host.host}` } satisfies RemoteProbe);
    }
    return HttpResponse.json(sampleProbe(host));
  }),
];
