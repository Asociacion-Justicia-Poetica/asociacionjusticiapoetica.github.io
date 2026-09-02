/**
 * Alta automática de Poetas.
 *
 * Stripe avisa aquí de dos cosas distintas:
 *
 *  - `customer.subscription.created`: alguien se hace Poeta recurrente.
 *    Carnet sin fecha de caducidad, vigente mientras siga aportando.
 *  - `checkout.session.completed` en modo pago: alguien hace un donativo
 *    puntual. Se le da carnet de Poeta Guerrero por el tiempo equivalente,
 *    a razón de 10 € por mes. Cien euros son diez meses. Es el criterio que
 *    la Asociación ya venía aplicando a mano.
 *
 * Dos cautelas importantes:
 *
 *  - Se verifica la firma de Stripe sobre el cuerpo **en crudo**. Sin eso,
 *    cualquiera podría inventarse altas enviando peticiones a esta dirección.
 *    En Vercel, `req.body` es un getter perezoso que solo analiza el cuerpo si
 *    se accede a él, así que basta con no tocarlo y leer el flujo directamente:
 *    llega intacto, byte a byte, que es lo que exige la firma.
 *  - Se deja marcado en la ficha lo ya procesado. Stripe reintenta los avisos
 *    cuando duda si llegaron, y sin esa marca la misma persona recibiría el
 *    carnet varias veces.
 *
 * Variables de entorno: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, CARNET_SECRET,
 * SITIO_URL y las de correo que ya usa el formulario de ayuda.
 */

import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { urlCarnet, qrPng, stripeCliente, nivelDeSuscripcion } from '../lib/carnet.js';
import { avisarDeFallo } from '../lib/alerta.js';

/** Producto del donativo de una sola vez. */
const PRODUCTO_DONATIVO = 'prod_V6oHqsbvZ3zwL3';

/** Euros que equivalen a un mes de carnet en un donativo puntual. */
const EUROS_POR_MES = 10;

/** Tope de vigencia de un carnet ganado con donativos puntuales. */
const MESES_MAXIMOS = 12;

/**
 * Producto inactivo que guarda la correspondencia entre los donantes de la
 * plataforma antigua y su número de socio histórico. Los correos están
 * cifrados: la metadata no permite saber quién es quién.
 */
const PRODUCTO_NUMEROS_HEREDADOS = 'prod_V73yfE6WgHv3zo';

function cuerpoEnCrudo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

/**
 * Número que esta persona ya tenía en la plataforma antigua, si lo tenía.
 *
 * Quien lleva donando desde 2023 con el número 5 conserva el 5. El número de
 * socio es antigüedad, y perderla al migrar sería un agravio gratuito hacia
 * quienes más tiempo llevan sosteniendo esto.
 */
async function numeroHeredado(correo) {
  if (!correo) return null;
  try {
    const stripe = stripeCliente();
    const producto = await stripe.products.retrieve(PRODUCTO_NUMEROS_HEREDADOS);
    const buscado = crypto.createHash('sha256')
      .update(String(correo).trim().toLowerCase()).digest('hex').slice(0, 16);

    for (const [clave, valor] of Object.entries(producto.metadata || {})) {
      if (!clave.startsWith('mapa_')) continue;
      for (const par of String(valor).split(',')) {
        const [h, numero] = par.split(':');
        if (h === buscado && numero) return String(numero).padStart(3, '0');
      }
    }
  } catch (error) {
    // Que falle esto no puede impedir que alguien reciba su carnet.
    console.error('No se pudo consultar el número heredado:', error && error.message);
  }
  return null;
}

/**
 * Siguiente número de socio.
 *
 * Se calcula recorriendo los clientes y quedándose con el mayor número ya
 * asignado. Es más lento que llevar un contador, pero no hay ningún contador
 * que se pueda corromper ni desincronizar, y con el volumen de la Asociación
 * son unas pocas llamadas.
 */
/**
 * El número más alto reservado a la plataforma antigua.
 *
 * Hace falta porque los números heredados llegan más lejos que los ya emitidos:
 * mientras queden donantes sin migrar, sus números existen en el mapa pero no
 * en Stripe. Sin esta comprobación, un alta nueva recibiría un número que
 * pertenece a alguien que todavía no ha dado el paso, y al migrar habría dos
 * personas con el mismo número.
 */
