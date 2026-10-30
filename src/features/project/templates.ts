/**
 * nf-core pipeline template pieces (nf-core/tools 3.5 layout), filled in for
 * a generated project. Groovy `${…}` is written as `@{…}` (see `nf`).
 */
import { BANNER, nf, section } from "./groovy";

export interface ProjectMeta {
  /** Repository-style name, e.g. `studio/rnaseq`. */
  name: string;
  /** Lowercase short name used in file names, e.g. `rnaseq`. */
  shortName: string;
  /** Upper-case workflow name, e.g. `RNASEQ`. */
  workflowName: string;
  description: string;
  author: string;
  version: string;
}

export const NEXTFLOW_VERSION = "25.10.4";
export const NF_SCHEMA_VERSION = "2.7.3";

export function mainNf(meta: ProjectMeta, referenceParams: string[]): string {
  const genomeDefaults = referenceParams.length
    ? `${section("GENOME PARAMETER VALUES")}

${referenceParams.map((p) => `params.${p} = params.${p} ?: getGenomeAttribute('${p}')`).join("\n")}

`
    : "";
  return nf`#!/usr/bin/env nextflow
/*
${BANNER}
    ${meta.name}
${BANNER}
    ${meta.description}
----------------------------------------------------------------------------------------
*/

${section("IMPORT FUNCTIONS / MODULES / SUBWORKFLOWS / WORKFLOWS")}

include { ${meta.workflowName.padEnd(23)} } from './workflows/${meta.shortName}'
include { PIPELINE_INITIALISATION } from './subworkflows/local/utils_nfcore_${meta.shortName}_pipeline'
include { PIPELINE_COMPLETION     } from './subworkflows/local/utils_nfcore_${meta.shortName}_pipeline'
include { getGenomeAttribute      } from './subworkflows/local/utils_nfcore_${meta.shortName}_pipeline'

${genomeDefaults}${section("RUN MAIN WORKFLOW")}

workflow {

    main:
    //
    // SUBWORKFLOW: Run initialisation tasks
    //
    PIPELINE_INITIALISATION (
        params.version,
        params.validate_params,
        params.monochrome_logs,
        args,
        params.outdir,
        params.input,
        params.help,
        params.help_full,
        params.show_hidden
    )

    //
    // WORKFLOW: Run main workflow
    //
    ${meta.workflowName} (
        PIPELINE_INITIALISATION.out.samplesheet,
        params.multiqc_config,
        params.multiqc_logo,
        params.multiqc_methods_description,
        params.outdir,
    )

    //
    // SUBWORKFLOW: Run completion tasks
    //
    PIPELINE_COMPLETION (
        params.email,
        params.email_on_fail,
        params.plaintext_email,
        params.outdir,
        params.monochrome_logs,
        ${meta.workflowName}.out.multiqc_report
    )
}

${section("THE END")}
`;
}

