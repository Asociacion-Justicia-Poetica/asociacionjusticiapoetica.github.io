/**
 * Aviso de vencimiento del carnet.
 *
 * Tarea diaria. Recorre a los Poetas cuyo carnet viene de un donativo puntual
 * y avisa dos veces: una semana antes de que venza, y una vez cuando ya ha
 * vencido.
 *
 * El sentido no es administrativo. Un carnet que caduca es el momento natural
 * para volver a donar, y quien no se entera de que ha caducado simplemente
 * desaparece. Esto convierte la caducidad en un recordatorio.
 *
 * Los Poetas recurrentes no reciben nada de esto: su carnet no caduca, y al
 * darse de alta se les vacía `carnet_hasta`.
 *
 * Vercel invoca esta dirección por GET y, si existe la variable CRON_SECRET,
 * incluye una cabecera Authorization con su valor. Sin esa variable la función
 * no hace nada: un punto de entrada que envía correos no puede quedar abierto.
 *
 * Cada aviso se marca en la ficha del cliente. Vercel avisa de que la entrega
 * de las tareas programadas es "best effort" y puede repetirse o saltarse un
 * día, así que la función tiene que aguantar ambas cosas sin duplicar correos.
 */

import nodemailer from 'nodemailer';
import { stripeCliente, SITIO, urlCarnet } from '../lib/carnet.js';

const DIAS_PREAVISO = 7;
/** Pasado este plazo desde el vencimiento ya no se insiste. */
const DIAS_GRACIA = 45;
/** Freno por si algo se descontrola: nunca más de estos correos en una pasada. */
const MAXIMO_POR_PASADA = 60;

const ENLACE_DONATIVO = 'https://donate.stripe.com/9B68wOaCN4hzcMK6Mj4Ja0b';

function enEspanol(fecha) {
  return fecha.toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid'
  });
}

function cuerpo({ nombre, hasta, vencido, enlaceCarnet }) {
  const saludo = nombre ? `Hola, ${nombre}` : 'Hola';
  const encabezado = vencido
    ? `<p style="font-size:17px;line-height:1.6">Tu carnet de Poeta Guerrero venció el <strong>${hasta}</strong>.</p>
  <p style="font-size:17px;line-height:1.6">No te escribo para reclamarte nada. Te escribo porque no quiero que dejes de ser Poeta sin enterarte.</p>`
    : `<p style="font-size:17px;line-height:1.6">Tu carnet de Poeta Guerrero vence el <strong>${hasta}</strong>.</p>
  <p style="font-size:17px;line-height:1.6">Te aviso con tiempo para que no te pille por sorpresa el día que vayas a usarlo.</p>`;

  return `<div style="font-family:Georgia,'Times New Roman',serif;color:#171717;max-width:560px;margin:0 auto;padding:8px">
  <p style="font-size:17px;line-height:1.6">${saludo}:</p>
  ${encabezado}
  <p style="font-size:17px;line-height:1.6">Con un nuevo donativo vuelve a activarse en el momento. Contamos cada 10 euros como un mes de carnet, y si lo haces antes de que venza, los meses nuevos se suman a los que te queden.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="${ENLACE_DONATIVO}" style="background:#124a48;color:#ffffff;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:999px;display:inline-block">Renovar mi carnet</a>
  </p>
  <p style="font-size:15px;line-height:1.6;color:#56534d">Si prefieres una aportación mensual en vez de donativos sueltos, desde 10 euros al mes el carnet ya no caduca nunca: <a href="${SITIO}/poetas-guerreros.html#alta" style="color:#124a48">hazte Poeta Guerrero</a>.</p>
  <p style="font-size:15px;line-height:1.6;color:#56534d">Tu carnet, por si quieres consultarlo: <a href="${enlaceCarnet}" style="color:#124a48">verlo aquí</a>.</p>
  <p style="font-size:17px;line-height:1.6">Y pase lo que pase, gracias por lo que ya diste. Ese dinero está sosteniendo causas ahora mismo.</p>
  <p style="font-size:17px;line-height:1.6">Mario Díez<br><span style="color:#56534d;font-size:15px">Presidente de la Asociación Justicia Poética</span></p>
</div>`;
}

export default async function handler(req, res) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) {
    console.error('Falta CRON_SECRET: la tarea no se ejecuta.');
    return res.status(503).json({ error: 'Falta CRON_SECRET' });
  }
  if (req.headers.authorization !== `Bearer ${esperado}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const stripe = stripeCliente();
    const ahora = new Date();
    const transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const resumen = { revisados: 0, preaviso: 0, vencidos: 0, errores: 0 };
    let pagina = await stripe.customers.list({ limit: 100 });
    let vueltas = 0;

    while (true) {
      for (const cliente of pagina.data) {
        const marca = cliente.metadata?.carnet_hasta;
        if (!marca || !cliente.email) continue;

        const vence = new Date(marca);
        if (Number.isNaN(vence.getTime())) continue;
        resumen.revisados++;

        const dias = Math.ceil((vence - ahora) / 86400000);
        let tipo = null;
        if (dias > 0 && dias <= DIAS_PREAVISO && !cliente.metadata?.aviso_preaviso) tipo = 'preaviso';
        else if (dias <= 0 && dias > -DIAS_GRACIA && !cliente.metadata?.aviso_vencido) tipo = 'vencido';
        if (!tipo) continue;

        if (resumen.preaviso + resumen.vencidos >= MAXIMO_POR_PASADA) break;

        try {
          const vencido = tipo === 'vencido';
          await transporte.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to: cliente.email,
            bcc: process.env.MAIL_TO,
            subject: vencido
              ? 'Tu carnet de Poeta Guerrero ha vencido'
              : `Tu carnet de Poeta Guerrero vence el ${enEspanol(vence)}`,
            html: cuerpo({
              nombre: cliente.name,
              hasta: enEspanol(vence),
              vencido,
              enlaceCarnet: urlCarnet(cliente.id)
            }),
            text: (vencido
              ? `Tu carnet de Poeta Guerrero venció el ${enEspanol(vence)}.`
              : `Tu carnet de Poeta Guerrero vence el ${enEspanol(vence)}.`)
              + `\n\nCon un nuevo donativo vuelve a activarse: ${ENLACE_DONATIVO}`
              + `\n\nGracias por lo que ya diste.\nMario Díez, presidente.`
          });

          // Marcar solo después de enviar: si el correo falla, mañana se
          // vuelve a intentar en vez de darlo por hecho.
          await stripe.customers.update(cliente.id, {
            metadata: vencido
              ? { aviso_vencido: ahora.toISOString() }
              : { aviso_preaviso: ahora.toISOString() }
          });
          resumen[vencido ? 'vencidos' : 'preaviso']++;
        } catch (error) {
          resumen.errores++;
          console.error('Fallo al avisar a un Poeta:', error && error.message);
        }
      }

      if (!pagina.has_more || vueltas++ > 20) break;
      pagina = await stripe.customers.list({
        limit: 100,
        starting_after: pagina.data[pagina.data.length - 1].id
      });
    }

    console.log('Avisos de vencimiento:', JSON.stringify(resumen));
    return res.status(200).json(resumen);
  } catch (error) {
    console.error('Fallo en la tarea de avisos:', error && error.message);
    return res.status(500).json({ error: 'Fallo en la tarea' });
  }
}
