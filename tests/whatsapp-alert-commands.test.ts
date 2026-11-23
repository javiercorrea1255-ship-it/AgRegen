import { afterEach, describe, expect, it, vi } from "vitest";
import { processWeatherAlertCommand } from "../server/routes/whatsapp";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("WhatsApp weather alert commands", () => {
  it("does not activate ALERTAS SI in production without an approved template", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.WHATSAPP_ALERT_TEMPLATE_NAME;
    const storage = {
      getWeatherAlertPreferenceForUser: vi.fn().mockResolvedValue(undefined),
      applyWeatherAlertCommand: vi.fn(),
    };
    const send = vi.fn().mockResolvedValue(undefined);

    await processWeatherAlertCommand({
      command: "yes",
      providerMessageId: "wamid-command-1",
      connection: { id: "connection-1", userId: "user-1" },
      storage: storage as any,
      send,
    });

    expect(storage.applyWeatherAlertCommand).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.stringContaining("No se activaron"));
  });

  it("applies ALERTAS SI once when the production template is available", async () => {
    process.env.NODE_ENV = "production";
    process.env.WHATSAPP_ALERT_TEMPLATE_NAME = "agregen_alerta_climatica";
    const storage = {
      getWeatherAlertPreferenceForUser: vi.fn().mockResolvedValue(undefined),
      applyWeatherAlertCommand: vi.fn().mockResolvedValue({ enabled: true }),
    };
    const send = vi.fn().mockResolvedValue(undefined);

    await processWeatherAlertCommand({
      command: "yes",
      providerMessageId: "wamid-command-2",
      connection: { id: "connection-1", userId: "user-1" },
      storage: storage as any,
      send,
    });

    expect(storage.applyWeatherAlertCommand).toHaveBeenCalledWith(
      "wamid-command-2",
      "user-1",
      "connection-1",
      true,
    );
    expect(send).toHaveBeenCalledWith(expect.stringContaining("activadas"));
  });
});