export function utilsSubworkflow(meta: ProjectMeta, citations: { inText: string; bibliography: string }[]): string {
  const citationLines = citations.map((c) => `            "${c.inText},",`).join("\n");
  const bibLines = citations.map((c) => `            "<li>${c.bibliography}</li>",`).join("\n");
  return nf`//
// Subworkflow with functionality specific to the ${meta.name} pipeline
//

${section("IMPORT FUNCTIONS / MODULES / SUBWORKFLOWS")}

include { UTILS_NFSCHEMA_PLUGIN     } from '../../nf-core/utils_nfschema_plugin'
include { paramsSummaryMap          } from 'plugin/nf-schema'
include { samplesheetToList         } from 'plugin/nf-schema'
include { paramsHelp                } from 'plugin/nf-schema'
include { completionEmail           } from '../../nf-core/utils_nfcore_pipeline'
include { completionSummary         } from '../../nf-core/utils_nfcore_pipeline'
include { UTILS_NFCORE_PIPELINE     } from '../../nf-core/utils_nfcore_pipeline'
include { UTILS_NEXTFLOW_PIPELINE   } from '../../nf-core/utils_nextflow_pipeline'

${section("SUBWORKFLOW TO INITIALISE PIPELINE")}

workflow PIPELINE_INITIALISATION {

    take:
    version           // boolean: Display version and exit
    validate_params   // boolean: Boolean whether to validate parameters against the schema at runtime
    monochrome_logs   // boolean: Do not use coloured log outputs
    nextflow_cli_args //   array: List of positional nextflow CLI args
    outdir            //  string: The output directory where the results will be saved
    input             //  string: Path to input samplesheet
    help              // boolean: Display help message and exit
    help_full         // boolean: Show the full help message
    show_hidden       // boolean: Show hidden parameters in the help message

    main:

    ch_versions = channel.empty()

    //
    // Print version and exit if required and dump pipeline parameters to JSON file
    //
    UTILS_NEXTFLOW_PIPELINE (
        version,
        true,
        outdir,
        workflow.profile.tokenize(',').intersect(['conda', 'mamba']).size() >= 1
    )

    //
    // Validate parameters and generate parameter summary to stdout
    //
    def before_text = ""
    def after_text = ""
    def command = "nextflow run @{workflow.manifest.name} -profile <docker/singularity/.../institute> --input samplesheet.csv --outdir <OUTDIR>"

    UTILS_NFSCHEMA_PLUGIN (
        workflow,
        validate_params,
        null,
        help,
        help_full,
        show_hidden,
        before_text,
        after_text,
        command,
        null
    )

    //
    // Check config provided to the pipeline
    //
    UTILS_NFCORE_PIPELINE (
        nextflow_cli_args
    )

    //
    // Custom validation for pipeline parameters
    //
    validateInputParameters()

    //
    // Create channel from input file provided through params.input
    //
    channel
        .fromList(samplesheetToList(input, "@{projectDir}/assets/schema_input.json"))
        .map {
            meta, fastq_1, fastq_2 ->
                if (!fastq_2) {
                    return [ meta.id, meta + [ single_end:true ], [ fastq_1 ] ]
                } else {
                    return [ meta.id, meta + [ single_end:false ], [ fastq_1, fastq_2 ] ]
                }
        }
        .groupTuple()
        .map { samplesheet ->
            validateInputSamplesheet(samplesheet)
        }
        .map {
            meta, fastqs ->
                return [ meta, fastqs.flatten() ]
        }
        .set { ch_samplesheet }

    emit:
    samplesheet = ch_samplesheet
    versions    = ch_versions
}

${section("SUBWORKFLOW FOR PIPELINE COMPLETION")}

workflow PIPELINE_COMPLETION {

    take:
    email           //  string: email address
    email_on_fail   //  string: email address sent on pipeline failure
    plaintext_email // boolean: Send plain-text email instead of HTML
    outdir          //    path: Path to output directory where results will be published
    monochrome_logs // boolean: Disable ANSI colour codes in log output
    multiqc_report  //  string: Path to MultiQC report

    main:
    summary_params = paramsSummaryMap(workflow, parameters_schema: "nextflow_schema.json")
    def multiqc_reports = multiqc_report.toList()

    //
    // Completion email and summary
    //
    workflow.onComplete {
        if (email || email_on_fail) {
            completionEmail(
                summary_params,
                email,
                email_on_fail,
                plaintext_email,
                outdir,
                monochrome_logs,
                multiqc_reports.isBound() ? multiqc_reports.getVal() : [],
            )
        }

        completionSummary(monochrome_logs)
    }

    workflow.onError {
        log.error "Pipeline failed. Please refer to troubleshooting docs: https://nf-co.re/docs/running/troubleshooting"
    }
}

${section("FUNCTIONS")}

//
// Check and validate pipeline parameters
//
def validateInputParameters() {
    genomeExistsError()
}

//
// Validate channels from input samplesheet
//
def validateInputSamplesheet(input) {
    def (metas, fastqs) = input[1..2]

    // Generated pipelines have no lane-merging step, so modules expect one or two FastQ files per sample
    if (metas.size() > 1) {
        error("Please check input samplesheet -> Sample @{metas[0].id} has @{metas.size()} rows. Merge its lanes into one FastQ (pair) per sample first.")
    }

    // Check that multiple runs of the same sample are of the same datatype i.e. single-end / paired-end
    def endedness_ok = metas.collect{ meta -> meta.single_end }.unique().size == 1
    if (!endedness_ok) {
        error("Please check input samplesheet -> Multiple runs of a sample must be of the same datatype i.e. single-end or paired-end: @{metas[0].id}")
    }

    return [ metas[0], fastqs ]
}

//
// Get attribute from genome config file e.g. fasta
//
def getGenomeAttribute(attribute) {
    if (params.containsKey('genomes') && params.genomes && params.genome && params.genomes.containsKey(params.genome)) {
        if (params.genomes[ params.genome ].containsKey(attribute)) {
            return params.genomes[ params.genome ][ attribute ]
        }
    }
    return null
}

//
// Exit pipeline if incorrect --genome key provided
//
def genomeExistsError() {
    if (params.containsKey('genomes') && params.genomes && params.genome && !params.genomes.containsKey(params.genome)) {
        error("Genome '@{params.genome}' not found in any config files provided to the pipeline. Available genome keys: @{params.genomes.keySet().join(", ")}")
    }
}

//
// Generate methods description for MultiQC
//
def toolCitationText() {
    def citation_text = [
            "Tools used in the workflow included:",
${citationLines}
            "."
        ].join(' ').trim()

    return citation_text
}

def toolBibliographyText() {
    def reference_text = [
${bibLines}
        ].join(' ').trim()

    return reference_text
}

def methodsDescriptionText(mqc_methods_yaml) {
    // Convert  to a named map so can be used as with familiar NXF @{workflow} variable syntax in the MultiQC YML file
    def meta = [:]
    meta.workflow = workflow.toMap()
    meta["manifest_map"] = workflow.manifest.toMap()

    // Pipeline DOI
    if (meta.manifest_map.doi) {
        def temp_doi_ref = ""
        def manifest_doi = meta.manifest_map.doi.tokenize(",")
        manifest_doi.each { doi_ref ->
            temp_doi_ref += "(doi: <a href=\\'https://doi.org/@{doi_ref.replace("https://doi.org/", "").replace(" ", "")}\\'>@{doi_ref.replace("https://doi.org/", "").replace(" ", "")}</a>), "
        }
        meta["doi_text"] = temp_doi_ref.substring(0, temp_doi_ref.length() - 2)
    } else meta["doi_text"] = ""
    meta["nodoi_text"] = meta.manifest_map.doi ? "" : "<li>If available, make sure to update the text to include the Zenodo DOI of version of the pipeline used. </li>"

    // Tool references
    meta["tool_citations"] = toolCitationText().replaceAll(", \\\\.", ".").replaceAll("\\\\. \\\\.", ".").replaceAll(", \\\\.", ".")
    meta["tool_bibliography"] = toolBibliographyText()

    def methods_text = mqc_methods_yaml.text

    def engine =  new groovy.text.SimpleTemplateEngine()
    def description_html = engine.createTemplate(methods_text).make(meta)

    return description_html.toString()
}
`;
}

