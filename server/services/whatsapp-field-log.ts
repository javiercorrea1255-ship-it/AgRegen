import { createHash } from "node:crypto";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";

export interface FieldLogMedia {
  buffer: Buffer;
  mimeType: string;
  size: number;
  kind: "image" | "audio";
}

/** Evidence only: field-log interpretation now belongs to the single model turn. */
export async function saveFieldLogEvidence(ownerId: string, providerMessageId: string, media?: FieldLogMedia) {
  if (!media) return [];
  const extension = media.mimeType.split("/")[1]?.split(";")[0].replace("mpeg", "mp3") || "bin";
  const path = await new ObjectStorageService().savePrivateBuffer({
    ownerId, buffer: media.buffer, contentType: media.mimeType,
    namespace: "whatsapp-evidence", extension,
    objectId: createHash("sha256").update(providerMessageId).digest("hex"),
  });
  return [{ kind: media.kind, path, mimeType: media.mimeType, size: media.size, providerMessageId }];
}
