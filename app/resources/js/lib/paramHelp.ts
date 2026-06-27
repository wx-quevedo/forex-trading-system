/**
 * Textos de ayuda por parámetro (qué es + cómo afecta). Usados por el icono "i".
 * Cubren los parámetros de todos los tipos de estrategia + gestión de riesgo.
 */
export const PARAM_HELP: Record<string, string> = {
    // Moving Average Cross
    ma_type: 'Tipo de media móvil. EMA da más peso a las velas recientes (reacciona antes); SMA pondera todo por igual (más suave).',
    fast_period: 'Periodo de la media rápida. Valores bajos = más sensible: más señales pero más ruido (falsas). Valores altos = más suave, menos señales pero más confiables.',
    slow_period: 'Periodo de la media lenta; marca la tendencia de fondo. Cuanto mayor, más lenta la reacción y menos operaciones.',

    // RSI
    period: 'Nº de velas para calcular el indicador. Más corto = más reactivo y más señales; más largo = más estable y menos señales.',
    oversold: 'Umbral de sobreventa del RSI (ej. 30): por debajo se considera sobrevendido (posible compra). Más extremo (20) = menos señales pero más fiables.',
    overbought: 'Umbral de sobrecompra del RSI (ej. 70): por encima se considera sobrecomprado (posible venta). Más extremo (80) = menos señales pero más fiables.',

    // MACD
    fast: 'EMA rápida del MACD. Más baja = el MACD reacciona antes a los cambios de precio.',
    slow: 'EMA lenta del MACD. Más alta = referencia de tendencia más estable; cruces menos frecuentes.',
    signal: 'EMA de la línea de señal. El cruce MACD/señal dispara la entrada; más alta = señales más suaves y tardías.',

    // Bollinger
    std_dev: 'Nº de desviaciones estándar de las bandas. Mayor = bandas más anchas, menos toques/señales (rupturas más extremas).',

    // Combined
    trend_ma_type: 'Tipo de media para el filtro de tendencia (EMA reacciona antes; SMA más suave).',
    trend_period: 'Periodo de la media de tendencia. Mayor = filtro de tendencia más lento y estable.',
    rsi_period: 'Nº de velas del RSI de confirmación. Más corto = más reactivo; más largo = más estable.',
    rsi_oversold: 'Umbral de sobreventa del RSI de confirmación (posible compra por debajo).',
    rsi_overbought: 'Umbral de sobrecompra del RSI de confirmación (posible venta por encima).',
    logic: 'Cómo combinar tendencia y RSI. AND = exige ambas (menos señales, más estrictas). OR = cualquiera de las dos (más señales).',

    // Riesgo
    sl_pips: 'Stop Loss en pips. Distancia a la que se cierra en pérdida. Más ajustado = menos pérdida por trade pero más probabilidad de que salte.',
    tp_pips: 'Take Profit en pips. Distancia a la que se toma ganancia. Más amplio = mayor ganancia objetivo pero menos probabilidad de alcanzarlo.',
    risk_percent: 'Porcentaje del capital arriesgado por operación (dimensiona el lote según la distancia al SL).',

    // Config del bot
    lot: 'Lote fijo por operación. Mayor lote = mayor ganancia/pérdida por pip.',
    daily_loss_limit: 'Pérdida máxima del día (en dinero). Si se alcanza, la estrategia se auto-detiene para proteger la cuenta.',
    max_positions: 'Nº máximo de posiciones abiertas a la vez para esta estrategia.',
};