const CONTAINER_ENGINES = `    conda {
        conda.enabled           = true
        docker.enabled          = false
        singularity.enabled     = false
        podman.enabled          = false
        shifter.enabled         = false
        charliecloud.enabled    = false
        conda.channels          = ['conda-forge', 'bioconda']
        apptainer.enabled       = false
    }
    mamba {
        conda.enabled           = true
        conda.useMamba          = true
        docker.enabled          = false
        singularity.enabled     = false
        podman.enabled          = false
        shifter.enabled         = false
        charliecloud.enabled    = false
        apptainer.enabled       = false
    }
    docker {
        docker.enabled          = true
        conda.enabled           = false
        singularity.enabled     = false
        podman.enabled          = false
        shifter.enabled         = false
        charliecloud.enabled    = false
        apptainer.enabled       = false
        docker.runOptions       = '-u $(id -u):$(id -g)'
    }
    arm64 {
        process.arch            = 'arm64'
        apptainer.ociAutoPull   = true
        singularity.ociAutoPull = true
        wave.enabled            = true
        wave.freeze             = true
        wave.strategy           = 'conda,container'
    }
    emulate_amd64 {
        docker.runOptions       = '-u $(id -u):$(id -g) --platform=linux/amd64'
    }
    singularity {
        singularity.enabled     = true
        singularity.autoMounts  = true
        conda.enabled           = false
        docker.enabled          = false
        podman.enabled          = false
        shifter.enabled         = false
        charliecloud.enabled    = false
        apptainer.enabled       = false
    }
    podman {
        podman.enabled          = true
        conda.enabled           = false
        docker.enabled          = false
        singularity.enabled     = false
        shifter.enabled         = false
        charliecloud.enabled    = false
        apptainer.enabled       = false
    }
    apptainer {
        apptainer.enabled       = true
        apptainer.autoMounts    = true
        conda.enabled           = false
        docker.enabled          = false
        singularity.enabled     = false
        podman.enabled          = false
        shifter.enabled         = false
        charliecloud.enabled    = false
    }
    wave {
        apptainer.ociAutoPull   = true
        singularity.ociAutoPull = true
        wave.enabled            = true
        wave.freeze             = true
        wave.strategy           = 'conda,container'
    }
    gpu {
        docker.runOptions       = '-u $(id -u):$(id -g) --gpus all'
        apptainer.runOptions    = '--nv'
        singularity.runOptions  = '--nv'
    }`;

