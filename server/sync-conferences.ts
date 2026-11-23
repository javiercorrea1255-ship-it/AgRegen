import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import { conferences, users } from "@shared/schema";
import { eq, like } from "drizzle-orm";


const SPEAKER = "Dr. Manrrubio Muñoz Rodríguez";
const SPEAKER_BIO =
  "Ingeniero Agrónomo Especialista en Sociología Rural, Universidad Autónoma Chapingo (1986). Doctor en Ciencias, Universidad Autónoma Chapingo (2001), especialidad en Problemas Económicos y Agroindustriales. Miembro del Sistema Nacional de Investigadores nivel I. Línea de investigación: evaluación y utilización sostenible de recursos genéticos pecuarios.";

const YOUTUBE_CONFERENCES = [
  {
    videoUrl: "https://www.youtube.com/watch?v=YjmETfKWx-g",
    title:
      "Megatendencias y catalizadores que configuran oportunidades y amenazas en los sistemas alimentarios (YouTube)",
    description:
      "Webinar sobre las grandes fuerzas globales —tecnología, cambio climático, demografía y consumo— que están rediseñando los sistemas alimentarios y sus implicaciones para los productores.",
    thumbnailUrl: "https://img.youtube.com/vi/YjmETfKWx-g/maxresdefault.jpg",
    eventDate: new Date("2024-04-10"),
    tags: ["agricultura regenerativa", "webinar", "gratuito"],
    viewsCount: 370,
    isFeatured: false,
  },
  {
    videoUrl: "https://www.youtube.com/watch?v=b2VojCo4FmM",
    title: "Pan para hoy… ¿y mañana qué comemos? Seguridad alimentaria en crisis",
    description:
      "Conferencia que analiza la fragilidad de los sistemas alimentarios globales, los factores que amenazan la seguridad alimentaria y las estrategias regenerativas para garantizar la producción de alimentos a largo plazo.",
    thumbnailUrl: "https://img.youtube.com/vi/b2VojCo4FmM/maxresdefault.jpg",
    eventDate: new Date("2026-04-09"),
    tags: ["agricultura regenerativa", "seguridad alimentaria", "sistemas alimentarios"],
    viewsCount: 717,
    isFeatured: false,
  },
];

export async function syncConferences() {
  const adminEmail = process.env.AG_REGEN_ADMIN_EMAIL?.trim();
  if (!adminEmail) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool);

  try {
    const admin = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);

    if (!admin.length) {
      console.log("[sync-conferences] Admin not found, skipping.");
      return;
    }
    const adminId = admin[0].id;

    const deleted = await db
      .delete(conferences)
      .where(like(conferences.videoUrl, "%facebook.com%"))
      .returning({ id: conferences.id });
    if (deleted.length > 0) {
      console.log(`[sync-conferences] Deleted ${deleted.length} Facebook conference(s).`);
    }

    for (const conf of YOUTUBE_CONFERENCES) {
      const existing = await db
        .select({ id: conferences.id })
        .from(conferences)
        .where(eq(conferences.videoUrl, conf.videoUrl))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(conferences).values({
          ...conf,
          speaker: SPEAKER,
          speakerBio: SPEAKER_BIO,
          status: "published",
          createdBy: adminId,
        } as any);
        console.log(`[sync-conferences] Inserted: ${conf.title.slice(0, 50)}`);
      }
    }

    console.log("[sync-conferences] Done.");
  } catch (error) {
    console.error("[sync-conferences] Error:", error);
  } finally {
    await pool.end();
  }
}
