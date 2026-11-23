import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import { conferences, users } from "../shared/schema";
import { eq } from "drizzle-orm";


const SPEAKER = "Dr. Manrrubio Muñoz Rodríguez";
const SPEAKER_BIO =
  "Ingeniero Agrónomo Especialista en Sociología Rural, Universidad Autónoma Chapingo (1986). Doctor en Ciencias, Universidad Autónoma Chapingo (2001), especialidad en Problemas Económicos y Agroindustriales. Miembro del Sistema Nacional de Investigadores nivel I. Línea de investigación: evaluación y utilización sostenible de recursos genéticos pecuarios.";
const TAGS = ["agricultura regenerativa", "webinar", "gratuito"];

const FB_THUMBNAIL = "/opengraph.jpg";

const SEED_CONFERENCES = [
  {
    title: "Innovación digital en la agricultura",
    description:
      "Webinar gratuito sobre el papel de las herramientas digitales en la transformación de la agricultura moderna, impartido por el Dr. Manrrubio Muñoz Rodríguez en el programa Directo al Campo.",
    videoUrl: "https://www.facebook.com/DirectoalCampoMX/videos/367162847911156",
    thumbnailUrl: FB_THUMBNAIL,
    eventDate: new Date("2021-04-20"),
    viewsCount: 683,
    isFeatured: false,
  },
  {
    title: "Producir-Proteger y Prosperar en la agricultura",
    description:
      "Webinar gratuito sobre el enfoque de triple P: producir alimentos, proteger los recursos naturales y prosperar económicamente en los sistemas agrícolas.",
    videoUrl: "https://www.facebook.com/DirectoalCampoMX/videos/518465479495425",
    thumbnailUrl: FB_THUMBNAIL,
    eventDate: new Date("2021-07-13"),
    viewsCount: 2700,
    isFeatured: false,
  },
  {
    title:
      "Modelos de negocio en la agricultura regenerativa: entendiendo el proceso de emprendimiento agroalimentario",
    description:
      "Webinar gratuito — el más visto de la serie con más de 80 mil reproducciones. Explora cómo diseñar y escalar modelos de negocio viables dentro del paradigma de la agricultura regenerativa.",
    videoUrl: "https://www.facebook.com/DirectoalCampoMX/videos/1261185947725313",
    thumbnailUrl: FB_THUMBNAIL,
    eventDate: new Date("2022-02-01"),
    viewsCount: 80600,
    isFeatured: true,
  },
  {
    title:
      "Agricultura regenerativa: ¿vino añejo en botella reluciente, o cambio en las reglas del juego en la agricultura?",
    description:
      "Webinar gratuito que analiza críticamente si la agricultura regenerativa representa una verdadera ruptura paradigmática o una reembolsamiento de prácticas antiguas con nueva terminología.",
    videoUrl: "https://www.facebook.com/DirectoalCampoMX/videos/1730749834059721",
    thumbnailUrl: FB_THUMBNAIL,
    eventDate: new Date("2023-09-20"),
    viewsCount: 32000,
    isFeatured: false,
  },
  {
    title:
      "Megatendencias y catalizadores que configuran oportunidades y amenazas en los sistemas alimentarios (DirectoalCampo)",
    description:
      "Webinar gratuito sobre las grandes fuerzas globales —tecnología, cambio climático, demografía y consumo— que están rediseñando los sistemas alimentarios y sus implicaciones para los productores.",
    videoUrl: "https://www.facebook.com/DirectoalCampoMX/videos/1212324063259905",
    thumbnailUrl: FB_THUMBNAIL,
    eventDate: new Date("2024-04-09"),
    viewsCount: 4400,
    isFeatured: false,
  },
  {
    title:
      "Megatendencias y catalizadores que configuran oportunidades y amenazas en los sistemas alimentarios (SMEAPSC)",
    description:
      "Segunda transmisión del webinar sobre megatendencias en sistemas alimentarios, presentada ante la Sociedad Mexicana de Especialistas en Agricultura de Precisión y Sistemas Complejos (SMEAPSC).",
    videoUrl: "https://www.facebook.com/smeapsc/videos/1121087592548563",
    thumbnailUrl: FB_THUMBNAIL,
    eventDate: new Date("2024-04-09"),
    viewsCount: 11000,
    isFeatured: false,
  },
  {
    title: "Agricultura Regenerativa: De la explotación de la tierra… ¡a la regeneración!",
    description:
      "Webinar gratuito que traza el camino desde la agricultura extractiva hacia modelos regenerativos, con evidencia científica y casos prácticos de productores mexicanos.",
    videoUrl: "https://www.facebook.com/DirectoalCampoMX/videos/1158428432628132",
    thumbnailUrl: FB_THUMBNAIL,
    eventDate: new Date("2025-01-27"),
    viewsCount: 6400,
    isFeatured: false,
  },
];

async function main() {
  const adminEmail = process.env.AG_REGEN_ADMIN_EMAIL?.trim();
  if (!adminEmail) throw new Error("Set AG_REGEN_ADMIN_EMAIL to an existing administrator.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool);

  try {
    const adminRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);

    if (adminRows.length === 0) {
      console.error("Configured administrator not found.");
      process.exit(1);
    }
    const adminId = adminRows[0].id;

    let inserted = 0;
    let skipped = 0;

    for (const conf of SEED_CONFERENCES) {
      const existing = await db
        .select({ id: conferences.id })
        .from(conferences)
        .where(eq(conferences.title, conf.title))
        .limit(1);

      if (existing.length > 0) {
        console.log(`  skip (already exists): ${conf.title.slice(0, 60)}…`);
        skipped++;
        continue;
      }

      await db.insert(conferences).values({
        title: conf.title,
        description: conf.description,
        videoUrl: conf.videoUrl,
        thumbnailUrl: conf.thumbnailUrl,
        speaker: SPEAKER,
        speakerBio: SPEAKER_BIO,
        eventDate: conf.eventDate,
        tags: TAGS,
        isFeatured: conf.isFeatured,
        status: "published",
        viewsCount: conf.viewsCount,
        createdBy: adminId,
      });
      console.log(`  inserted: ${conf.title.slice(0, 60)}…`);
      inserted++;
    }

    console.log(`\nDone: ${inserted} inserted, ${skipped} skipped.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
