/**
 * Zona horaria de visualización de los charts (Ecuador, UTC-5).
 *
 * El bridge entrega los timestamps en UTC real. Lightweight Charts renderiza el
 * epoch como UTC; para que el eje muestre la hora de Ecuador, desplazamos los
 * timestamps que se le pasan al chart por este offset. Cambiar aquí para otra zona.
 */
export const DISPLAY_TZ_OFFSET_HOURS = -5;
export const DISPLAY_TZ_OFFSET_SECONDS = DISPLAY_TZ_OFFSET_HOURS * 3600;

/** Epoch UTC (s) → epoch desplazado para que el chart lo pinte en hora local. */
export const toChartTime = (epoch: number): number => epoch + DISPLAY_TZ_OFFSET_SECONDS;