async function mayorNumeroReservado() {
  try {
    const stripe = stripeCliente();
    const producto = await stripe.products.retrieve(PRODUCTO_NUMEROS_HEREDADOS);
    let mayor = 0;
    for (const [clave, valor] of Object.entries(producto.metadata || {})) {
      if (!clave.startsWith('mapa_')) continue;
      for (const par of String(valor).split(',')) {
        const n = parseInt(String(par).split(':')[1], 10);
        if (Number.isFinite(n) && n > mayor) mayor = n;
      }
    }
    return mayor;
  } catch (error) {
    // Si esto falla se sigue adelante, pero conviene saberlo: el riesgo es
    // repetir un número.
    console.error('No se pudo leer el tope de números heredados:', error && error.message);
    return 0;
  }
}

async function siguienteNumeroSocio() {
  const stripe = stripeCliente();
  let mayor = await mayorNumeroReservado();
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

async function numeroPara(cliente) {
  if (cliente.metadata?.num_socio) return { numero: cliente.metadata.num_socio, heredado: false };
  const h = await numeroHeredado(cliente.email);
  if (h) return { numero: h, heredado: true };
  return { numero: await siguienteNumeroSocio(), heredado: false };
}

function enEspanol(fecha) {
  return fecha.toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid'
  });
}

function correoHtml({ nombre, nivel, numero, enlace, hasta, meses, importe }) {
  const saludo = nombre ? `Hola, ${nombre}` : 'Hola';

  const apertura = hasta
    ? `<p style="font-size:17px;line-height:1.6">Gracias por tu donativo de <strong>${importe}</strong>. Con él eres <strong>${nivel}</strong>, con el número de socio <strong>${numero}</strong>, y tu carnet está vigente <strong>hasta el ${hasta}</strong>.</p>
  <p style="font-size:15px;line-height:1.6;color:#56534d">Contamos cada 10 euros donados como un mes de Poeta Guerrero, así que tu donativo son ${meses} ${meses === 1 ? 'mes' : 'meses'} de carnet con todas sus ventajas.</p>`
    : `<p style="font-size:17px;line-height:1.6">Ya eres <strong>${nivel}</strong>, con el número de socio <strong>${numero}</strong>. Esto no es una frase hecha: acabas de poner dinero para que alguien tenga abogado.</p>`;

  return `<div style="font-family:Georgia,'Times New Roman',serif;color:#171717;max-width:560px;margin:0 auto;padding:8px">
  <p style="font-size:17px;line-height:1.6">${saludo}:</p>
  ${apertura}
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
  <p style="font-size:13px;line-height:1.6;color:#56534d"><strong>¿Has encontrado este correo en spam?</strong> Márcalo como «no es spam» y añade nuestra dirección a tus contactos. Así te llegarán bien el informe trimestral y los avisos de tu carnet.</p>
  <p style="font-size:13px;line-height:1.6;color:#56534d">Puedes gestionar tu aportación desde <a href="https://billing.stripe.com/p/login/7sY7sKh1b9BT4gedaH4Ja00" style="color:#124a48">este enlace</a>.</p>
</div>`;
}

async function enviarCarnet({ cliente, nivel, numero, hasta, meses, importe }) {
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
    subject: hasta
      ? `Tu carnet de ${nivel}, vigente hasta el ${hasta}`
      : `Tu carnet de ${nivel}, socio n.º ${numero}`,
    html: correoHtml({ nombre: cliente.name, nivel, numero, enlace, hasta, meses, importe }),
    text: `Ya eres ${nivel}, con el número de socio ${numero}.`
      + (hasta ? ` Tu carnet está vigente hasta el ${hasta}.` : '')
      + `\n\nTu carnet: ${enlace}\n\nGracias por formar parte de esta mágica locura.\nMario Díez, presidente.`,
    attachments: [{ filename: 'carnet-justicia-poetica.png', content: qr, cid: 'qrpoeta' }]
  });
}

/** Alta recurrente: Poeta de la Justicia o Poeta Guerrero, sin caducidad. */
async function altaRecurrente(evento) {
  const stripe = stripeCliente();
  const sub = evento.data.object;
  const calculo = nivelDeSuscripcion(sub);
  if (!calculo) return { ignorado: 'producto sin carnet' };
  const { nivel, centimos } = calculo;

  const cliente = await stripe.customers.retrieve(sub.customer);
  if (!cliente || cliente.deleted) return { ignorado: 'cliente inexistente' };
  if (cliente.metadata?.carnet_enviado && !cliente.metadata?.carnet_hasta) {
    return { ignorado: 'carnet ya enviado' };
  }
  if (!cliente.email) {
    console.error('Alta sin correo, no se puede enviar el carnet:', cliente.id);
    return { ignorado: 'sin correo' };
  }

  const { numero, heredado } = await numeroPara(cliente);
  await enviarCarnet({ cliente, nivel, numero });

  // Solo después de que el correo haya salido: si falla el envío, el reintento
  // de Stripe encontrará al cliente sin marcar y volverá a intentarlo.
  // Se limpia carnet_hasta: una aportación mensual no caduca.
  await stripe.customers.update(cliente.id, {
    metadata: {
      num_socio: numero,
      nivel,
      centimos_mes: String(centimos),
      carnet_hasta: '',
      carnet_enviado: new Date().toISOString(),
      procedencia: heredado ? 'migracion-givewp' : 'alta-nueva'
    }
  });
  return { enviado: true, numero, nivel };
}

