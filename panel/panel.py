"""ForexBot Control Panel — herramienta de escritorio (tkinter).

Inicia / detiene / reinicia los servicios de ForexBot (Bridge, Laravel, Reverb,
Queue Worker) y muestra su salud en tiempo real, al estilo del XAMPP Control
Panel. Es externo a la web a propósito: la web es uno de los servicios que hay
que poder encender desde aquí.

Uso:  python panel.py      (o doble clic en panel.exe si se empaqueta)
Dependencia: psutil  (pip install -r requirements.txt)
"""

from __future__ import annotations

import json
import os
import queue
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from tkinter import messagebox

try:
    import psutil
except ImportError:  # pragma: no cover - mensaje claro si falta la dependencia
    print("Falta 'psutil'. Instala con:  pip install -r requirements.txt")
    sys.exit(1)


# --------------------------------------------------------------------------- #
# Rutas y constantes
# --------------------------------------------------------------------------- #
PANEL_DIR = Path(__file__).resolve().parent
ROOT_DIR = PANEL_DIR.parent
BRIDGE_DIR = ROOT_DIR / "bridge"
APP_DIR = ROOT_DIR / "app"
BRIDGE_PY = BRIDGE_DIR / "venv" / "Scripts" / "python.exe"
LOG_DIR = PANEL_DIR / "logs"
STATE_FILE = PANEL_DIR / "panel_state.json"

HEALTH_URL = "http://127.0.0.1:8000/health"
EXPLORE_STATUS_URL = "http://127.0.0.1:8000/explore/status"
EXPLORE_CANCEL_URL = "http://127.0.0.1:8000/explore/cancel"
EXPLORE_RESET_URL = "http://127.0.0.1:8000/explore/reset"
BRIDGE_ENV = BRIDGE_DIR / ".env"

# Banderas de creación de proceso en Windows: sin ventana de consola + grupo
# propio (para que el panel pueda gestionarlo y sobreviva al cierre del panel).
CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_FLAGS = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0

# Paleta (dark, coherente con la plataforma)
BG = "#0D0E11"
PANEL = "#141519"
PANEL2 = "#1B1D23"
TEXT = "#E8E9ED"
MUTED = "#8B8FA8"
GREEN = "#26A69A"
RED = "#EF5350"
GRAY = "#8B8FA8"
YELLOW = "#F59E0B"
BORDER = "#262932"

FONT_LABEL = ("Segoe UI", 10)
FONT_LABEL_B = ("Segoe UI", 10, "bold")
FONT_MONO = ("Consolas", 10)
FONT_TITLE = ("Segoe UI", 13, "bold")
FONT_SMALL = ("Consolas", 8)


