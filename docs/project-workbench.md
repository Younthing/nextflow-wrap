# Project workbench

The selected backend owns the project filesystem and all analysis processes. On Windows, a WSL connection opens Linux folders; downloading exports a copy to Windows. Paths in saved analysis documents never refer to the downloaded copy.

Open a folder, then create notebooks or workflows in the selected directory of the file explorer. Notebooks (`.ipynb`), workflow canvases (`.workflow.json`) and text files share the workbench's tabs. Switching tabs retains each document's editing session. Tab order and project selection belong to the window.

## Files and identity

The first saved analysis document creates `studio.json` with the project format and a portable UUID. The backend handle identifies the physical root on that backend. Copying a project therefore preserves provenance while keeping its live state independent of the original.

Notebook and workflow files are authoritative. Their IDs survive renames and moves; copied documents receive new IDs. `notebooks/` and `workflows/` are defaults, not required locations. Large data and runtime directories are not recursively indexed; documents there can be opened directly from the explorer.

Saving compares a digest of the bytes originally read and uses a temporary sibling file plus atomic replacement. External changes never silently overwrite a dirty editor. The conflict UI offers comparison, reload, a new copy, or an explicit overwrite. External deletion is not undone by background saves. Moving files in the explorer can preview updates to declared workflow file references; code strings are never rewritten.

## Data and execution

Analysis paths are relative to the project root, including typed paths in workflow inputs and sample-sheet file columns. Absolute backend paths, parent-relative paths and supported storage URIs are allowed. External data must remain available separately when a project is moved. Project file mutations cannot traverse outside the root or follow external symlinks for writes.

A cluster run copies the workspace files and folders it names, and the files a workspace sample sheet lists, into `<baseDir>/projects/<project>/` on the host at the same relative paths before Nextflow starts; parameters point there and sample-sheet columns resolve against it. Files the host already has with the same size and modification time are not sent again. Globs and paths outside the project are refused; data already on the cluster is named by its absolute path or storage URI.

Notebook kernels start at the project root. Explicit `chdir` calls retain the language runtime's normal meaning. Module tests execute in a task directory with staged inputs. Data files no longer have a fixed 32 MB staging limit.

Published modules are immutable versions under `modules/<name>/<version>/`, including the definition, executable source, environment when supplied, and the source notebook. The shared library can distribute a complete version; installation saves a local copy so the project remains independent. Workflows reference a specific local version. Publishing a newer version does not change existing workflow nodes.

Each run lives in `runs/<run-id>/`, with `run.json`, a `snapshot/`, a `logs/` directory and `results/`. Requested and resolved parameters are recorded separately. Generated launch directories and task scratch data are in `.studio/runtime/`. Results are copied rather than linked to mutable task scratch files.

`.studio/state.sqlite` indexes and schedules the project. Run records and task records on disk can rebuild that index. Moving the project rebases result locations and disables resume of old machine-specific scratch state. Shared environments and container caches remain backend-wide.

Closing an editor tab leaves its kernel alive. The last window disconnecting from the project releases its kernels after a reconnect grace period. Submitted workflows are managed independently by the runner.

## Format change

This model does not migrate the former global content database (`studio.sqlite` in the data directory) automatically. The new recent-project registry uses a separate file; existing application data and project folders are not automatically deleted. While the old database still holds workflows or published modules, the workbench start page offers to import them into the open project: workflows go to `workflows/旧版导入/`, modules to `modules/` with their original ids so imported nodes still resolve, and anything the project already has is skipped. The old database is left untouched, so the same content can be imported into another project. Newly seeded examples are ordinary projects in a separate example directory.

## End-to-end validation

Run `pnpm smoke:project` on the Linux/WSL backend with Java, the pinned Nextflow release and a Python with ipykernel available. `NEXTFLOW_STUDIO_JUPYTER_PYTHON` can select that interpreter. The smoke check creates an isolated temporary backend and project, executes a notebook, tests and publishes its module, runs the workflow through the actual runner, copies the active project to verify isolation, and checks that resume uses cached tasks. It prints the temporary project location for inspection. CI runs it in the e2e job.