export function nextflowConfig(meta: ProjectMeta, paramsBlock: string, registry: string): string {
  return nf`/*
${BANNER}
    ${meta.name} Nextflow config file
${BANNER}
    Default config options for all compute environments
----------------------------------------------------------------------------------------
*/

// Global default params, used in configs
params {
${paramsBlock}
}

// Load base.config by default for all pipelines
includeConfig 'conf/base.config'

profiles {
    debug {
        dumpHashes              = true
        process.beforeScript    = 'echo $HOSTNAME'
        cleanup                 = false
        nextflow.enable.configProcessNamesValidation = true
    }
${CONTAINER_ENGINES}
    test      { includeConfig 'conf/test.config' }
}

// Load nf-core custom profiles from different institutions
includeConfig params.custom_config_base && (!System.getenv('NXF_OFFLINE') || !params.custom_config_base.startsWith('http')) ? "@{params.custom_config_base}/nfcore_custom.config" : "/dev/null"

// Container registry used when a module only names an image
apptainer.registry    = '${registry}'
docker.registry       = '${registry}'
podman.registry       = '${registry}'
singularity.registry  = '${registry}'
charliecloud.registry = '${registry}'

// Export these variables to prevent local Python/R libraries from conflicting with those in the container
env {
    PYTHONNOUSERSITE = 1
    R_PROFILE_USER   = "/.Rprofile"
    R_ENVIRON_USER   = "/.Renviron"
    JULIA_DEPOT_PATH = "/usr/local/share/julia"
}

// Set bash options
process.shell = [
    "bash",
    "-C",         // No clobber - prevent output redirection from overwriting files.
    "-e",         // Exit if a tool returns a non-zero status/exit code
    "-u",         // Treat unset variables and parameters as an error
    "-o",         // Returns the status of the last command to exit..
    "pipefail"    //   ..with a non-zero status or zero if all successfully execute
]

// Disable process selector warnings by default. Use debug profile to enable warnings.
nextflow.enable.configProcessNamesValidation = false

timeline {
    enabled = true
    file    = "@{params.outdir}/pipeline_info/execution_timeline_@{params.trace_report_suffix}.html"
}
report {
    enabled = true
    file    = "@{params.outdir}/pipeline_info/execution_report_@{params.trace_report_suffix}.html"
}
trace {
    enabled = true
    file    = "@{params.outdir}/pipeline_info/execution_trace_@{params.trace_report_suffix}.txt"
}
dag {
    enabled = true
    file    = "@{params.outdir}/pipeline_info/pipeline_dag_@{params.trace_report_suffix}.html"
}

manifest {
    name            = '${meta.name}'
    contributors    = [
        [
            name: '${meta.author}',
            affiliation: '',
            email: '',
            github: '',
            contribution: ['author'],
            orcid: ''
        ],
    ]
    homePage        = 'https://github.com/${meta.name}'
    description     = """${meta.description}"""
    mainScript      = 'main.nf'
    defaultBranch   = 'main'
    nextflowVersion = '!>=${NEXTFLOW_VERSION}'
    version         = '${meta.version}'
    doi             = ''
}

// Nextflow plugins
plugins {
    id 'nf-schema@${NF_SCHEMA_VERSION}' // Validation of pipeline parameters and creation of an input channel from a sample sheet
}

validation {
    defaultIgnoreParams = ["genomes"]
    monochromeLogs = params.monochrome_logs
}

// Load modules.config for DSL2 module specific options
includeConfig 'conf/modules.config'
`;
}

