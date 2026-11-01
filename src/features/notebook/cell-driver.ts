/** Python driver for one notebook run. Prints nothing; writes results.json. */
export const CELL_DRIVER = `
import ast, base64, builtins, contextlib, io, json, os, sys, tokenize, traceback

os.environ["MPLBACKEND"] = "Agg"

MAX_TEXT = 100_000
MAX_HTML = 200_000
MAX_IMAGE = 1_500_000
MAX_OUTPUTS = 40
IMAGE_MIMES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
TEXT_MIMES = {"text/html", "text/plain", "text/markdown", "text/csv", "text/tab-separated-values", "image/svg+xml"}
PDF_MIMES = {"application/pdf"}
_open = open
_dump = json.dump
_real_import = builtins.__import__
CURRENT = {"bucket": []}

def _clip(text, limit):
    if len(text) <= limit:
        return text
    return text[:limit] + "\\n…（已截断）"

def _append(item):
    bucket = CURRENT["bucket"]
    if len(bucket) >= MAX_OUTPUTS:
        return
    bucket.append(item)

class _Stream(io.TextIOBase):
    def __init__(self, name):
        self.name = name
    def writable(self):
        return True
    def write(self, data):
        if isinstance(data, bytes):
            data = data.decode("utf-8", "replace")
        if not isinstance(data, str) or data == "":
            return 0
        bucket = CURRENT["bucket"]
        if bucket and bucket[-1].get("outputType") == "stream" and bucket[-1].get("name") == self.name:
            current = bucket[-1]
            room = MAX_TEXT - len(current["text"])
            if room <= 0:
                return len(data)
            if len(data) > room:
                current["text"] += data[:room] + "\\n…（已截断）"
            else:
                current["text"] += data
            return len(data)
        _append({"outputType": "stream", "name": self.name, "text": _clip(data, MAX_TEXT)})
        return len(data)
    def flush(self):
        return None

def _safe_repr(obj):
    try:
        text = repr(obj)
    except Exception:
        text = "<%s>" % type(obj).__name__
    return _clip(text, 2_000)

def _call(obj, name):
    fn = getattr(obj, name, None)
    if not callable(fn):
        return None
    try:
        return fn()
    except Exception:
        return None

def _mimebundle(obj):
    fn = getattr(obj, "_repr_mimebundle_", None)
    if not callable(fn):
        return None
    try:
        return fn(None, None)
    except TypeError:
        try:
            return fn()
        except Exception:
            return None
    except Exception:
        return None

def _encode_image(value):
    if isinstance(value, bytes):
        raw = value
    elif isinstance(value, str):
        compact = "".join(value.split())
        try:
            decoded = base64.b64decode(compact, validate=True)
        except Exception:
            decoded = None
        if decoded and (decoded.startswith(b"\\x89PNG") or decoded.startswith(b"\\xff\\xd8\\xff") or decoded.startswith(b"GIF8") or decoded.startswith(b"RIFF")):
            encoded = compact
        else:
            encoded = base64.b64encode(value.encode("utf-8")).decode("ascii")
        if len(encoded) > MAX_IMAGE:
            return None
        return encoded
    else:
        return None
    encoded = base64.b64encode(raw).decode("ascii")
    if len(encoded) > MAX_IMAGE:
        return None
    return encoded

def _encode_pdf(value):
    if isinstance(value, bytes):
        if not value.startswith(b"%PDF"):
            return None
        encoded = base64.b64encode(value).decode("ascii")
    elif isinstance(value, str):
        compact = "".join(value.split())
        try:
            decoded = base64.b64decode(compact, validate=True)
        except Exception:
            decoded = None
        if decoded and decoded.startswith(b"%PDF"):
            encoded = compact
        else:
            return None
    else:
        return None
    if len(encoded) > MAX_IMAGE:
        return None
    return encoded

def _as_text(value, limit):
    if isinstance(value, bytes):
        text = value.decode("utf-8", "replace")
    elif isinstance(value, list):
        text = "".join(_as_text(part, limit) or "" for part in value)
    elif isinstance(value, str):
        text = value
    else:
        return None
    return _clip(text, limit)

def _normalize(data):
    if not isinstance(data, dict):
        return None
    out = {}
    for key, value in data.items():
        if value is None:
            continue
        if key in IMAGE_MIMES:
            encoded = _encode_image(value)
            if encoded:
                out[key] = encoded
        elif key in TEXT_MIMES:
            limit = MAX_TEXT if key == "text/plain" else MAX_HTML
            text = _as_text(value, limit)
            if text:
                out[key] = text
        elif key in PDF_MIMES:
            encoded = _encode_pdf(value)
            if encoded:
                out[key] = encoded
    return out or None

def _bundle(obj):
    if obj is None:
        return None
    data = {}
    raw = _mimebundle(obj)
    if isinstance(raw, tuple):
        raw = raw[0] if raw else None
    if isinstance(raw, dict):
        data.update(raw)
    for mime, method in (
        ("text/html", "_repr_html_"),
        ("text/markdown", "_repr_markdown_"),
        ("image/png", "_repr_png_"),
        ("image/jpeg", "_repr_jpeg_"),
        ("image/gif", "_repr_gif_"),
        ("image/svg+xml", "_repr_svg_"),
        ("application/pdf", "_repr_pdf_"),
        ("text/csv", "_repr_csv_"),
        ("text/tab-separated-values", "_repr_tsv_"),
    ):
        if data.get(mime) is None:
            value = _call(obj, method)
            if value is not None:
                data[mime] = value
    if data.get("text/plain") is None:
        data["text/plain"] = _safe_repr(obj)
    return _normalize(data)

def _is_figure(obj):
    return obj is not None and type(obj).__name__ == "Figure" and callable(getattr(obj, "savefig", None))

def _close_figure(fig):
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    try:
        plt.close(fig)
    except Exception:
        try:
            plt.close()
        except Exception:
            pass

def _figure_png(fig):
    buf = io.BytesIO()
    try:
        fig.savefig(buf, format="png", bbox_inches="tight")
    except Exception:
        buf = io.BytesIO()
        fig.savefig(buf, format="png")
    data = buf.getvalue()
    if not data:
        raise RuntimeError("empty figure")
    encoded = base64.b64encode(data).decode("ascii")
    if len(encoded) > MAX_IMAGE:
        return None
    return encoded

def _emit_figure(fig, output_type):
    png = None
    raw = _call(fig, "_repr_png_")
    if raw is not None:
        png = _encode_image(raw)
    if not png:
        try:
            png = _figure_png(fig)
        except Exception as exc:
            _append({"outputType": "stream", "name": "stderr", "text": "%s\\n" % exc})
            _close_figure(fig)
            return
    if png:
        _append({"outputType": output_type, "data": {"image/png": png, "text/plain": _safe_repr(fig)}})
    _close_figure(fig)

def _flush_figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    try:
        nums = list(plt.get_fignums())
    except Exception:
        return
    for num in nums:
        try:
            fig = plt.figure(num)
        except Exception:
            continue
        _emit_figure(fig, "display_data")

def _patch_pyplot():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None or getattr(getattr(plt, "show", None), "_nf", False):
        return
    def show(*args, **kwargs):
        _flush_figures()
    show._nf = True
    plt.show = show

def _display(*objs, **kwargs):
    for obj in objs:
        if _is_figure(obj):
            _emit_figure(obj, "display_data")
            continue
        bundle = _bundle(obj)
        if bundle:
            _append({"outputType": "display_data", "data": bundle})

def _patch_ipython():
    mod = sys.modules.get("IPython.display")
    if mod is not None:
        mod.display = _display

def _import(name, globals=None, locals=None, fromlist=(), level=0):
    module = _real_import(name, globals, locals, fromlist, level)
    if name == "matplotlib" or name.startswith("matplotlib.") or name == "IPython" or name.startswith("IPython."):
        _patch_pyplot()
        _patch_ipython()
    return module

builtins.__import__ = _import

def _ends_with_semicolon(source):
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except tokenize.TokenError:
        return source.rstrip().endswith(";")
    skip = {tokenize.NL, tokenize.NEWLINE, tokenize.COMMENT, tokenize.ENDMARKER, tokenize.ENCODING, tokenize.INDENT, tokenize.DEDENT}
    significant = [tok for tok in tokens if tok.type not in skip]
    return bool(significant) and significant[-1].string == ";"

def _split(source):
    tree = ast.parse(source, filename="<cell>")
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = tree.body[-1]
        module = ast.Module(body=tree.body[:-1], type_ignores=[])
        expr = ast.Expression(body=last.value)
        ast.fix_missing_locations(module)
        ast.fix_missing_locations(expr)
        return compile(module, "<cell>", "exec"), compile(expr, "<cell>", "eval"), _ends_with_semicolon(source)
    return compile(tree, "<cell>", "exec"), None, False

def _publish(value, suppress):
    if suppress or value is None:
        if _is_figure(value):
            _close_figure(value)
        return
    if _is_figure(value):
        _emit_figure(value, "execute_result")
        return
    bundle = _bundle(value)
    if bundle:
        _append({"outputType": "execute_result", "data": bundle})

def _run(cell, ns):
    bucket = []
    CURRENT["bucket"] = bucket
    stdout, stderr = _Stream("stdout"), _Stream("stderr")
    try:
        body, expr, suppress = _split(cell["source"])
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            _patch_pyplot()
            exec(body, ns, ns)
            value = eval(expr, ns, ns) if expr is not None else None
            _publish(value, suppress)
            _flush_figures()
        return {"id": cell["id"], "outputs": bucket}
    except Exception:
        try:
            _flush_figures()
        except Exception:
            pass
        return {"id": cell["id"], "outputs": bucket, "error": traceback.format_exc()}

cells = json.load(_open("cells.json", encoding="utf-8"))
ns = {"__name__": "__main__", "display": _display}
results = [_run(cell, ns) for cell in cells]
with _open("results.json", "w", encoding="utf-8") as handle:
    _dump(results, handle, ensure_ascii=False)
`;
