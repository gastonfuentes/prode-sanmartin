import { describe, expect, it } from "vitest";
import { formatSyncResult } from "./admin-sync";

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
