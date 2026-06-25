import type { ISeriesApi, ISeriesPrimitive, IChartApi, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';

export interface PositionZone {
    from: number; // tiempo de apertura (segundos epoch)
    to: number | null; // tiempo de cierre, o null si sigue abierta (se extiende al borde)
    entry: number;
    tp: number | null;
    sl: number | null;
}

const GREEN = 'rgba(38, 166, 154, 0.16)';
const RED = 'rgba(239, 83, 80, 0.16)';
const ENTRY = 'rgba(232, 233, 237, 0.65)';

/**
 * Primitive de Lightweight Charts que dibuja la operación "encajonada" estilo
 * TradingView: zona verde entrada→TP (ganancia) y zona roja entrada→SL (pérdida),
 * con la línea de entrada entre ambas. Se dibuja detrás de las velas.
 */
export class PositionZones implements ISeriesPrimitive<Time> {
    _chart: IChartApi | null = null;
    _series: ISeriesApi<SeriesType> | null = null;
    _zones: PositionZone[] = [];
    private _requestUpdate: (() => void) | null = null;
    private _views: ZonesPaneView[] = [new ZonesPaneView(this)];

    attached(param: SeriesAttachedParameter<Time>): void {
        this._chart = param.chart;
        this._series = param.series;
        this._requestUpdate = param.requestUpdate;
    }

    detached(): void {
        this._chart = null;
        this._series = null;
        this._requestUpdate = null;
    }

    updateAllViews(): void {}

    paneViews() {
        return this._views;
    }

    setZones(zones: PositionZone[]): void {
        this._zones = zones;
        this._requestUpdate?.();
    }
}

class ZonesPaneView {
    constructor(private readonly _source: PositionZones) {}

    renderer() {
        return new ZonesRenderer(this._source);
    }

    zOrder() {
        return 'bottom' as const;
    }
}

class ZonesRenderer {
    constructor(private readonly _source: PositionZones) {}

    draw(target: {
        useBitmapCoordinateSpace: (cb: (scope: { context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number; bitmapSize: { width: number; height: number } }) => void) => void;
    }): void {
        const series = this._source._series;
        const chart = this._source._chart;
        if (!series || !chart || this._source._zones.length === 0) return;
        const ts = chart.timeScale();

        target.useBitmapCoordinateSpace((scope) => {
            const ctx = scope.context;
            const hr = scope.horizontalPixelRatio;
            const vr = scope.verticalPixelRatio;
            const width = scope.bitmapSize.width;

            for (const z of this._source._zones) {
                const yEntryC = series.priceToCoordinate(z.entry);
                if (yEntryC == null) continue;
                const ye = yEntryC * vr;

                const x1c = ts.timeToCoordinate(z.from as Time);
                const x1 = x1c == null ? 0 : x1c * hr;
                let x2: number;
                if (z.to == null) {
                    x2 = width; // posición abierta → hasta el borde derecho
                } else {
                    const x2c = ts.timeToCoordinate(z.to as Time);
                    x2 = x2c == null ? width : x2c * hr;
                }
                const left = Math.min(x1, x2);
                const w = Math.max(2, Math.abs(x2 - x1));

                if (z.tp != null) {
                    const ytpC = series.priceToCoordinate(z.tp);
                    if (ytpC != null) {
                        const ytp = ytpC * vr;
                        ctx.fillStyle = GREEN;
                        ctx.fillRect(left, Math.min(ye, ytp), w, Math.abs(ytp - ye));
                    }
                }
                if (z.sl != null) {
                    const yslC = series.priceToCoordinate(z.sl);
                    if (yslC != null) {
                        const ysl = yslC * vr;
                        ctx.fillStyle = RED;
                        ctx.fillRect(left, Math.min(ye, ysl), w, Math.abs(ysl - ye));
                    }
                }
                ctx.strokeStyle = ENTRY;
                ctx.lineWidth = Math.max(1, vr);
                ctx.beginPath();
                ctx.moveTo(left, ye);
                ctx.lineTo(left + w, ye);
                ctx.stroke();
            }
        });
    }
}
