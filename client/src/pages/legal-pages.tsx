import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, FileText, Leaf, Mail, ShieldCheck, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const LAST_UPDATED = "27 de agosto de 2026";
const CONTACT_EMAIL = "redagricultores@gmail.com";

function LegalShell({
  title,
  eyebrow,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  eyebrow: string;
  description: string;
  icon: typeof ShieldCheck;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="bg-gradient-to-br from-emerald-950 via-emerald-900 to-primary text-white">
        <div className="max-w-4xl mx-auto px-4 py-12 md:py-16">
          <Link href="/">
            <span className="inline-flex items-center gap-2 text-sm text-white/75 hover:text-white mb-8 cursor-pointer">
              <ArrowLeft className="h-4 w-4" /> Volver a AgRegen
            </span>
          </Link>
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-white/10 p-3 shrink-0">
              <Icon className="h-8 w-8" />
            </div>
            <div>
              <Badge className="bg-white/15 text-white border-white/20 mb-3">{eyebrow}</Badge>
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight">{title}</h1>
              <p className="mt-4 max-w-2xl text-white/75 leading-relaxed">{description}</p>
              <p className="mt-5 text-xs text-white/60">Última actualización: {LAST_UPDATED}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-10 md:py-14">
        <div className="space-y-6">{children}</div>
        <div className="mt-12 border-t pt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link href="/politica-de-privacidad"><span className="text-primary hover:underline cursor-pointer">Privacidad</span></Link>
          <Link href="/terminos-y-condiciones"><span className="text-primary hover:underline cursor-pointer">Términos y condiciones</span></Link>
          <Link href="/eliminacion-de-datos"><span className="text-primary hover:underline cursor-pointer">Eliminar mis datos</span></Link>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl md:text-2xl font-semibold mb-3">{title}</h2>
      <div className="text-muted-foreground leading-7 space-y-3">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary mt-1 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalShell
      title="Política de privacidad"
      eyebrow="AgRegen 5.0 · Información legal"
      description="Cómo AgRegen recopila, utiliza y protege la información de productores, parcelas y conversaciones con el asistente."
      icon={ShieldCheck}
    >
      <Card>
        <CardContent className="p-6 md:p-8">
          <Section title="1. Responsable y alcance">
            <p>AgRegen 5.0 (“AgRegen”, “la plataforma” o “nosotros”) administra este sitio y sus herramientas de agricultura regenerativa en <strong>ag-regen.com</strong>. Esta política aplica a la plataforma web, el Asistente IA y la conexión opcional con WhatsApp Business.</p>
            <p>Al utilizar AgRegen aceptas el tratamiento descrito aquí. Si no estás de acuerdo, puedes dejar de utilizar el servicio y solicitar la eliminación de tus datos.</p>
          </Section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Información que podemos recopilar</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <BulletList items={[
            "Datos de cuenta y contacto, como nombre, correo electrónico y preferencias de idioma.",
            "Datos de parcelas, incluyendo ubicación, superficie, cultivo, fechas, análisis de suelo, prácticas de manejo, muestreos y observaciones.",
            "Datos derivados de servicios satelitales, climáticos y de mapas para mostrar índices, alertas y recomendaciones.",
            "Mensajes que envías al Asistente IA, respuestas, archivos y fotografías que adjuntas para diagnóstico.",
            "Si activas WhatsApp Business: número telefónico, identificadores técnicos de mensajes y el contenido que envíes por ese canal.",
            "Información técnica necesaria para seguridad, funcionamiento, sesiones y diagnóstico de errores."
          ]} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 md:p-8">
          <Section title="3. Para qué utilizamos la información">
            <BulletList items={[
              "Crear y mostrar el contexto de tus parcelas y sus análisis.",
              "Generar respuestas, recomendaciones y diagnósticos del Asistente IA.",
              "Procesar fotografías enviadas voluntariamente para análisis visual.",
              "Enviar y recibir mensajes por WhatsApp cuando tú vinculas un número.",
              "Mejorar la seguridad, prevenir abuso, mantener sesiones y resolver fallas.",
              "Cumplir obligaciones legales y responder solicitudes de ejercicio de derechos."
            ]} />
          </Section>
          <div className="mt-8">
            <Section title="4. Servicios que intervienen">
              <p>Para operar AgRegen podemos utilizar proveedores tecnológicos que procesan información únicamente para prestar el servicio: alojamiento y base de datos, Meta WhatsApp Business, servicios de inteligencia artificial, Google Earth Engine, servicios meteorológicos y almacenamiento de archivos. Cada proveedor recibe solo la información necesaria para su función.</p>
              <p>No vendemos datos personales ni usamos las fotografías de parcelas para publicidad.</p>
            </Section>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 md:p-8">
          <Section title="5. Conservación y seguridad">
            <p>Conservamos la información mientras la cuenta o la parcela permanezca activa, o durante el tiempo necesario para cumplir obligaciones legales. Las solicitudes de eliminación se atienden conforme al procedimiento publicado en la página de <Link href="/eliminacion-de-datos"><span className="text-primary hover:underline cursor-pointer">eliminación de datos</span></Link>.</p>
            <p>Aplicamos controles de acceso por usuario y parcela, códigos temporales para vincular WhatsApp, validación de firmas del webhook y medidas razonables de seguridad. Ningún sistema conectado a internet puede garantizar seguridad absoluta.</p>
          </Section>
          <div className="mt-8">
            <Section title="6. Tus derechos y contacto">
              <p>Puedes solicitar acceso, corrección, actualización, limitación o eliminación de tus datos, así como retirar tu consentimiento cuando corresponda. Escribe a <a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> indicando tu nombre, correo de cuenta y la solicitud. Podremos pedir información adicional para verificar tu identidad.</p>
            </Section>
          </div>
        </CardContent>
      </Card>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell
      title="Términos y condiciones"
      eyebrow="AgRegen 5.0 · Condiciones de uso"
      description="Reglas para utilizar la plataforma de monitoreo agrícola, el Asistente IA y el canal de WhatsApp Business."
      icon={FileText}
    >
      <Card>
        <CardContent className="p-6 md:p-8">
          <Section title="1. Aceptación del servicio">
            <p>Estos términos regulan el uso de AgRegen 5.0. Al crear una cuenta, acceder a una parcela o utilizar el Asistente IA, aceptas estas condiciones. Si actúas en nombre de una organización, confirmas que tienes autorización para hacerlo.</p>
          </Section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Qué ofrece AgRegen</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-muted-foreground leading-7">
          <p>AgRegen ofrece herramientas de registro, monitoreo satelital, análisis de suelo, clima, zonificación, prescripciones y apoyo conversacional para agricultura regenerativa.</p>
          <p>Los resultados dependen de la calidad, fecha y disponibilidad de los datos de entrada y de los servicios externos. Los índices, modelos, alertas y recomendaciones son informativos y no constituyen una garantía de rendimiento ni sustituyen la evaluación de un agrónomo, laboratorio, técnico o autoridad competente.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 md:p-8">
          <Section title="3. Responsabilidades de la persona usuaria">
            <BulletList items={[
              "Proporcionar información veraz y mantener protegidas las credenciales de la cuenta.",
              "Contar con autorización para cargar datos, fotografías y documentos de una parcela.",
              "Revisar las recomendaciones antes de aplicarlas y tomar decisiones considerando las condiciones reales del campo.",
              "No utilizar la plataforma para actividades ilegales, abusivas, automatizadas o que intenten vulnerar cuentas, datos o servicios.",
              "No enviar por el chat secretos, contraseñas, tokens, información financiera o datos personales innecesarios de terceros."
            ]} />
          </Section>
          <div className="mt-8">
            <Section title="4. Fotografías, contenido y WhatsApp">
              <p>Conservas tus derechos sobre el contenido que subes, pero autorizas a AgRegen a procesarlo para prestar las funciones que solicites. Cuando vinculas WhatsApp, autorizas el intercambio de mensajes entre tu número y la cuenta oficial de AgRegen. El código de vinculación es temporal y debes mantenerlo privado.</p>
              <p>WhatsApp en esta versión admite preguntas escritas y fotografías JPG, PNG o WebP de hasta 10 MB. No están incluidos grupos, audios, videos, documentos ni campañas masivas.</p>
            </Section>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 md:p-8">
          <Section title="5. Disponibilidad, propiedad y responsabilidad">
            <p>AgRegen puede cambiar, suspender o retirar funciones para mantenimiento, seguridad o cumplimiento legal. Procuramos mantener la plataforma disponible, pero no garantizamos disponibilidad continua ni exactitud completa de datos externos.</p>
            <p>La plataforma, su código, diseño, marcas y materiales propios pertenecen a sus respectivos titulares. El uso de AgRegen no transfiere derechos de propiedad intelectual.</p>
          </Section>
          <div className="mt-8">
            <Section title="6. Cambios y contacto">
              <p>Podemos actualizar estos términos cuando cambien el servicio o la legislación. Publicaremos la versión vigente en esta URL. Para dudas o solicitudes relacionadas con el servicio, escribe a <a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
            </Section>
          </div>
        </CardContent>
      </Card>
    </LegalShell>
  );
}

