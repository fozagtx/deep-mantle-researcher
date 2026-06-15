/**
 * Dashboard surfaces: light panels with visible borders and readable text.
 */

export const DASHBOARD_CARD_SURFACE =
  "rounded-xl border border-[#2670DC]/25 bg-white";

export const DASHBOARD_CARD_HOVER =
  "transition-[border-color,background-color] duration-200 hover:border-[#2670DC]/45 hover:bg-[#F4F9FF]";

export const DASHBOARD_PANEL_SURFACE = `${DASHBOARD_CARD_SURFACE} p-4 sm:p-5`;

export const DASHBOARD_SURFACE_DASHED =
  "rounded-xl border border-dashed border-[#2670DC]/30 bg-white";

export const DASHBOARD_SURFACE_MUTED =
  "rounded-xl border border-[#2670DC]/22 bg-[#F4F9FF]";

export const DASHBOARD_SKELETON_ROW =
  "rounded-xl border border-[#2670DC]/20 bg-[#F4F9FF]";

export const DASHBOARD_STAT_CELL_SURFACE =
  "rounded border border-[#2670DC]/20 bg-[#F4F9FF] px-3 py-2.5 sm:px-3.5 sm:py-3";
