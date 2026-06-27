import { describe, expect, it } from "vitest";
import { formatSyncResult, formatCalendarSyncResult } from "./admin-sync";

describe("formatSyncResult", () => {
  it("reports nothing to update when zero fixtures changed", () => {
    expect(formatSyncResult(0)).toBe("No hay partidos para actualizar todavía");
  });

  it("treats negative counts as nothing to update", () => {
    expect(formatSyncResult(-1)).toBe(
      "No hay partidos para actualizar todavía"
    );
  });

  it("uses the singular noun for exactly one fixture", () => {
    expect(formatSyncResult(1)).toBe("1 partido actualizado");
  });

  it("uses the plural noun for more than one fixture", () => {
    expect(formatSyncResult(3)).toBe("3 partidos actualizados");
  });
});

describe("formatCalendarSyncResult", () => {
  it("reports no knockout matches when total is zero", () => {
    expect(formatCalendarSyncResult(0, 0)).toBe(
      "No hay partidos de eliminatorias todavía"
    );
  });

  it("reports the decided/total split when some are still undecided", () => {
    expect(formatCalendarSyncResult(9, 32)).toBe(
      "9 de 32 partidos de eliminatorias habilitados"
    );
  });

  it("shows 0 decided cleanly", () => {
    expect(formatCalendarSyncResult(0, 32)).toBe(
      "0 de 32 partidos de eliminatorias habilitados"
    );
  });

  it("reports all-clear when every match has teams", () => {
    expect(formatCalendarSyncResult(32, 32)).toBe(
      "Eliminatorias al día: 32 partidos habilitados"
    );
  });

  it("treats decided greater than total as all-clear (defensive)", () => {
    expect(formatCalendarSyncResult(33, 32)).toBe(
      "Eliminatorias al día: 32 partidos habilitados"
    );
  });
});
