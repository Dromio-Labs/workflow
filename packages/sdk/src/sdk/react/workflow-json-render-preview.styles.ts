import type { CSSProperties } from "react";

export const panelStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #d8dee8",
  borderRadius: 8,
  color: "#172033",
  padding: 16,
};

export const headingStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: "18px",
  margin: "0 0 10px",
};

export const jsonRenderHeaderStyle: CSSProperties = {
  alignItems: "flex-start",
  display: "flex",
  gap: 12,
  justifyContent: "space-between",
};

export const jsonRenderHeaderActionsStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  gap: 8,
};

export const badgeStyle: CSSProperties = {
  background: "#e0f2fe",
  border: "1px solid #bae6fd",
  borderRadius: 999,
  color: "#075985",
  fontSize: 11,
  padding: "3px 8px",
};

export const settingsStyle: CSSProperties = {
  position: "relative",
};

export const settingsButtonStyle: CSSProperties = {
  alignItems: "center",
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 999,
  color: "#334155",
  cursor: "pointer",
  display: "inline-flex",
  height: 26,
  justifyContent: "center",
  padding: 0,
  width: 26,
};

export const settingsIconStyle: CSSProperties = {
  display: "block",
};

export const settingsMenuStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  display: "grid",
  gap: 4,
  minWidth: 180,
  padding: 6,
  position: "absolute",
  right: 0,
  top: "calc(100% + 6px)",
  zIndex: 10,
};

export const settingsMenuButtonStyle: CSSProperties = {
  background: "transparent",
  border: 0,
  borderRadius: 6,
  color: "#334155",
  cursor: "pointer",
  fontSize: 12,
  padding: "7px 8px",
  textAlign: "left",
};

export const settingsMenuButtonActiveStyle: CSSProperties = {
  background: "#e0f2fe",
  color: "#075985",
};

export const schemaPanelStyle: CSSProperties = {
  border: "1px solid #d8dee8",
  borderRadius: 8,
  display: "grid",
  gap: 10,
  padding: 12,
};

export const schemaSummaryStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

export const issueListStyle: CSSProperties = {
  color: "#a16207",
  margin: 0,
  paddingLeft: 18,
};

export const renderCardStyle: CSSProperties = {
  border: "1px solid #d8dee8",
  borderRadius: 8,
  display: "grid",
  gap: 8,
  padding: 12,
};

export const markdownBlockStyle: CSSProperties = {
  minWidth: 0,
};

export const summaryCardStyle: CSSProperties = {
  ...renderCardStyle,
  background: "#ecfdf5",
  borderColor: "#a7f3d0",
};

export const commandStatusCardStyle: CSSProperties = {
  ...renderCardStyle,
  background: "#f5f3ff",
  borderColor: "#ddd6fe",
};

export const summaryMetricStyle: CSSProperties = {
  alignItems: "baseline",
  display: "flex",
  gap: 6,
};

export const factGridStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

export const factStyle: CSSProperties = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  display: "grid",
  gap: 4,
  padding: 8,
};

export const warningTextStyle: CSSProperties = {
  color: "#a16207",
};

export const preStyle: CSSProperties = {
  background: "#f8fafc",
  borderRadius: 6,
  fontSize: 12,
  margin: 0,
  overflow: "auto",
  padding: 10,
};

export const mutedStyle: CSSProperties = {
  color: "#64748b",
};