/**
 * Donativo puntual: carnet de Poeta Guerrero por el tiempo equivalente.
 *
 * Si la persona ya tenía carnet vigente, los meses **se suman a lo que le
 * quedaba**, no lo sustituyen. Quien dona por segunda vez antes de agotar su
 * carnet no debe salir perdiendo por haberse adelantado.
 */
async function donativoPuntual(evento) {
  const stripe = stripeCliente();
  const sesion = evento.data.object;

  if (sesion.mode !== 'payment') return { ignorado: 'no es un pago único' };
  if (sesion.payment_status !== 'paid') return { ignorado: 'aún no cobrado' };
  if (!sesion.customer) return { ignorado: 'sin ficha de cliente' };

  const lineas = await stripe.checkout.sessions.listLineItems(sesion.id, { limit: 5 });
  const esDonativo = lineas.data.some((l) => l.price?.product === PRODUCTO_DONATIVO);
  if (!esDonativo) return { ignorado: 'producto sin carnet' };

  const mesesBrutos = Math.floor((sesion.amount_total || 0) / (EUROS_POR_MES * 100));
  if (mesesBrutos < 1) return { ignorado: 'donativo inferior a un mes de carnet' };

  const cliente = await stripe.customers.retrieve(sesion.customer);
  if (!cliente || cliente.deleted) return { ignorado: 'cliente inexistente' };
  if (cliente.metadata?.ultima_sesion === sesion.id) return { ignorado: 'donativo ya procesado' };
  if (!cliente.email) {
    console.error('Donativo sin correo, no se puede enviar el carnet:', cliente.id);
    return { ignorado: 'sin correo' };
  }

  // Se parte de lo que le quedara de vigencia, no de hoy: quien dona por
  // segunda vez antes de agotar el carnet no debe perder lo que le quedaba.
  const ahora = new Date();
  const previo = cliente.metadata?.carnet_hasta ? new Date(cliente.metadata.carnet_hasta) : null;
  const desde = previo && previo > ahora ? previo : ahora;
  const fin = new Date(desde);
  fin.setMonth(fin.getMonth() + mesesBrutos);

  // Tope de un año contado desde hoy. Un donativo de 500 € daría cincuenta
  // meses de carnet, y ni el donante ni la Asociación ganan nada con eso.
  const tope = new Date(ahora);
  tope.setMonth(tope.getMonth() + MESES_MAXIMOS);
  if (fin > tope) fin.setTime(tope.getTime());

  const meses = Math.max(1, Math.round((fin - ahora) / (30.44 * 24 * 3600 * 1000)));

  const { numero, heredado } = await numeroPara(cliente);
  const nivel = 'Poeta Guerrero';
  const importe = ((sesion.amount_total || 0) / 100).toLocaleString('es-ES', {
    style: 'currency', currency: (sesion.currency || 'eur').toUpperCase()
  });

  await enviarCarnet({ cliente, nivel, numero, hasta: enEspanol(fin), meses, importe });

  await stripe.customers.update(cliente.id, {
    metadata: {
      num_socio: numero,
      nivel,
      carnet_hasta: fin.toISOString(),
      carnet_enviado: new Date().toISOString(),
      ultima_sesion: sesion.id,
      procedencia: heredado ? 'migracion-givewp' : 'donativo-puntual'
    }
  });
  return { enviado: true, numero, meses, hasta: fin.toISOString().slice(0, 10) };
}

/**
 * Alguien ha cambiado su aportación desde el portal.
 *
 * El portal permite multiplicar la aportación: dos, tres o siete veces lo que
 * se puso al principio. Como el nivel lo decide el importe, multiplicar puede
 * convertir a un Poeta de la Justicia en Poeta Guerrero, y eso hay que
 * reconocerlo en el momento y no dejar que lo descubra por su cuenta.
 *
 * Solo se escribe cuando la aportación **sube**. Una bajada se registra en
 * silencio: nadie quiere recibir un correo que le recuerde que da menos.
 */
