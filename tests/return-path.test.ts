import { describe, expect, it } from "vitest";
import { safeReturnPath } from "../src/components/auth/routing";

describe("portal return paths", () => {
  it("accepts only paths belonging to the current portal", () => {
    expect(safeReturnPath("/admin/pedidos?status=paid", "admin")).toBe("/admin/pedidos?status=paid");
    expect(safeReturnPath("/fotografo/fotos", "photographer")).toBe("/fotografo/fotos");
    for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "/admin/../fotografo", "/admin/login", "/fotografo", "/admin\n/pedidos"]) expect(safeReturnPath(value, "admin")).toBe("/admin");
  });
});
