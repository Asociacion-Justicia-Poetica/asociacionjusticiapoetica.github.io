/**
 * El carnet vivo, y a la vez la página de verificación.
 *
 * Es la misma dirección para las dos cosas: el Poeta la guarda en su móvil y
 * quien le atiende en un restaurante escanea el código y ve esta misma página.
 * Consulta el estado en Stripe en cada visita, así que cuando alguien se da de
 * baja su carnet deja de valer solo, sin que nadie tenga que hacer nada.
 *
 * No muestra correo, ni importe, ni antigüedad: solo nombre, nivel y si está
 * al corriente. Lo justo para acreditar la condición de Poeta.
 */

import { NIVELES, firmaValida, urlCarnet, qrDataUri, paginaCarnet, stripeCliente, SITIO } from '../lib/carnet.js';

function respuestaSimple(res, titulo, texto) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} | Asociación Justicia Poética</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="${SITIO}/assets/css/site.css"></head>
<body><main><section><div class="wrap wrap-narrow">
<h1>${titulo}</h1><p class="lede">${texto}</p>
</div></section></main></body></html>`);
}

export default async function handler(req, res) {
  // Todo dentro del try, incluida la comprobación de la firma: si falta alguna
  // variable de entorno lanza, y sin esto sería un 500 sin explicación.
  try {
    const idCliente = String(req.query.c || '');
    const s = String(req.query.s || '');

    if (!idCliente || !firmaValida(idCliente, s)) {
      return respuestaSimple(res, 'Carnet no encontrado',
        'Esta dirección no corresponde a ningún carnet. Comprueba el enlace que recibiste por correo.');
    }

    const stripe = stripeCliente();
    const cliente = await stripe.customers.retrieve(idCliente);
    if (!cliente || cliente.deleted) {
      return respuestaSimple(res, 'Carnet no encontrado', 'Este carnet ya no existe.');
    }

    // Todas las suscripciones del cliente, para quedarnos con la de más nivel
    // que esté al corriente.
    const subs = await stripe.subscriptions.list({
      customer: idCliente,
      status: 'all',
      limit: 20,
      expand: ['data.items.data.price']
    });

    const AL_CORRIENTE = new Set(['active', 'trialing', 'past_due']);
    let nivel = null;
    let activo = false;
    let motivo = 'Este carnet no da derecho a las ventajas de Poeta.';

    for (const sub of subs.data) {
      const producto = sub.items?.data?.[0]?.price?.product;
      const nombreNivel = NIVELES[producto];
      if (!nombreNivel) continue;

      if (AL_CORRIENTE.has(sub.status)) {
        // Poeta Guerrero manda sobre Poeta de la Justicia si tuviera las dos.
        if (!activo || nombreNivel === 'Poeta Guerrero') nivel = nombreNivel;
        activo = true;
        if (sub.status === 'past_due') motivo = 'Hay un recibo pendiente de cobro.';
      } else if (!nivel) {
        nivel = nombreNivel;
        motivo = sub.status === 'canceled'
          ? 'Esta aportación está cancelada.'
          : 'Esta aportación no está al corriente.';
      }
    }

    if (!nivel) {
      return respuestaSimple(res, 'Carnet no encontrado',
        'No consta ninguna aportación asociada a este carnet.');
    }

    const qr = await qrDataUri(urlCarnet(idCliente));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Sin caché: el sentido de esta página es decir la verdad ahora mismo.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).send(paginaCarnet({
      nombre: cliente.name || cliente.email || 'Poeta',
      nivel,
      numero: cliente.metadata?.num_socio || '—',
      qr,
      activo,
      motivo
    }));
  } catch (error) {
    console.error('Error al mostrar un carnet:', error && error.message);
    return respuestaSimple(res, 'No hemos podido comprobar el carnet',
      'Ha fallado algo por nuestra parte. Inténtalo de nuevo en un momento.');
  }
}
