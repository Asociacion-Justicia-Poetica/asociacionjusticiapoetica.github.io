/**
 * Alta automática de Poetas.
 *
 * Stripe avisa aquí cuando alguien crea una suscripción. Esta función asigna
 * el número de socio, genera el código QR y envía el carnet por correo.
 *
 * Dos cautelas importantes:
 *
 *  - Se verifica la firma de Stripe sobre el cuerpo **en crudo**. Sin eso,
 *    cualquiera podría inventarse altas enviando peticiones a esta dirección.
 *    En Vercel, `req.body` es un getter perezoso que solo analiza el cuerpo si
 *    se accede a él, así que basta con no tocarlo y leer el flujo directamente:
 *    llega intacto, byte a byte, que es lo que exige la firma.
 *  - Se marca en la ficha del cliente que el carnet ya salió. Stripe reintenta
 *    los avisos cuando duda si llegaron, y sin esta marca la misma persona
 *    recibiría el carnet varias veces.
 *
 * Variables de entorno: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, CARNET_SECRET,
 * SITIO_URL y las de correo que ya usa el formulario de ayuda.
 */

import nodemailer from 'nodemailer';
import { NIVELES, urlCarnet, qrPng, stripeCliente } from '../lib/carnet.js';

function cuerpoEnCrudo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

/**
 * Siguiente número de socio.
 *
 * Se calcula recorriendo los clientes y quedándose con el mayor número ya
 * asignado. Es más lento que llevar un contador, pero no hay ningún contador
 * que se pueda corromper ni desincronizar, y con el volumen de la Asociación
 * son unas pocas llamadas.
 *
 * El 001 está reservado a Mario Díez, socio fundador.
 */
async function siguienteNumeroSocio() {
  const stripe = stripeCliente();
  let mayor = 1;
  let pagina = await stripe.customers.list({ limit: 100 });
  let vueltas = 0;

  while (true) {
    for (const c of pagina.data) {
      const n = parseInt(c.metadata?.num_socio, 10);
      if (Number.isFinite(n) && n > mayor) mayor = n;
    }
    if (!pagina.has_more || vueltas++ > 20) break;
    pagina = await stripe.customers.list({
      limit: 100,
      starting_after: pagina.data[pagina.data.length - 1].id
    });
  }
  return String(mayor + 1).padStart(3, '0');
}

function correoHtml({ nombre, nivel, numero, enlace }) {
  const saludo = nombre ? `Hola, ${nombre}` : 'Hola';
  return `<div style="font-family:Georgia,'Times New Roman',serif;color:#171717;max-width:560px;margin:0 auto;padding:8px">
  <p style="font-size:17px;line-height:1.6">${saludo}:</p>
  <p style="font-size:17px;line-height:1.6">Ya eres <strong>${nivel}</strong>, con el número de socio <strong>${numero}</strong>. Esto no es una frase hecha: acabas de poner dinero para que alguien tenga abogado.</p>
  <p style="font-size:17px;line-height:1.6">Este es tu carnet:</p>
  <p style="text-align:center;margin:28px 0">
    <a href="${enlace}" style="background:#124a48;color:#ffffff;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:999px;display:inline-block">Ver mi carnet</a>
  </p>
  <p style="font-size:15px;line-height:1.6;color:#56534d">Ábrelo en el móvil y guárdalo en la pantalla de inicio: lo llevarás siempre encima. La página consulta tu situación cada vez que se abre, así que tu carnet nunca se queda desactualizado.</p>
  <p style="font-size:15px;line-height:1.6;color:#56534d">Enseñándolo en cualquiera de los ocho restaurantes del Grupo Pulcinella en Madrid tienes un 10 % de descuento. Pueden pedirte el DNI.</p>
  <p style="text-align:center;margin:24px 0"><img src="cid:qrpoeta" alt="Código QR de tu carnet" width="200" height="200" style="border-radius:10px"></p>
  <p style="font-size:15px;line-height:1.6;color:#56534d">Cada trimestre te llegará un informe con el estado real de todas las causas de la Asociación. Sin adornos.</p>
  <p style="font-size:17px;line-height:1.6">Gracias por formar parte de esta mágica locura.</p>
  <p style="font-size:17px;line-height:1.6">Mario Díez<br><span style="color:#56534d;font-size:15px">Presidente de la Asociación Justicia Poética</span></p>
  <hr style="border:0;border-top:1px solid #ddd8cc;margin:28px 0">
  <p style="font-size:13px;line-height:1.6;color:#56534d">Puedes cambiar la cantidad, actualizar la tarjeta o darte de baja cuando quieras desde <a href="https://billing.stripe.com/p/login/7sY7sKh1b9BT4gedaH4Ja00" style="color:#124a48">gestionar mi aportación</a>. Sin dar explicaciones.</p>
</div>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Método no permitido');
  }

  let evento;
  try {
    const stripe = stripeCliente();
    const crudo = await cuerpoEnCrudo(req);
    evento = stripe.webhooks.constructEvent(
      crudo,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Aviso de Stripe rechazado:', error && error.message);
    return res.status(400).send('Firma no válida');
  }

  if (evento.type !== 'customer.subscription.created') {
    return res.status(200).json({ ignorado: evento.type });
  }

  try {
    const sub = evento.data.object;
    const producto = sub.items?.data?.[0]?.price?.product;
    const nivel = NIVELES[producto];

    // El donativo puntual no lleva carnet.
    if (!nivel) return res.status(200).json({ ignorado: 'producto sin carnet' });

    const stripe = stripeCliente();
    const cliente = await stripe.customers.retrieve(sub.customer);
    if (!cliente || cliente.deleted) {
      return res.status(200).json({ ignorado: 'cliente inexistente' });
    }

    if (cliente.metadata?.carnet_enviado) {
      return res.status(200).json({ ignorado: 'carnet ya enviado' });
    }
    if (!cliente.email) {
      console.error('Alta sin correo, no se puede enviar el carnet:', cliente.id);
      return res.status(200).json({ ignorado: 'sin correo' });
    }

    const numero = cliente.metadata?.num_socio || await siguienteNumeroSocio();
    const enlace = urlCarnet(cliente.id);
    const qr = await qrPng(enlace);

    const transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporte.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: cliente.email,
      bcc: process.env.MAIL_TO,
      subject: `Tu carnet de ${nivel}, socio n.º ${numero}`,
      html: correoHtml({ nombre: cliente.name, nivel, numero, enlace }),
      text: `Ya eres ${nivel}, con el número de socio ${numero}.\n\nTu carnet: ${enlace}\n\n`
        + `Guárdalo en la pantalla de inicio del móvil. Enseñándolo en los restaurantes del `
        + `Grupo Pulcinella en Madrid tienes un 10 % de descuento.\n\n`
        + `Gracias por formar parte de esta mágica locura.\nMario Díez, presidente.`,
      attachments: [{ filename: 'carnet-justicia-poetica.png', content: qr, cid: 'qrpoeta' }]
    });

    // Solo después de que el correo haya salido: si falla el envío, el reintento
    // de Stripe encontrará al cliente sin marcar y volverá a intentarlo.
    await stripe.customers.update(cliente.id, {
      metadata: {
        num_socio: numero,
        nivel,
        carnet_enviado: new Date().toISOString()
      }
    });

    return res.status(200).json({ enviado: true, numero });
  } catch (error) {
    console.error('Fallo al generar un carnet:', error && error.message);
    // 500 para que Stripe lo reintente.
    return res.status(500).send('Error al generar el carnet');
  }
}
