"""Motor del bot en vivo (Fase 7).

Ejecuta una estrategia automáticamente contra MT5: evalúa en cada vela cerrada,
abre/cierra posiciones reales con lote fijo, respeta límites de seguridad y se
controla desde Laravel (start/pause/resume/stop/panic).

⚠ Opera SIEMPRE en cuenta demo hasta validación extensa. El panic button cierra
TODAS las posiciones abiertas y detiene el bot.
"""

from .state import BOT_MAGIC, bot_state
from .runner import BotRunner, bot_runner

__all__ = ["BOT_MAGIC", "bot_state", "BotRunner", "bot_runner"]
