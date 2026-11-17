import { describe, expect, it } from "vitest";
import { leefTraderManifest } from "./templates";

describe("LEEF Trader Jev gateway preset", () => {
  it("allows the shared TG token-screen batch of 12 assets (24 independent questions)", () => {
    const manifest = leefTraderManifest("leef-trader-ai");
    expect(manifest.routes["/api/judge"]).toBe("judge");
    expect(manifest.providers.judge).toMatchObject({
      type: "typesafe",
      model: "jev-latest",
      maxQuestions: 32,
      secretName: "TYPESAFE_API_KEY",
    });
  });
});