export function DataDeletionPage() {
  return (
    <LegalShell
      title="Instrucciones para eliminar tus datos"
      eyebrow="AgRegen 5.0 · Control de datos"
      description="Solicita la eliminación de tu cuenta, parcela, conversaciones, fotografías y vínculo de WhatsApp."
      icon={Trash2}
    >
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-primary/10 p-3 text-primary"><Mail className="h-6 w-6" /></div>
            <div>
              <h2 className="text-xl font-semibold mb-2">Solicitar eliminación por correo</h2>
              <p className="text-muted-foreground leading-7">Envía tu solicitud a <a className="text-primary font-medium hover:underline" href={`mailto:${CONTACT_EMAIL}?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20datos`}>{CONTACT_EMAIL}</a> desde el correo asociado a tu cuenta.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pasos para solicitarla</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-4 text-muted-foreground">
            {[
              "Envía un correo con el asunto “Solicitud de eliminación de datos”.",
              "Incluye tu nombre, el correo de tu cuenta y, si aplica, el nombre de la parcela.",
              "Indica si deseas eliminar toda la cuenta o únicamente una parcela, conversación, fotografía o vínculo de WhatsApp.",
              "Si la solicitud proviene de un correo distinto, podremos pedir una verificación adicional para proteger la cuenta.",
              "Recibirás confirmación cuando la solicitud haya sido procesada."
            ].map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold shrink-0">{index + 1}</span>
                <span className="leading-7">{step}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 md:p-8 space-y-7">
          <Section title="Qué se elimina">
            <BulletList items={[
              "Datos de cuenta y perfil asociados a la solicitud.",
              "Parcelas, análisis, muestreos, configuraciones y datos derivados asociados.",
              "Conversaciones, memoria del asistente y fotografías almacenadas por AgRegen.",
              "La conexión entre tu número telefónico y tu parcela de WhatsApp."
            ]} />
          </Section>
          <Section title="Plazos y excepciones">
            <p>Procesaremos la solicitud dentro de un plazo máximo de 30 días naturales, salvo que sea necesario un plazo adicional permitido por la legislación aplicable. Algunos registros mínimos pueden conservarse cuando exista una obligación legal, una disputa, prevención de fraude o una copia técnica temporal; se eliminarán cuando deje de existir esa necesidad.</p>
            <p>Desvincular WhatsApp impide que el número vuelva a acceder al contexto de la parcela, pero no elimina automáticamente el resto de la cuenta. Para una eliminación completa, indícalo expresamente en el correo.</p>
          </Section>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardContent className="p-6 flex items-start gap-3 text-sm text-muted-foreground">
          <Leaf className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <p>Esta página existe para que puedas ejercer control sobre tus datos sin necesidad de iniciar sesión.</p>
        </CardContent>
      </Card>
    </LegalShell>
  );
}