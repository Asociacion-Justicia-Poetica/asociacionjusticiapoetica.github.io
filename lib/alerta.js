/**
 * Aviso de que algo ha fallado.
 *
 * Existe por un caso concreto: si el envío del formulario de ayuda falla,
 * la persona ve una página de error, pero la Asociación no se entera de que
 * alguien intentó pedir ayuda. Este módulo cierra ese punto ciego.
 *
 * Tres reglas que conviene no deshacer:
 *
 *   1. **No viaja ningún dato de la persona.** Ni su relato, ni su contacto,
 *      ni su provincia. Solo qué falló, cuándo y por qué. Un aviso sirve para
 *      saber que hay que actuar, no para leer lo que alguien contó.
 *   2. **No usa el correo.** Sería avisar del incendio por el conducto que
 *      está ardiendo. Va por canales distintos del servidor de correo
 *      principal, salvo el respaldo, que exige otro proveedor a propósito.
 *   3. **Nunca lanza.** Si el aviso falla, se registra y se sigue. Que no
 *      podamos avisar no puede empeorar lo que le mostramos a quien escribe.
 *
 * Todos los canales son opcionales. Sin variables configuradas esto no hace
 * nada y no molesta: el resto del sitio funciona igual.
 *
 * Variables, todas opcionales:
 *   TELEGRAM_TOKEN + TELEGRAM_CHAT_ID   aviso al móvil por Telegram
 *   ALERTA_WEBHOOK                      un POST con JSON a donde se quiera
 *   ALERTA_SMTP_HOST, _PORT, _USER, _PASS, ALERTA_MAIL_TO
 *                                       correo de respaldo, en OTRO proveedor
 */

/** Espera máxima por canal. Un aviso lento no puede retrasar la respuesta. */
const ESPERA_MS = 5000;

/**
 * Freno para no convertir una avería en una lluvia de avisos.
 *
 * Vive en memoria, así que solo frena dentro de la misma instancia de la
 * función. Si Vercel levanta varias, pueden colarse algunos avisos de más.
 * Es el precio de no montar un almacén para esto, y avisar de más es un
 * problema mucho menor que no avisar.
 *
 * **El freno es por clase de aviso, no uno para todos.** Los pagos fallidos
 * son bastante más frecuentes que las averías de correo: con un solo freno
 * compartido, una tarde de pagos rechazados silenciaría justo el aviso de que
 * el servidor de correo ha dejado de funcionar, que es el grave.
 */
const ultimoAviso = new Map();
const VENTANA_MS = 15 * 60 * 1000;

function ahoraEnEspana() {
  return new Date().toLocaleString('es-ES', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid'
  });
}

async function porTelegram(mensaje) {
  const token = process.env.TELEGRAM_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return null;

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: mensaje }),
    signal: AbortSignal.timeout(ESPERA_MS)
  });
  if (!r.ok) throw new Error(`Telegram respondió ${r.status}`);
  return 'telegram';
}

async function porWebhook(mensaje, detalle) {
  const url = process.env.ALERTA_WEBHOOK;
  if (!url) return null;

  // "text" y "content" son los nombres que esperan Slack y Discord. Mandar
  // los dos hace que el mismo webhook valga para casi cualquier servicio.
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: mensaje, content: mensaje, ...detalle }),
    signal: AbortSignal.timeout(ESPERA_MS)
  });
  if (!r.ok) throw new Error(`El webhook respondió ${r.status}`);
  return 'webhook';
}

async function porCorreoDeRespaldo(mensaje) {
  const host = process.env.ALERTA_SMTP_HOST;
  const para = process.env.ALERTA_MAIL_TO;
  if (!host || !para) return null;

  const { default: nodemailer } = await import('nodemailer');
  const puerto = Number(process.env.ALERTA_SMTP_PORT || 465);
  const transporte = nodemailer.createTransport({
    host,
    port: puerto,
    secure: puerto === 465,
    auth: { user: process.env.ALERTA_SMTP_USER, pass: process.env.ALERTA_SMTP_PASS }
  });
  await transporte.sendMail({
    from: process.env.ALERTA_SMTP_USER,
    to: para,
    subject: 'Justicia Poética: aviso técnico',
    text: mensaje
  });
  return 'correo de respaldo';
}

/**
 * Avisa por todos los canales configurados.
 *
 * @param {string} asunto  Qué ha fallado, en una línea. Sin datos personales.
 * @param {object} detalle Datos técnicos: código de error, endpoint. Nunca
 *                         contenido del formulario.
 * @param {string} nota    Sustituye al texto de consecuencia. Sirve para
 *                         distinguir una prueba de una avería de verdad.
 * @param {string} clase   Con qué otros avisos comparte el freno de 15 min.
 *                         Clases distintas no se silencian entre sí.
 * @returns {Promise<string[]>} Canales por los que se pudo avisar.
 */
export async function avisarDeFallo(asunto, detalle = {}, nota = null, clase = 'general') {
  const nada = !process.env.TELEGRAM_TOKEN && !process.env.ALERTA_WEBHOOK
    && !process.env.ALERTA_SMTP_HOST;
  if (nada) return [];

  const ahora = Date.now();
  if (ahora - (ultimoAviso.get(clase) || 0) < VENTANA_MS) return ['silenciado'];
  ultimoAviso.set(clase, ahora);

  const tecnico = Object.entries(detalle)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const mensaje = [
    `⚠️ ${asunto}`,
    '',
    `Cuándo: ${ahoraEnEspana()}`,
    ...(tecnico ? [tecnico] : []),
    '',
    ...(nota ? [nota] : [
      'Hay alguien esperando respuesta y su mensaje NO ha llegado.',
      'Puede que te escriba por WhatsApp o por correo: es la salida que le ofrece la página.',
      '',
      'Este aviso no incluye nada de lo que esa persona contó, a propósito.'
    ])
  ].join('\n');

  const resultados = await Promise.allSettled([
    porTelegram(mensaje),
    porWebhook(mensaje, detalle),
    porCorreoDeRespaldo(mensaje)
  ]);

  const enviados = [];
  for (const r of resultados) {
    if (r.status === 'fulfilled' && r.value) enviados.push(r.value);
    else if (r.status === 'rejected') console.error('Fallo al avisar:', r.reason && r.reason.message);
  }

  if (!enviados.length) console.error('No se pudo avisar por ningún canal.');
  return enviados;
}
