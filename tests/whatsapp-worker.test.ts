import { describe, expect, it, vi } from "vitest";
import { WhatsappProviderError } from "../server/services/whatsapp-business";
import { experienceCommand, normalizedCommand, sendDurableWhatsappText } from "../server/routes/whatsapp";

function fakeStorage(result: { status: string; claimed: boolean }) {
  return {
    claimWhatsappOutbound: vi.fn().mockResolvedValue({
      claimed: result.claimed,
      message: { status: result.status, bodyHash: "unused" },
    }),
    completeWhatsappOutbound: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("durable WhatsApp outbound delivery", () => {
  it("maps interactive reply IDs to the same commands as typed messages", () => {
    expect(normalizedCommand("Fue útil", "feedback_helpful")).toBe("ÚTIL");
    expect(normalizedCommand("Fue útil", "feedback_helpful:message-123")).toBe("ÚTIL");
    expect(experienceCommand(normalizedCommand("Aplicado", "followup_applied:interaction-123"))).toBe("followup_applied");
    expect(experienceCommand(normalizedCommand("", "human_help"))).toBe("advisor");
    expect(experienceCommand("RESPUESTA DETALLADA")).toBe("detailed");
  });
  it("suppresses a retry when delivery is already ambiguous", async () => {
    const storage = fakeStorage({ status: "ambiguous", claimed: false });
    const sender = vi.fn();
    await expect(sendDurableWhatsappText(storage, "in-1", "521234", "Respuesta", "answer", 0, sender))
      .rejects.toThrow("delivery is unresolved");
    expect(sender).not.toHaveBeenCalled();
  });

  it("records a successful provider message id", async () => {
    const storage = fakeStorage({ status: "sending", claimed: true });
    const sender = vi.fn().mockResolvedValue("wamid.out-1");
    await sendDurableWhatsappText(storage, "in-2", "521234", "Respuesta", "answer", 0, sender);
    expect(storage.completeWhatsappOutbound).toHaveBeenCalledWith("in-2:answer:0", "wamid.out-1", "sent");
  });

  it("marks definite HTTP failures retryable without treating them as ambiguous", async () => {
    const storage = fakeStorage({ status: "sending", claimed: true });
    const sender = vi.fn().mockRejectedValue(new WhatsappProviderError("Meta 500", 500));
    await expect(sendDurableWhatsappText(storage, "in-3", "521234", "Respuesta", "answer", 0, sender)).rejects.toThrow();
    expect(storage.completeWhatsappOutbound).toHaveBeenCalledWith("in-3:answer:0", "unknown", "failed", "Meta 500");
  });
});