async function cambioDeAportacion(evento) {
  const stripe = stripeCliente();
  const sub = evento.data.object;
  if (sub.status !== 'active' && sub.status !== 'trialing') {
    return { ignorado: 'suscripción no activa' };
  }

  const calculo = nivelDeSuscripcion(sub);
  if (!calculo) return { ignorado: 'producto sin carnet' };

  const cliente = await stripe.customers.retrieve(sub.customer);
  if (!cliente || cliente.deleted) return { ignorado: 'cliente inexistente' };

  const previos = parseInt(cliente.metadata?.centimos_mes, 10);
  const nivelPrevio = cliente.metadata?.nivel;
  const subida = Number.isFinite(previos) && calculo.centimos > previos;
  const cambioNivel = nivelPrevio && nivelPrevio !== calculo.nivel;

  if (!subida && !cambioNivel) return { ignorado: 'sin cambios que reconocer' };

  // La ficha se actualiza siempre: el carnet debe decir la verdad aunque no
  // haya correo de por medio.
  await stripe.customers.update(cliente.id, {
    metadata: { nivel: calculo.nivel, centimos_mes: String(calculo.centimos) }
  });

  if (!subida || !cliente.email) return { actualizado: true, nivel: calculo.nivel };

  const importe = (calculo.centimos / 100).toLocaleString('es-ES', {
    style: 'currency', currency: 'EUR'
  });
  const asciende = cambioNivel && calculo.nivel === 'Poeta Guerrero';

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
    subject: asciende
      ? 'Ya eres Poeta Guerrero'
      : `Gracias: tu aportación pasa a ${importe} al mes`,
    html: `<div style="font-family:Georgia,'Times New Roman',serif;color:#171717;max-width:560px;margin:0 auto;padding:8px">
  <p style="font-size:17px;line-height:1.6">${cliente.name ? `Hola, ${cliente.name}` : 'Hola'}:</p>
  ${asciende
    ? `<p style="font-size:17px;line-height:1.6">Acabas de subir tu aportación a <strong>${importe} al mes</strong>, y con eso pasas a ser <strong>Poeta Guerrero</strong>.</p>
  <p style="font-size:17px;line-height:1.6">Tu carnet ya lo dice: no tienes que hacer nada, y con él tienes el 10 % de descuento en los restaurantes del Grupo Pulcinella y la consulta jurídica al 50 % a partir de seis meses.</p>`
    : `<p style="font-size:17px;line-height:1.6">Acabas de subir tu aportación a <strong>${importe} al mes</strong>. Gracias.</p>
  <p style="font-size:17px;line-height:1.6">No es un trámite: ese aumento es tiempo de abogado para alguien que no puede pagarlo.</p>`}
  <p style="text-align:center;margin:28px 0">
    <a href="${urlCarnet(cliente.id)}" style="background:#124a48;color:#ffffff;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:999px;display:inline-block">Ver mi carnet</a>
  </p>
  <p style="font-size:17px;line-height:1.6">Mario Díez<br><span style="color:#56534d;font-size:15px">Presidente de la Asociación Justicia Poética</span></p>
</div>`,
    text: `Tu aportación pasa a ${importe} al mes.`
      + (asciende ? ' Con eso eres Poeta Guerrero.' : '')
      + `\n\nTu carnet: ${urlCarnet(cliente.id)}\n\nGracias.\nMario Díez, presidente.`
  });

  return { avisado: true, nivel: calculo.nivel, importe };
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

  try {
    if (evento.type === 'customer.subscription.created') {
      return res.status(200).json(await altaRecurrente(evento));
    }
    if (evento.type === 'checkout.session.completed') {
      return res.status(200).json(await donativoPuntual(evento));
    }
    if (evento.type === 'customer.subscription.updated') {
      return res.status(200).json(await cambioDeAportacion(evento));
    }
    return res.status(200).json({ ignorado: evento.type });
  } catch (error) {
    console.error('Fallo al generar un carnet:', error && error.message);
    // Stripe reintenta, así que un fallo pasajero se arregla solo. Pero si es
    // el correo el que está roto, el carnet no llega y nadie se entera: por
    // eso se avisa también aquí. Sin datos del Poeta.
    await avisarDeFallo('No se ha podido enviar un carnet de Poeta', {
      donde: '/api/stripe-webhook',
      codigo: error && error.code,
      motivo: error && error.message
    });
    // 500 para que Stripe lo reintente.
    return res.status(500).send('Error al generar el carnet');
  }
}
