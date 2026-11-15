import { describe, expect, it } from "vitest";
import { leefTraderManifest } from "./templates";

describe("LEEF Trader strategic control-review contract", () => {
  const manifest = leefTraderManifest("leef-trader-ai");
  const provider = manifest.providers.ai;

  it("keeps the AI helper explicitly non-custodial and non-authorizing", () => {
    expect(provider?.type).toBe("openai");
    if (provider?.type !== "openai") throw new Error("LEEF Trader AI provider is missing");
    expect(provider.systemPrompt).toContain('"trade_authorization": false');
    expect(provider.systemPrompt).toContain("does not approve a transaction");
    expect(provider.systemPrompt).toContain("cannot override Jev");
  });

  it("requires an exact candidate-bound approve, veto, or abstain review when requested", () => {
    expect(provider?.type).toBe("openai");
    if (provider?.type !== "openai") throw new Error("LEEF Trader AI provider is missing");
    const prompt = provider.systemPrompt;
    expect(prompt).toContain("control_review_request");
    expect(prompt).toContain("candidate_id");
    expect(prompt).toContain("approve");
    expect(prompt).toContain("veto");
    expect(prompt).toContain("abstain");
    expect(prompt).toContain("risk_flags");
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("Do not omit the object when this request is present");
  });

  it("preserves the regular analyst schema and LEEF Trader PPQ route", () => {
    expect(manifest.routes["/api/ai"]).toBe("ai");
    expect(provider?.type).toBe("openai");
    if (provider?.type !== "openai") throw new Error("LEEF Trader AI provider is missing");
    expect(provider.endpoint).toBe("https://api.ppq.ai/v1");
    expect(provider.systemPrompt).toContain('"assessment"');
    expect(provider.systemPrompt).toContain('"observations"');
    expect(provider.systemPrompt).toContain('"trade_authorization": false');
  });
});
