/**
 * Utilidades para traducir los códigos de error estructurados que devuelve
 * el backend en POST /api/parcels/:id/zones/from-import a mensajes accionables
 * en español.
 *
 * Los códigos están definidos en server/routes/import-zones.ts
 * (`classifyZodImportError`).
 */

export type ImportErrorCode =
  | "ring_not_closed"
  | "non_finite_coord"
  | "validation_error";

export interface ImportErrorBody {
  errorCode?: ImportErrorCode;
  zoneIndex?: number | null;
  message?: string;
}

/**
 * Devuelve un mensaje accionable en español para el error de importación
 * estructurado recibido del backend. Cuando el código no es reconocible,
 * cae al campo `message` tal cual viene del servidor.
 *
 * @param body   Cuerpo JSON de la respuesta 4xx del backend.
 * @param fileName  Nombre del archivo que se intentó importar (opcional).
 */
export function translateImportError(
  body: ImportErrorBody,
  fileName: string | null | undefined,
): string {
  const file = fileName ? `"${fileName}"` : "el archivo";
  const zoneRef =
    typeof body.zoneIndex === "number"
      ? ` en la zona ${body.zoneIndex + 1}`
      : "";

  switch (body.errorCode) {
    case "ring_not_closed":
      return (
        `${file} contiene un polígono abierto${zoneRef} — el primer y último ` +
        `vértice del anillo deben coincidir. Exporta de nuevo desde tu SIG ` +
        `cerrando el anillo antes de importar.`
      );
    case "non_finite_coord":
      return (
        `${file} tiene una coordenada no válida (Infinity o NaN)${zoneRef}. ` +
        `Revisa la geometría en tu SIG y vuelve a exportar.`
      );
    default:
      return body.message ?? "Error de validación desconocido.";
  }
}
