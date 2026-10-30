#!/usr/bin/env node
/**
 * Builds src/data/nf-core-modules.json from upstream nf-core/modules.
 *
 * For each module we read meta.yml (typed inputs/outputs, tools, keywords)
 * and main.nf (process name, resource label, container). The JSON is
 * committed so the app works offline; rerun this script to refresh it:
 *
 *   node scripts/sync-nf-core-modules.mjs
 */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { parse } from "yaml";

// Pin to a commit so modules.json in generated projects can reference it.
const REF =
  process.env.NF_CORE_MODULES_REF ??
  execFileSync("git", ["ls-remote", "https://github.com/nf-core/modules", "refs/heads/master"], {
    encoding: "utf8",
  }).split("\t")[0];
const RAW = `https://raw.githubusercontent.com/nf-core/modules/${REF}/modules/nf-core`;

/** Modules exposed in the library, grouped by category for the side panel. */
const CATALOG = {
  质控: ["fastqc", "multiqc", "fastp", "trimgalore", "cutadapt", "seqkit/stats", "qualimap/rnaseq"],
  比对: ["star/genomegenerate", "star/align", "hisat2/build", "hisat2/align", "bwa/index", "bwa/mem", "bowtie2/build", "bowtie2/align"],
  定量: ["salmon/index", "salmon/quant", "subread/featurecounts", "stringtie/stringtie"],
  "BAM 处理": ["samtools/sort", "samtools/index", "samtools/flagstat", "samtools/stats", "picard/markduplicates", "deeptools/bamcoverage"],
  变异检测: ["gatk4/haplotypecaller", "bcftools/stats"],
  宏基因组: ["kraken2/kraken2"],
  工具: ["gunzip", "cat/fastq"],
};

/**
 * Inputs that gather files from many upstream tasks: every connected
 * channel is mixed and `.collect()`ed before the call.
 */
const COLLECT_INPUTS = {
  multiqc: ["multiqc_files"],
};

const VALUE_TYPES = new Set(["string", "integer", "boolean", "float", "number", "list", "value"]);

/** Rough file format from a glob pattern, used to warn on odd connections. */
const FORMATS = [
  ["html", /html/i],
  ["zip", /\.zip/i],
  ["json", /json/i],
  ["fastq", /f(ast)?q/i],
  ["bai", /\bbai\b|\.bai|\bcsi\b|\.csi/i],
  ["bam", /\bbam\b|\.bam/i],
  ["sam", /\.sam\b/i],
  ["cram", /cram/i],
  ["vcf", /vcf/i],
  ["fai", /\bfai\b|\.fai/i],
  ["fasta", /fa(sta)?\b|fna|fas\b/i],
  ["gtf", /gtf|gff/i],
  ["bed", /\bbed\b|\.bed/i],
  ["txt", /\.txt|\.tsv|\.tab|\.csv|\.log|\.out\b/i],
  ["bigwig", /bigwig|\.bw\b/i],
];

function formatOf(name, pattern) {
  const probe = `${pattern ?? ""} ${name}`;
  for (const [fmt, re] of FORMATS) if (re.test(probe)) return fmt;
  return undefined;
}

function element(entry) {
  const [name, spec] = Object.entries(entry)[0];
  const type = String(spec?.type ?? "file").toLowerCase();
  // Upstream metadata occasionally mislabels types (e.g. bwa/index declares
  // its index files as `map`), so the element name decides what is a meta map.
  const kind = /^meta\d*$/.test(name)
    ? "meta"
    : VALUE_TYPES.has(type) || (type === "map" && !spec?.pattern)
      ? "value"
      : "file";
  const out = {
    name,
    type,
    kind,
    description: (spec?.description ?? "").trim(),
  };
  if (spec?.pattern) out.pattern = String(spec.pattern);
  if (kind === "file") {
    const fmt = formatOf(name, spec?.pattern);
    if (fmt) out.format = fmt;
  }
  return out;
}

function portFromEntry(entry, fallbackName) {
  const elements = (Array.isArray(entry) ? entry : [entry]).map(element);
  const named = elements.filter((e) => e.kind !== "meta");
  const name =
    fallbackName ??
    (named[0]?.name ?? elements[0].name).replace(/[^A-Za-z0-9_]/g, "") ??
    "input";
  return {
    name,
    description: (named[0] ?? elements[0]).description,
    elements,
  };
}

function parseMain(src) {
  const process = src.match(/^process\s+([A-Z0-9_]+)/m)?.[1];
  const label = src.match(/label\s+['"](process_[a-z_]+)['"]/)?.[1];
  const container = src.match(/'((?:community\.wave\.seqera\.io|quay\.io|biocontainers)[^']+)'\s*}"/)?.[1];
  // Output emit order follows main.nf, which is how users think about it.
  const emits = [...src.matchAll(/emit:\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  // Newer modules publish versions on the `versions` topic; older ones still
  // emit a versions.yml that the workflow has to mix in by hand.
  const versions = /emit:\s*versions\s*$/m.test(src) ? "emit" : "topic";
  return { process, label, container, emits, versions };
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function loadModule(path, category) {
  const [metaSrc, mainSrc] = await Promise.all([
    fetchText(`${RAW}/${path}/meta.yml`),
    fetchText(`${RAW}/${path}/main.nf`),
  ]);
  const meta = parse(metaSrc);
  const main = parseMain(mainSrc);
  const collect = new Set(COLLECT_INPUTS[path] ?? []);

  const inputs = (meta.input ?? []).map((entry) => {
    const port = portFromEntry(entry);
    const names = port.elements.map((e) => e.name);
    if (names.some((n) => collect.has(n))) port.collect = true;
    if (port.elements.every((e) => e.kind === "value")) port.widget = port.elements[0].type;
    return port;
  });

  const outputs = Object.entries(meta.output ?? {})
    .filter(([name]) => !name.startsWith("versions"))
    .map(([name, entries]) => {
      const tuple = Array.isArray(entries) ? entries[0] : entries;
      return portFromEntry(tuple, name);
    })
    .sort((a, b) => main.emits.indexOf(a.name) - main.emits.indexOf(b.name));

  const tools = (meta.tools ?? []).map((t) => {
    const [name, spec] = Object.entries(t)[0];
    return {
      name,
      description: (spec?.description ?? "").trim(),
      homepage: spec?.homepage ?? spec?.documentation,
      doi: spec?.doi,
      licence: spec?.licence,
    };
  });

  return {
    id: `nf-core/${path}`,
    path,
    name: meta.name ?? path.replace("/", "_"),
    process: main.process ?? path.replace("/", "_").toUpperCase(),
    category,
    description: (meta.description ?? "").trim(),
    keywords: meta.keywords ?? [],
    tools,
    label: main.label,
    container: main.container,
    versions: main.versions,
    inputs,
    outputs,
  };
}

const modules = [];
for (const [category, paths] of Object.entries(CATALOG)) {
  for (const path of paths) {
    try {
      modules.push(await loadModule(path, category));
      process.stdout.write(`✓ ${path}\n`);
    } catch (err) {
      process.stderr.write(`✗ ${path}: ${err.message}\n`);
      process.exitCode = 1;
    }
  }
}

const out = {
  source: `https://github.com/nf-core/modules/tree/${REF}`,
  gitSha: REF,
  syncedAt: new Date().toISOString().slice(0, 10),
  modules,
};
await writeFile(
  new URL("../src/data/nf-core-modules.json", import.meta.url),
  JSON.stringify(out, null, 2) + "\n",
);
process.stdout.write(`Wrote ${modules.length} modules\n`);