export function baseConfig(meta: ProjectMeta): string {
  return nf`/*
${BANNER}
    ${meta.name} Nextflow base config file
${BANNER}
    A 'blank slate' config file, appropriate for general use on most high performance
    compute environments. Assumes that all software is installed and available on
    the PATH. Runs in \`local\` mode - all jobs will be run on the logged in environment.
----------------------------------------------------------------------------------------
*/

process {

    cpus   = { 1      * task.attempt }
    memory = { 6.GB   * task.attempt }
    time   = { 4.h    * task.attempt }

    errorStrategy = { task.exitStatus in ((130..145) + 104 + (175..177)) ? 'retry' : 'finish' }
    maxRetries    = 1
    maxErrors     = '-1'

    withLabel:process_single {
        cpus   = { 1                   }
        memory = { 6.GB * task.attempt }
        time   = { 4.h  * task.attempt }
    }
    withLabel:process_low {
        cpus   = { 2     * task.attempt }
        memory = { 12.GB * task.attempt }
        time   = { 4.h   * task.attempt }
    }
    withLabel:process_medium {
        cpus   = { 6     * task.attempt }
        memory = { 36.GB * task.attempt }
        time   = { 8.h   * task.attempt }
    }
    withLabel:process_high {
        cpus   = { 12    * task.attempt }
        memory = { 72.GB * task.attempt }
        time   = { 16.h  * task.attempt }
    }
    withLabel:process_long {
        time   = { 20.h  * task.attempt }
    }
    withLabel:process_low_memory {
        memory = { 1.GB * task.attempt }
    }
    withLabel:process_high_memory {
        memory = { 200.GB * task.attempt }
    }
    withLabel:error_ignore {
        errorStrategy = 'ignore'
    }
    withLabel:error_retry {
        errorStrategy = 'retry'
        maxRetries    = 2
    }
    withLabel: process_gpu {
        accelerator = { workflow.profile.contains('gpu') ? 1 : null }
    }
}
`;
}

/** Resource directives per nf-core label, used when a node overrides its label. */
export const LABEL_RESOURCES: Record<string, string[]> = {
  process_single: ["cpus   = { 1 }", "memory = { 6.GB * task.attempt }", "time   = { 4.h * task.attempt }"],
  process_low: ["cpus   = { 2 * task.attempt }", "memory = { 12.GB * task.attempt }", "time   = { 4.h * task.attempt }"],
  process_medium: ["cpus   = { 6 * task.attempt }", "memory = { 36.GB * task.attempt }", "time   = { 8.h * task.attempt }"],
  process_high: ["cpus   = { 12 * task.attempt }", "memory = { 72.GB * task.attempt }", "time   = { 16.h * task.attempt }"],
  process_long: ["time   = { 20.h * task.attempt }"],
  process_high_memory: ["memory = { 200.GB * task.attempt }"],
};

