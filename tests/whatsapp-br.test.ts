import { describe, expect, it } from "vitest";
import { brazilWithNinthDigit } from "@/server/whatsapp/client";

describe("brazilWithNinthDigit", () => {
  it("adiciona o 9 em celular brasileiro de 12 dígitos", () => {
    expect(brazilWithNinthDigit("554497317970")).toBe("5544997317970");
  });
  it("não mexe em número que já tem o 9, fixo ou estrangeiro", () => {
    expect(brazilWithNinthDigit("5544997317970")).toBeNull();
    expect(brazilWithNinthDigit("554432221234")).toBeNull();
    expect(brazilWithNinthDigit("16315551181")).toBeNull();
  });
});
