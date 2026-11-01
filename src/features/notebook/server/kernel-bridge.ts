/**
 * Python side of a persistent notebook kernel.
 * It starts one Jupyter kernel with jupyter_client and talks JSON lines over stdin and stdout.
 *
 * - `--list` prints the installed kernelspecs and exits.
 * - `--kernel NAME --cwd DIR` starts the kernel, prints a `ready` event, then answers
 *   `{"id": ..., "code": ...}` requests one at a time until stdin closes.
 * - SIGUSR1 interrupts the running cell through jupyter_client, so both signal and message
 *   interrupt modes work. SIGTERM and stdin EOF shut the kernel down.
 *
 * Exit code 3 means jupyter_client or a Python kernel is missing.
 * Kept free of backticks and dollar-brace so it can live in String.raw.
 */
export const KERNEL_BRIDGE = String.raw`
import json, os, queue, re, signal, sys

def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
    sys.stdout.flush()

try:
    from jupyter_client.kernelspec import KernelSpecManager
    from jupyter_client.manager import KernelManager
except Exception as error:
    emit({"event": "missing", "message": "jupyter_client 不可用：%s" % error})
    sys.exit(3)

def specs():
    found = []
    try:
        for name, entry in sorted(KernelSpecManager().get_all_specs().items()):
            spec = entry.get("spec", {})
            found.append({"name": name, "displayName": spec.get("display_name") or name, "language": spec.get("language") or ""})
    except Exception:
        pass
    return found

args = sys.argv[1:]
if args[:1] == ["--list"]:
    emit({"event": "kernels", "python": sys.executable, "kernels": specs()})
    sys.exit(0)

def arg(flag, default=""):
    return args[args.index(flag) + 1] if flag in args and args.index(flag) + 1 < len(args) else default

wanted = arg("--kernel")
cwd = arg("--cwd") or os.getcwd()
installed = [item["name"] for item in specs()]
python_kernels = [item["name"] for item in specs() if item["language"].lower() == "python"]
note = ""
if wanted in installed:
    name = wanted
elif "python3" in installed:
    name = "python3"
    if wanted:
        note = "没有名为 %s 的 Jupyter 内核，改用 python3。" % wanted
elif python_kernels:
    name = python_kernels[0]
    note = "没有名为 %s 的 Jupyter 内核，改用 %s。" % (wanted, name)
else:
    emit({"event": "missing", "message": "没有可用的 Python Jupyter 内核（需要 ipykernel）"})
    sys.exit(3)

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
MIMES = ["text/html", "image/svg+xml", "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
         "text/csv", "text/tab-separated-values", "text/markdown", "text/plain"]
pending_interrupt = [False]

def on_interrupt(signum, frame):
    pending_interrupt[0] = True

def on_term(signum, frame):
    raise SystemExit(0)

signal.signal(signal.SIGUSR1, on_interrupt)
signal.signal(signal.SIGTERM, on_term)
signal.signal(signal.SIGINT, signal.SIG_IGN)

def bundle(data):
    out = {}
    for mime in MIMES:
        value = data.get(mime)
        if value is None:
            continue
        if isinstance(value, list):
            value = "".join(value)
        if not isinstance(value, str):
            continue
        out[mime] = value.strip() if mime.startswith("image/") and mime != "image/svg+xml" else value
    return out

def kernel_pid(km):
    provisioner = getattr(km, "provisioner", None)
    process = getattr(provisioner, "process", None) or getattr(km, "kernel", None)
    return getattr(process, "pid", None)

km = KernelManager(kernel_name=name)
kc = None
try:
    km.start_kernel(cwd=cwd)
    kc = km.client()
    kc.start_channels()
    kc.wait_for_ready(timeout=120)
except SystemExit:
    raise
except Exception as error:
    emit({"event": "failed", "message": "内核 %s 启动失败：%s" % (name, error)})
    try:
        km.shutdown_kernel(now=True)
    except Exception:
        pass
    sys.exit(4)

def run(code):
    pending_interrupt[0] = False
    msg_id = kc.execute(code, store_history=True, allow_stdin=False, stop_on_error=True)
    outputs = []
    count = None
    status = "ok"
    while True:
        if pending_interrupt[0]:
            pending_interrupt[0] = False
            try:
                km.interrupt_kernel()
            except Exception:
                pass
        try:
            msg = kc.get_iopub_msg(timeout=0.2)
        except queue.Empty:
            if not km.is_alive():
                outputs.append({"outputType": "error", "traceback": "内核已退出（可能是内存不足或被结束）。重启内核后再运行。"})
                return {"outputs": outputs, "executionCount": count, "status": "dead"}
            continue
        if msg.get("parent_header", {}).get("msg_id") != msg_id:
            continue
        kind = msg.get("msg_type")
        content = msg.get("content", {})
        if kind == "stream":
            text = content.get("text", "")
            last = outputs[-1] if outputs else None
            if last and last.get("outputType") == "stream" and last.get("name") == content.get("name"):
                last["text"] += text
            else:
                outputs.append({"outputType": "stream", "name": content.get("name", "stdout"), "text": text})
        elif kind in ("display_data", "execute_result"):
            data = bundle(content.get("data", {}))
            if data:
                outputs.append({"outputType": kind, "data": data})
            if kind == "execute_result":
                count = content.get("execution_count", count)
        elif kind == "error":
            status = "error"
            text = "\n".join(content.get("traceback") or []) or "%s: %s" % (content.get("ename", "Error"), content.get("evalue", ""))
            outputs.append({"outputType": "error", "traceback": ANSI.sub("", text)})
        elif kind == "execute_input":
            count = content.get("execution_count", count)
        elif kind == "clear_output":
            outputs = []
        elif kind == "status" and content.get("execution_state") == "idle":
            break
    while True:
        try:
            reply = kc.get_shell_msg(timeout=5)
        except queue.Empty:
            break
        if reply.get("parent_header", {}).get("msg_id") == msg_id:
            content = reply.get("content", {})
            count = content.get("execution_count", count)
            if content.get("status") == "aborted":
                status = "aborted"
            break
    return {"outputs": outputs, "executionCount": count, "status": status}

try:
    emit({"event": "ready", "kernel": name, "pid": kernel_pid(km), "python": sys.executable, "note": note})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        result = run(request.get("code", ""))
        result["id"] = request.get("id")
        emit(result)
        if result["status"] == "dead":
            break
finally:
    try:
        if kc is not None:
            kc.stop_channels()
        km.shutdown_kernel(now=True)
    except Exception:
        pass
`;
