"""Monitoreo de carga del proceso del bridge (Fase: velocidad/monitoreo).

Expone CPU/RAM del sistema y del propio proceso del bridge con psutil. SOLO local
(el bridge está atado a 127.0.0.1); no se expone a la red.
"""

from __future__ import annotations

import os

import psutil
from fastapi import APIRouter, Depends

from ..auth import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])

_proc = psutil.Process(os.getpid())
_proc.cpu_percent(interval=None)  # primer llamado: inicializa el contador


@router.get("/system/stats", summary="CPU/RAM del sistema y del proceso del bridge")
async def system_stats():
    vm = psutil.virtual_memory()
    cpu_count = os.cpu_count() or 1
    sys_cpu = psutil.cpu_percent(interval=0.1)  # % total del sistema
    # CPU del proceso: suma entre núcleos (puede superar 100%); normalizamos a % máquina.
    proc_cpu_raw = _proc.cpu_percent(interval=None)
    proc_rss = _proc.memory_info().rss

    return {
        "cpu_count": cpu_count,
        "logical_cores": psutil.cpu_count(logical=True),
        "physical_cores": psutil.cpu_count(logical=False),
        "system_cpu_percent": round(sys_cpu, 1),
        "process_cpu_percent": round(proc_cpu_raw, 1),                 # crudo (puede ser >100)
        "process_cpu_percent_norm": round(proc_cpu_raw / cpu_count, 1),  # % de la máquina
        "ram_total_gb": round(vm.total / 1e9, 2),
        "ram_used_gb": round(vm.used / 1e9, 2),
        "ram_percent": round(vm.percent, 1),
        "process_ram_mb": round(proc_rss / 1e6, 1),
    }