def find_php() -> str | None:
    """Resuelve un php.exe utilizable. Prioriza el que usa el usuario a diario."""
    candidates = [
        Path(r"C:\php\php.exe"),
        Path(
            r"C:\Users\<user>\AppData\Local\Microsoft\WinGet\Packages"
            r"\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"
        ),
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    from shutil import which

    return which("php")


PHP = find_php()


# --------------------------------------------------------------------------- #
# Definición de servicios
# --------------------------------------------------------------------------- #
def _service_defs() -> list[dict]:
    php_serve = [PHP, "artisan", "serve", "--host=0.0.0.0", "--port=8090"] if PHP else None
    return [
        {
            "key": "bridge",
            "name": "Bridge Python",
            "port": 8000,
            "cmd": [str(BRIDGE_PY), "run.py"] if BRIDGE_PY.exists() else None,
            "cwd": str(BRIDGE_DIR),
            "health": True,
        },
        {
            "key": "laravel",
            "name": "Laravel",
            "port": 8090,
            "cmd": php_serve,
            "cwd": str(APP_DIR),
            "health": False,
        },
        {
            "key": "reverb",
            "name": "Reverb",
            "port": 8085,
            "cmd": [PHP, "artisan", "reverb:start"] if PHP else None,
            "cwd": str(APP_DIR),
            "health": False,
        },
        {
            "key": "queue",
            "name": "Queue Worker",
            "port": None,
            "cmd": [PHP, "artisan", "queue:work"] if PHP else None,
            "cwd": str(APP_DIR),
            "health": False,
        },
    ]


# --------------------------------------------------------------------------- #
# Helpers de red / procesos
# --------------------------------------------------------------------------- #
def port_listening(port: int, timeout: float = 0.35) -> bool:
    """¿Hay algo escuchando en 127.0.0.1:port? (sin privilegios)."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def find_pid_by_port(port: int) -> int | None:
    """PID que escucha en el puerto (puede requerir permisos; tolera fallos)."""
    try:
        for c in psutil.net_connections(kind="inet"):
            if c.laddr and c.laddr.port == port and c.status == psutil.CONN_LISTEN and c.pid:
                return c.pid
    except (psutil.AccessDenied, OSError):
        return None
    return None


def pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        p = psutil.Process(pid)
        return p.is_running() and p.status() != psutil.STATUS_ZOMBIE
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return False


def kill_tree(pid: int | None) -> None:
    """Mata el proceso y toda su descendencia (uvicorn --reload deja hijos)."""
    if not pid:
        return
    try:
        parent = psutil.Process(pid)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return
    procs = []
    try:
        procs = parent.children(recursive=True)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass
    procs.append(parent)
    for p in procs:
        try:
            p.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    psutil.wait_procs(procs, timeout=5)


def fetch_health(timeout: float = 2.0) -> dict | None:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def bridge_api_key() -> str | None:
    """Lee BRIDGE_API_KEY del .env del bridge (los endpoints /explore lo exigen)."""
    try:
        for line in BRIDGE_ENV.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("BRIDGE_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        return None
    return None


API_KEY = bridge_api_key()


def _bridge_request(url: str, method: str = "GET", timeout: float = 2.5) -> dict | None:
    """Petición autenticada al bridge (X-API-Key). Devuelve JSON o None si falla."""
    try:
        data = b"" if method == "POST" else None
        req = urllib.request.Request(url, data=data, method=method, headers={"X-API-Key": API_KEY or ""})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def fetch_explore_status(timeout: float = 2.5) -> dict | None:
    return _bridge_request(EXPLORE_STATUS_URL, "GET", timeout)


def explore_cancel() -> dict | None:
    return _bridge_request(EXPLORE_CANCEL_URL, "POST", timeout=10)


def explore_reset() -> dict | None:
    return _bridge_request(EXPLORE_RESET_URL, "POST", timeout=10)


def is_market_open(now: datetime | None = None) -> bool:
    """Heurística de horario forex (UTC): cerrado el fin de semana.

    Abre dom ~21:00 UTC, cierra vie ~21:00 UTC.
    """
    now = now or datetime.now(tz=timezone.utc)
    wd = now.weekday()  # lun=0 ... dom=6
    h = now.hour
    if wd == 5:  # sábado
        return False
    if wd == 6:  # domingo: abre por la tarde-noche
        return h >= 21
    if wd == 4:  # viernes: cierra por la tarde-noche
        return h < 21
    return True


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_state(data: dict) -> None:
    try:
        STATE_FILE.write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass


def load_pids() -> dict:
    data = load_state()
    pids = data.get("pids")
    if pids is None:  # esquema legado: el archivo era {key: pid}
        pids = {k: v for k, v in data.items() if isinstance(v, int)}
    return pids


def save_pids(pids: dict) -> None:
    data = load_state()
    data["pids"] = pids
    _write_state(data)


def load_setting(key: str, default):
    return load_state().get(key, default)


def save_setting(key: str, value) -> None:
    data = load_state()
    data[key] = value
    _write_state(data)


# --------------------------------------------------------------------------- #
# Controlador de servicios (lógica, sin UI)
# --------------------------------------------------------------------------- #
class ServiceManager:
    def __init__(self) -> None:
        self.defs = {s["key"]: s for s in _service_defs()}
        # PIDs de procesos lanzados por el panel (adopta los previos si siguen vivos).
        self.pids: dict[str, int] = {}
        for key, pid in load_pids().items():
            if pid_alive(pid):
                self.pids[key] = pid
        LOG_DIR.mkdir(exist_ok=True)

    # -- estado -----------------------------------------------------------
    def is_running(self, key: str) -> bool:
        svc = self.defs[key]
        if svc["port"]:
            return port_listening(svc["port"])
        return pid_alive(self.pids.get(key))

    def known(self, key: str) -> bool:
        """¿Podemos determinar el estado? (queue sin PID rastreado = desconocido)."""
        svc = self.defs[key]
        if svc["port"]:
            return True
        return key in self.pids

    # -- control ----------------------------------------------------------
    def start(self, key: str) -> tuple[bool, str]:
        svc = self.defs[key]
        if self.is_running(key):
            return True, f"{svc['name']} ya estaba corriendo."
        if not svc["cmd"]:
            reason = "Python del bridge no encontrado" if key == "bridge" else "PHP no encontrado en el sistema"
            return False, f"No se puede iniciar {svc['name']}: {reason}."
        try:
            logf = open(LOG_DIR / f"{key}.log", "ab", buffering=0)
            proc = subprocess.Popen(
                svc["cmd"],
                cwd=svc["cwd"],
                stdout=logf,
                stderr=logf,
                stdin=subprocess.DEVNULL,
                creationflags=CREATE_FLAGS,
            )
            logf.close()  # el proceso hijo conserva su propia copia del handle
        except Exception as exc:  # noqa: BLE001
            return False, f"Error al iniciar {svc['name']}: {exc}"
        self.pids[key] = proc.pid
        save_pids(self.pids)
        return True, f"{svc['name']} iniciado (PID {proc.pid})."

    def stop(self, key: str) -> tuple[bool, str]:
        svc = self.defs[key]
        pid = self.pids.get(key)
        killed = False
        if pid_alive(pid):
            kill_tree(pid)
            killed = True
        # Fallback: si sigue ocupando el puerto (proceso ajeno), matar por puerto.
        if svc["port"] and port_listening(svc["port"]):
            foreign = find_pid_by_port(svc["port"])
            if foreign:
                kill_tree(foreign)
                killed = True
        self.pids.pop(key, None)
        save_pids(self.pids)
        if killed:
            return True, f"{svc['name']} detenido."
        return True, f"{svc['name']} ya estaba detenido."

    def restart(self, key: str) -> tuple[bool, str]:
        self.stop(key)
        time.sleep(1.2)
        return self.start(key)


# --------------------------------------------------------------------------- #
# Interfaz tkinter
# --------------------------------------------------------------------------- #
ORDER = ["bridge", "laravel", "reverb", "queue"]

# Auto-recuperación (anti-bucle): máx N reintentos por servicio en una ventana,
# con una espera mínima entre intentos.
RECOVER_MAX = 3
RECOVER_WINDOW = 300.0   # segundos: pasada la ventana se reinicia el contador
RECOVER_COOLDOWN = 8.0   # segundos mínimos entre intentos (backoff)


def load_color(pct: float) -> str:
    return RED if pct > 85 else YELLOW if pct > 50 else GREEN


class Dot(tk.Canvas):
    def __init__(self, master, r: int = 6):
        super().__init__(master, width=r * 2 + 2, height=r * 2 + 2, bg=master["bg"], highlightthickness=0)
        self._id = self.create_oval(2, 2, r * 2, r * 2, fill=GRAY, outline="")

    def set(self, color: str) -> None:
        self.itemconfig(self._id, fill=color)


class CoreBar(tk.Canvas):
    """Mini-barra vertical de uso de un núcleo lógico."""

    def __init__(self, master, w: int = 13, h: int = 26):
        super().__init__(master, width=w, height=h, bg=PANEL2, highlightthickness=0)
        self._cw, self._ch = w, h  # ojo: _w está reservado por tkinter (path del widget)
        self._fill = self.create_rectangle(0, h, w, h, fill=GREEN, outline="")

    def set(self, pct: float) -> None:
        filled = int(self._ch * min(100.0, max(0.0, pct)) / 100.0)
        self.coords(self._fill, 0, self._ch - filled, self._cw, self._ch)
        self.itemconfig(self._fill, fill=load_color(pct))


class Bar(tk.Canvas):
    """Barra horizontal de progreso (CPU/RAM total)."""

    def __init__(self, master, w: int = 180, h: int = 10):
        super().__init__(master, width=w, height=h, bg=PANEL2, highlightthickness=0)
        self._cw, self._ch = w, h  # ojo: _w está reservado por tkinter (path del widget)
        self._fill = self.create_rectangle(0, 0, 0, h, fill=GREEN, outline="")

    def set(self, pct: float) -> None:
        filled = int(self._cw * min(100.0, max(0.0, pct)) / 100.0)
        self.coords(self._fill, 0, 0, filled, self._ch)
        self.itemconfig(self._fill, fill=load_color(pct))


class App:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.mgr = ServiceManager()
        self.pending: dict[str, tuple[str, float]] = {}  # key -> (starting|stopping, deadline)
        self._stop_refresh = threading.Event()
        # tkinter no es thread-safe: los hilos solo encolan; el hilo de UI aplica.
        self.ui_queue: queue.Queue = queue.Queue()

        root.title("ForexBot Control Panel")
        root.configure(bg=BG)
        root.geometry("640x920")
        root.minsize(600, 860)

        self.svc_dots: dict[str, Dot] = {}
        self.svc_btns: dict[str, dict[str, tk.Button]] = {}
        self.diag_dots: dict[str, Dot] = {}
        self.diag_labels: dict[str, tk.Label] = {}
        self.job_status: dict | None = None  # último snapshot del Explorador
        self.core_bars: list[CoreBar] = []

        # Auto-recuperación: estado por servicio + servicios que "deberían" estar
        # arriba (los que el usuario detuvo a mano se excluyen para no resucitarlos).
        self.autorecover = tk.BooleanVar(value=bool(load_setting("autorecover", False)))
        self.recovery: dict[str, dict] = {}
        self.ever_up: set[str] = set()

        # Primar el contador de CPU de psutil (la 1ª lectura siempre da 0).
        psutil.cpu_percent(percpu=True)

        self._build()
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        # Hilo de refresco (la red/psutil fuera del hilo de UI) + drenado en UI.
        threading.Thread(target=self._refresh_loop, name="refresh", daemon=True).start()
        self.root.after(150, self._drain_queue)

    # -- construcción de la UI -------------------------------------------
    def _build(self) -> None:
        header = tk.Frame(self.root, bg=BG)
        header.pack(fill="x", padx=18, pady=(16, 8))
        tk.Label(header, text="ForexBot Control Panel", bg=BG, fg=TEXT, font=FONT_TITLE).pack(side="left")
        self.summary = tk.Frame(header, bg=BG)
        self.summary.pack(side="right")
        self.summary_dots = [Dot(self.summary, 5) for _ in range(3)]
        for d in self.summary_dots:
            d.pack(side="left", padx=2)

        if not PHP:
            warn = tk.Label(
                self.root,
                text="Aviso: PHP no encontrado: Laravel/Reverb/Worker no podrán iniciarse.",
                bg=BG, fg=YELLOW, font=FONT_SMALL,
            )
            warn.pack(fill="x", padx=18)

        # --- Servicios ---
        self._section_title("SERVICIOS")
        sframe = tk.Frame(self.root, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        sframe.pack(fill="x", padx=18, pady=(0, 12))
        for key in ORDER:
            self._service_row(sframe, key)

        # --- Diagnóstico ---
        self._section_title("DIAGNÓSTICO  (solo lectura)")
        dframe = tk.Frame(self.root, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        dframe.pack(fill="x", padx=18, pady=(0, 12))
        self._diag_row(dframe, "mt5", "MT5 conectado")
        self._diag_row(dframe, "algo", "Algo Trading")
        self._diag_row(dframe, "market", "Mercado abierto")

        # --- Trabajos del Explorador ---
        self._section_title("TRABAJOS DEL EXPLORADOR")
        jframe = tk.Frame(self.root, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        jframe.pack(fill="x", padx=18, pady=(0, 12))
        jrow = tk.Frame(jframe, bg=PANEL)
        jrow.pack(fill="x", padx=12, pady=7)
        self.job_dot = Dot(jrow)
        self.job_dot.pack(side="left", padx=(0, 10))
        self.job_label = tk.Label(jrow, text="Consultando…", bg=PANEL, fg=MUTED, font=FONT_LABEL, anchor="w", justify="left")
        self.job_label.pack(side="left", fill="x", expand=True)
        self.job_btn = tk.Button(
            jrow, text="Cancelar / Liberar", width=16, bg=PANEL2, fg=TEXT, activebackground=BORDER,
            relief="flat", font=FONT_LABEL, cursor="hand2", state="disabled",
            command=self._on_job_button,
        )
        self.job_btn.pack(side="right", padx=2)

        # --- Máquina (CPU / RAM / núcleos) ---
        self._section_title("MÁQUINA")
        mframe = tk.Frame(self.root, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        mframe.pack(fill="x", padx=18, pady=(0, 12))
        top = tk.Frame(mframe, bg=PANEL)
        top.pack(fill="x", padx=12, pady=(7, 4))
        tk.Label(top, text="CPU", bg=PANEL, fg=MUTED, font=FONT_LABEL, width=4, anchor="w").pack(side="left")
        self.cpu_bar = Bar(top)
        self.cpu_bar.pack(side="left", padx=(0, 6))
        self.cpu_lbl = tk.Label(top, text="—%", bg=PANEL, fg=TEXT, font=FONT_MONO, width=6, anchor="w")
        self.cpu_lbl.pack(side="left")
        tk.Label(top, text="RAM", bg=PANEL, fg=MUTED, font=FONT_LABEL, width=4, anchor="e").pack(side="left", padx=(10, 0))
        self.ram_bar = Bar(top)
        self.ram_bar.pack(side="left", padx=(6, 6))
        self.ram_lbl = tk.Label(top, text="—", bg=PANEL, fg=TEXT, font=FONT_MONO, width=14, anchor="w")
        self.ram_lbl.pack(side="left")

        grid = tk.Frame(mframe, bg=PANEL)
        grid.pack(fill="x", padx=12, pady=(2, 8))
        ncores = psutil.cpu_count(logical=True) or 0
        cols = 8
        for i in range(ncores):
            cb = CoreBar(grid)
            cb.grid(row=i // cols, column=i % cols, padx=1, pady=1)
            self.core_bars.append(cb)
        tk.Label(mframe, text=f"{ncores} procesadores lógicos", bg=PANEL, fg=MUTED, font=FONT_SMALL).pack(anchor="w", padx=12, pady=(0, 6))

        # --- Controles globales ---
        gframe = tk.Frame(self.root, bg=BG)
        gframe.pack(fill="x", padx=18, pady=(0, 4))
        tk.Button(
            gframe, text="INICIAR TODO", command=lambda: self._async(self.start_all),
            bg=GREEN, fg="#06231F", activebackground=GREEN, font=FONT_LABEL_B,
            relief="flat", padx=10, pady=8, cursor="hand2",
        ).pack(side="left", expand=True, fill="x", padx=(0, 6))
        tk.Button(
            gframe, text="DETENER TODO", command=lambda: self._async(self.stop_all),
            bg=PANEL2, fg=RED, activebackground=PANEL2, font=FONT_LABEL_B,
            relief="flat", padx=10, pady=8, cursor="hand2",
        ).pack(side="left", expand=True, fill="x", padx=(6, 0))

        # Interruptor de auto-recuperación.
        arow = tk.Frame(self.root, bg=BG)
        arow.pack(fill="x", padx=18, pady=(0, 6))
        chk = tk.Checkbutton(
            arow, text="Auto-recuperación (levanta servicios caídos)", variable=self.autorecover,
            command=self._toggle_autorecover, bg=BG, fg=TEXT, font=FONT_LABEL, anchor="w",
            selectcolor=PANEL2, activebackground=BG, activeforeground=TEXT,
            highlightthickness=0, bd=0, cursor="hand2",
        )
        chk.pack(side="left")

        self.updated = tk.Label(self.root, text="Última actualización: —", bg=BG, fg=MUTED, font=FONT_SMALL)
        self.updated.pack(fill="x", padx=18)

        # --- Log de actividad ---
        self._section_title("ACTIVIDAD")
        self.log = tk.Text(
            self.root, height=6, bg=PANEL, fg=MUTED, font=FONT_SMALL, relief="flat",
            highlightbackground=BORDER, highlightthickness=1, wrap="word", state="disabled",
        )
        self.log.pack(fill="both", expand=True, padx=18, pady=(0, 16))

    def _section_title(self, text: str) -> None:
        tk.Label(self.root, text=text, bg=BG, fg=MUTED, font=("Segoe UI", 8, "bold")).pack(
            anchor="w", padx=20, pady=(4, 4)
        )

    def _service_row(self, parent: tk.Frame, key: str) -> None:
        svc = self.mgr.defs[key]
        row = tk.Frame(parent, bg=PANEL)
        row.pack(fill="x", padx=12, pady=7)

        dot = Dot(row)
        dot.pack(side="left", padx=(0, 10))
        self.svc_dots[key] = dot

        tk.Label(row, text=svc["name"], bg=PANEL, fg=TEXT, font=FONT_LABEL, width=15, anchor="w").pack(side="left")
        port_txt = f":{svc['port']}" if svc["port"] else "----"
        tk.Label(row, text=port_txt, bg=PANEL, fg=MUTED, font=FONT_MONO, width=7, anchor="w").pack(side="left")

        btns = {}
        for label, name in (("Start", "start"), ("Stop", "stop"), ("Restart", "restart")):
            b = tk.Button(
                row, text=label, width=7, bg=PANEL2, fg=TEXT, activebackground=BORDER,
                relief="flat", font=FONT_LABEL, cursor="hand2",
                command=lambda k=key, n=name: self._do_action(k, n),
            )
            b.pack(side="left", padx=2)
            btns[name] = b
        self.svc_btns[key] = btns

    def _diag_row(self, parent: tk.Frame, key: str, label: str) -> None:
        row = tk.Frame(parent, bg=PANEL)
        row.pack(fill="x", padx=12, pady=7)
        dot = Dot(row)
        dot.pack(side="left", padx=(0, 10))
        self.diag_dots[key] = dot
        lbl = tk.Label(row, text=label, bg=PANEL, fg=TEXT, font=FONT_LABEL, anchor="w")
        lbl.pack(side="left")
        self.diag_labels[key] = lbl

    # -- acciones ---------------------------------------------------------
    def _async(self, fn) -> None:
        threading.Thread(target=fn, daemon=True).start()

    def _do_action(self, key: str, name: str) -> None:
        self.pending[key] = ("stopping" if name == "stop" else "starting", time.time() + 12)
        self._render_pending(key)  # estamos en el hilo de UI (callback de botón)
        # Parada manual: el usuario NO quiere ese servicio arriba → no auto-recuperar.
        if name == "stop":
            self.ever_up.discard(key)
            self.recovery.pop(key, None)

        def run():
            fn = {"start": self.mgr.start, "stop": self.mgr.stop, "restart": self.mgr.restart}[name]
            ok, msg = fn(key)
            self.ui_queue.put(("log", (msg, ok)))

        self._async(run)

    def _toggle_autorecover(self) -> None:
        on = self.autorecover.get()
        save_setting("autorecover", on)
        self.ui_queue.put(("log", (f"Auto-recuperación {'ACTIVADA' if on else 'desactivada'}.", True)))

    def start_all(self) -> None:  # corre en hilo aparte
        self.ui_queue.put(("log", ("Iniciando todos los servicios…", True)))
        for key in ORDER:  # bridge → laravel → reverb → queue
            self.ui_queue.put(("pending", (key, "starting", 14)))
            ok, msg = self.mgr.start(key)
            self.ui_queue.put(("log", (msg, ok)))
            time.sleep(2.0)

    def stop_all(self) -> None:  # corre en hilo aparte
        self.ui_queue.put(("log", ("Deteniendo todos los servicios…", True)))
        self.ever_up.clear()      # parada manual de todo → no auto-recuperar
        self.recovery.clear()
        for key in reversed(ORDER):  # orden inverso
            self.ui_queue.put(("pending", (key, "stopping", 8)))
            ok, msg = self.mgr.stop(key)
            self.ui_queue.put(("log", (msg, ok)))
            time.sleep(0.6)

    # -- refresco ---------------------------------------------------------
    def _refresh_loop(self) -> None:
        while not self._stop_refresh.is_set():
            data = self._gather()
            self.ui_queue.put(("status", data))
            self._stop_refresh.wait(2.5)

    def _drain_queue(self) -> None:
        """Aplica en el hilo de UI los mensajes encolados por los hilos de trabajo."""
        try:
            while True:
                kind, payload = self.ui_queue.get_nowait()
                if kind == "status":
                    self._apply(payload)
                elif kind == "log":
                    self._activity(*payload)
                elif kind == "pending":
                    k, mode, secs = payload
                    self.pending[k] = (mode, time.time() + secs)
                    self._render_pending(k)
        except queue.Empty:
            pass
        if not self._stop_refresh.is_set():
            self.root.after(150, self._drain_queue)

    def _gather(self) -> dict:
        running = {key: self.mgr.is_running(key) for key in ORDER}
        known = {key: self.mgr.known(key) for key in ORDER}
        health = fetch_health()
        explore = fetch_explore_status() if running["bridge"] else None
        # CPU (total + por núcleo) y RAM. cpu_percent(interval=None) no bloquea.
        try:
            percpu = psutil.cpu_percent(percpu=True)
            cpu_total = sum(percpu) / len(percpu) if percpu else 0.0
            vm = psutil.virtual_memory()
            machine = {"cpu_total": cpu_total, "percpu": percpu,
                       "ram_pct": vm.percent, "ram_used_gb": vm.used / 1e9, "ram_total_gb": vm.total / 1e9}
        except Exception:
            machine = None
        return {"running": running, "known": known, "health": health, "explore": explore,
                "machine": machine, "ts": datetime.now()}

    def _apply(self, data: dict) -> None:
        now = time.time()
        running, known, health = data["running"], data["known"], data["health"]

        for key in ORDER:
            # Limpia el estado de transición si ya se alcanzó el destino.
            if key in self.pending:
                kind, deadline = self.pending[key]
                done = running[key] if kind == "starting" else not running[key]
                if done or now > deadline:
                    self.pending.pop(key, None)

            if key in self.pending:
                color = YELLOW
            elif key == "bridge" and running[key] and health is None:
                color = YELLOW  # puerto arriba pero /health aún no responde
            elif not known[key]:
                color = GRAY
            elif running[key]:
                color = GREEN
            else:
                color = RED
            self.svc_dots[key].set(color)

            btns = self.svc_btns[key]
            is_run = running[key]
            btns["start"].config(state="disabled" if is_run else "normal")
            btns["stop"].config(state="normal" if is_run else "disabled")

        # Resumen (3 puntos del header): bridge / laravel / reverb
        for d, key in zip(self.summary_dots, ("bridge", "laravel", "reverb")):
            d.set(GREEN if running[key] else RED)

        self._apply_diag(health)
        self._apply_jobs(running["bridge"], data.get("explore"))
        self._apply_machine(data.get("machine"))
        self._maybe_autorecover(running, known)
        self.updated.config(text="Última actualización: " + data["ts"].strftime("%H:%M:%S"))

    def _apply_machine(self, m: dict | None) -> None:
        if not m:
            return
        self.cpu_bar.set(m["cpu_total"])
        self.cpu_lbl.config(text=f"{m['cpu_total']:.0f}%")
        self.ram_bar.set(m["ram_pct"])
        self.ram_lbl.config(text=f"{m['ram_used_gb']:.1f}/{m['ram_total_gb']:.0f} GB")
        for cb, pct in zip(self.core_bars, m["percpu"]):
            cb.set(pct)

    def _maybe_autorecover(self, running: dict, known: dict) -> None:
        """Levanta servicios caídos si la auto-recuperación está activa. Anti-bucle:
        máx N intentos por ventana, con backoff. NO reactiva el trading del bot."""
        if not self.autorecover.get():
            return
        now = time.time()
        for key in ORDER:
            if running[key]:
                self.ever_up.add(key)          # sano → candidato a recuperación futura
                self.recovery.pop(key, None)   # resetea el contador
                continue
            # No tocar: nunca estuvo arriba, estado desconocido, o transición en curso.
            if key not in self.ever_up or not known[key] or key in self.pending:
                continue
            rec = self.recovery.setdefault(key, {"attempts": 0, "first_ts": now, "last_ts": 0.0, "paused": False})
            if rec["paused"]:
                continue
            if now - rec["first_ts"] > RECOVER_WINDOW:  # ventana expirada → reinicia contador
                rec["attempts"], rec["first_ts"] = 0, now
            if now - rec["last_ts"] < RECOVER_COOLDOWN:  # backoff entre intentos
                continue
            if rec["attempts"] >= RECOVER_MAX:
                rec["paused"] = True
                self.ui_queue.put(("log", (
                    f"{self.mgr.defs[key]['name']} se cayó {RECOVER_MAX} veces seguidas; "
                    "auto-recuperación PAUSADA para este servicio, revisar manualmente.", False)))
                continue
            rec["attempts"] += 1
            rec["last_ts"] = now
            self.pending[key] = ("starting", now + 14)
            self._render_pending(key)
            self.ui_queue.put(("log", (
                f"{self.mgr.defs[key]['name']} detectado caído → reiniciando "
                f"(intento {rec['attempts']}/{RECOVER_MAX})…", True)))
            self._async(lambda k=key: self._recover(k))

    def _recover(self, key: str) -> None:
        ok, msg = self.mgr.start(key)
        self.ui_queue.put(("log", (msg, ok)))
        if key == "bridge" and ok:
            self.ui_queue.put(("log", (
                "Bridge reiniciado; el bot quedó en PAUSA por seguridad. "
                "Reanúdalo manualmente desde la web si quieres operar.", True)))

    def _apply_diag(self, health: dict | None) -> None:
        if health is None:
            for key, base in (("mt5", "MT5 conectado"), ("algo", "Algo Trading"), ("market", "Mercado abierto")):
                self.diag_dots[key].set(GRAY)
                self.diag_labels[key].config(text=f"{base}  → requiere bridge activo", fg=MUTED)
            return

        connected = bool(health.get("connected"))
        self.diag_dots["mt5"].set(GREEN if connected else RED)
        self.diag_labels["mt5"].config(
            text="MT5 conectado" if connected else "MT5 desconectado  → abre MT5 y loguéate",
            fg=TEXT if connected else RED,
        )

        algo = bool((health.get("terminal") or {}).get("trade_allowed"))
        self.diag_dots["algo"].set(GREEN if algo else RED)
        self.diag_labels["algo"].config(
            text="Algo Trading activo" if algo else "Algo Trading APAGADO  → actívalo en MT5 (Ctrl+E)",
            fg=TEXT if algo else RED,
        )

        market = is_market_open()
        self.diag_dots["market"].set(GREEN if market else RED)
        self.diag_labels["market"].config(
            text="Mercado abierto" if market else "Mercado cerrado  → esperar apertura",
            fg=TEXT if market else MUTED,
        )

    def _apply_jobs(self, bridge_up: bool, explore: dict | None) -> None:
        self.job_status = explore
        if not bridge_up:
            self.job_dot.set(GRAY)
            self.job_label.config(text="Requiere bridge activo", fg=MUTED)
            self.job_btn.config(state="disabled")
            return
        if explore is None:
            self.job_dot.set(YELLOW)
            self.job_label.config(text="No se pudo consultar (¿API key del bridge?)", fg=YELLOW)
            self.job_btn.config(state="disabled")
            return

        status = explore.get("status")
        stale = bool(explore.get("stale"))
        done, total = explore.get("done", 0), explore.get("total", 0)
        pct = round(done / total * 100) if total else 0

        if status == "running" and stale:
            age = explore.get("last_beat_age")
            self.job_dot.set(YELLOW)
            self.job_label.config(text=f"Huérfano: sin avance hace {age}s (al {pct}%) — pulsa Liberar", fg=YELLOW)
            self.job_btn.config(state="normal", text="Liberar")
        elif status == "running":
            speed = explore.get("speed_per_sec", 0)
            elapsed = explore.get("elapsed_seconds", 0)
            self.job_dot.set(GREEN)
            self.job_label.config(
                text=f"En ejecución: {pct}% · {done}/{total} · {speed}/s · {elapsed}s · {explore.get('workers')} núcleos",
                fg=TEXT,
            )
            self.job_btn.config(state="normal", text="Cancelar")
        else:
            self.job_dot.set(GRAY)
            extra = ""
            if status in ("done", "cancelled", "error") and total:
                done_txt = {"done": "última: completada", "cancelled": "última: cancelada", "error": "última: error"}[status]
                extra = f"  ({done_txt}, {explore.get('results_count', 0)} filas)"
            self.job_label.config(text=f"Sin trabajos en cola — listo para nuevas búsquedas{extra}", fg=MUTED)
            self.job_btn.config(state="disabled", text="Cancelar / Liberar")

    def _on_job_button(self) -> None:
        explore = self.job_status or {}
        status = explore.get("status")
        stale = bool(explore.get("stale"))

        if status == "running" and not stale:
            pct = round(explore.get("done", 0) / explore.get("total", 1) * 100) if explore.get("total") else 0
            if not messagebox.askyesno("Cancelar búsqueda", f"Hay una búsqueda en curso al {pct}%.\n\n¿Cancelarla?"):
                return
            action, verb = explore_cancel, "Búsqueda cancelada."
        else:
            # Huérfano (o estado raro): liberar directo, sin confirmación.
            action, verb = explore_reset, "Trabajo liberado."

        def run():
            res = action()
            self.ui_queue.put(("log", (verb if res is not None else "No se pudo contactar el bridge.", res is not None)))

        self.job_btn.config(state="disabled")
        self._async(run)

    def _render_pending(self, key: str) -> None:
        if key in self.pending:
            self.svc_dots[key].set(YELLOW)

    # -- log / cierre -----------------------------------------------------
    def _activity(self, msg: str, ok: bool) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        self.log.config(state="normal")
        self.log.insert("end", f"[{ts}] {'' if ok else '! '}{msg}\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def on_close(self) -> None:
        any_running = any(self.mgr.is_running(k) for k in ORDER)
        if not any_running:
            self._shutdown()
            return
        resp = messagebox.askyesnocancel(
            "Cerrar panel",
            "Hay servicios corriendo.\n\n"
            "Sí  → detener los servicios y cerrar\n"
            "No  → dejarlos corriendo y cerrar\n"
            "Cancelar → no cerrar",
        )
        if resp is None:
            return
        if resp:
            for key in reversed(ORDER):
                self.mgr.stop(key)
        self._shutdown()

    def _shutdown(self) -> None:
        self._stop_refresh.set()
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