export function testConfig(meta: ProjectMeta): string {
  return nf`/*
${BANNER}
    Nextflow config file for running minimal tests
${BANNER}
    Use as follows:
        nextflow run ${meta.name} -profile test,<docker/singularity> --outdir <OUTDIR>
----------------------------------------------------------------------------------------
*/

process {
    resourceLimits = [
        cpus: 4,
        memory: '15.GB',
        time: '1.h'
    ]
}

params {
    config_profile_name        = 'Test profile'
    config_profile_description = 'Minimal test dataset to check pipeline function'

    // Supply real reads in this samplesheet (the generated CSV documents its format).
    input = "@{projectDir}/assets/samplesheet.csv"
}
`;
}

export const MULTIQC_CONFIG = (meta: ProjectMeta) => `report_comment: >
  This report has been generated by the <a href="https://github.com/${meta.name}" target="_blank">${meta.name}</a>
  analysis pipeline, built with Nextflow Studio.
report_section_order:
  "${meta.shortName}-methods-description":
    order: -1000
  software_versions:
    order: -1001
  "${meta.shortName}-summary":
    order: -1002

export_plots: true

disable_version_detection: true
`;

export const METHODS_DESCRIPTION = (meta: ProjectMeta) => `id: "${meta.shortName}-methods-description"
description: "Suggested text and references to use when describing pipeline usage within the methods section of a publication."
section_name: "${meta.name} Methods Description"
section_href: "https://github.com/${meta.name}"
plot_type: "html"
data: |
  <h4>Methods</h4>
  <p>Data was processed using ${meta.name} v\${workflow.manifest.version} \${doi_text} of the nf-core collection of workflows (<a href="https://doi.org/10.1038/s41587-020-0439-x">Ewels <em>et al.</em>, 2020</a>), utilising reproducible software environments from the Bioconda (<a href="https://doi.org/10.1038/s41592-018-0046-7">Grüning <em>et al.</em>, 2018</a>) and Biocontainers (<a href="https://doi.org/10.1093/bioinformatics/btx192">da Veiga Leprevost <em>et al.</em>, 2017</a>) projects.</p>
  <p>The pipeline was executed with Nextflow v\${workflow.nextflow.version} (<a href="https://doi.org/10.1038/nbt.3820">Di Tommaso <em>et al.</em>, 2017</a>) with the following command:</p>
  <pre><code>\${workflow.commandLine}</code></pre>
  <p>\${tool_citations}</p>
  <h4>References</h4>
  <ul>
    <li>Di Tommaso, P., Chatzou, M., Floden, E. W., Barja, P. P., Palumbo, E., & Notredame, C. (2017). Nextflow enables reproducible computational workflows. Nature Biotechnology, 35(4), 316-319. doi: <a href="https://doi.org/10.1038/nbt.3820">10.1038/nbt.3820</a></li>
    <li>Ewels, P. A., Peltzer, A., Fillinger, S., Patel, H., Alneberg, J., Wilm, A., Garcia, M. U., Di Tommaso, P., & Nahnsen, S. (2020). The nf-core framework for community-curated bioinformatics pipelines. Nature Biotechnology, 38(3), 276-278. doi: <a href="https://doi.org/10.1038/s41587-020-0439-x">10.1038/s41587-020-0439-x</a></li>
    \${tool_bibliography}
  </ul>
  <div class="alert alert-info">
    <h5>Notes:</h5>
    <ul>
      \${nodoi_text}
      <li>The command above does not include parameters contained in any configs or profiles that may have been used. Ensure the config file is also uploaded with your publication!</li>
      <li>You should also cite all software used within this pipeline. Check the "Software Versions" of this report to get version information.</li>
    </ul>
  </div>
`;

export const SAMPLESHEET_CSV = `sample,fastq_1,fastq_2
SAMPLE_PAIRED_END,/path/to/fastq/files/AEG588A1_S1_L002_R1_001.fastq.gz,/path/to/fastq/files/AEG588A1_S1_L002_R2_001.fastq.gz
SAMPLE_SINGLE_END,/path/to/fastq/files/AEG588A4_S4_L003_R1_001.fastq.gz,
`;
