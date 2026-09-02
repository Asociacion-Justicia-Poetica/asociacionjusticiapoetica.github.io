/**
 * Recepción del formulario de solicitud de ayuda.
 *
 * Esta función se ejecuta en Fráncfort (configurado en vercel.json) y su único
 * cometido es convertir el formulario en un correo y enviarlo. Deliberadamente:
 *
 *   - No guarda nada. Ni base de datos, ni archivo, ni caché.
 *   - No escribe el contenido del formulario en los registros. Si algo falla,
 *     se registra el fallo, nunca lo que la persona ha contado.
 *   - No llama a ningún servicio de terceros salvo el servidor de correo.
 *
 * Son datos de categoría especial del RGPD (vida sexual, salud, infracciones
 * penales). Cuanto menos toquemos, mejor.
 *
 * Variables de entorno necesarias, configuradas en Vercel:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM
 */

import nodemailer from 'nodemailer';

const CAMPOS_OBLIGATORIOS = ['via', 'contacto', 'tipo', 'provincia', 'relato', 'privacidad'];

const ETIQUETAS = {
  via: 'Vía de contacto preferida',
  contacto: 'Teléfono o correo',
  franja: 'Cuándo es seguro llamar',
  nombre: 'Nombre',
  tipo: 'Tipo de situación',
  provincia: 'Provincia',
  menor: 'La persona afectada es menor de edad',
  procedimiento: 'Ya hay procedimiento judicial abierto',
  tercero: 'Escribe en nombre de otra persona',
  relato: 'Relato'
};

const TIPOS = {
  'delito-sexual': 'Delito sexual contra una mujer o una menor',
  'menor-tutelado': 'Menor desprotegido bajo tutela de la Administración',
  'denuncia-falsa': 'Denuncia falsa de naturaleza sexual',
  'corrupcion': 'Corrupción institucional o abuso de poder',
  'irregularidad-judicial': 'Irregularidad en un procedimiento judicial',
  'otro': 'Otra cosa'
};

const FRANJAS = {
  'manana': 'Por la mañana',
  'tarde': 'Por la tarde',
  'solo-mensaje': 'Prefiere que no le llamen, mejor escribir'
};

function texto(v) {
  return String(v == null ? '' : v).trim();
}

function escapar(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Página de error servida por la propia función.
 * Se devuelve HTML en vez de redirigir con un parámetro porque un error tiene
 * que verse siempre, también sin JavaScript. Decirle a alguien que su mensaje
 * ha llegado cuando no ha llegado es el peor fallo posible en esta página.
 */
function paginaDeError(res, titular, explicacion, relato) {
  // Si el envío falla, lo que la persona escribió se perdería y tendría que
  // volver a contarlo entero. Se lo devolvemos para que pueda copiarlo y
  // mandárnoslo por otra vía. No se guarda en ninguna parte: es el mismo texto
  // que acaba de mandar, devuelto por la misma conexión y a la misma persona.
  const recuperado = texto(relato) ? `
      <div style="margin-top:2rem">
        <h2 style="font-size:1.15rem">Lo que habías escrito</h2>
        <p class="small muted">No lo hemos perdido: cópialo de aquí y mándanoslo por WhatsApp o por correo. No hace falta que lo escribas otra vez.</p>
        <textarea readonly rows="10" style="width:100%" aria-label="El texto que habías escrito">${escapar(relato)}</textarea>
      </div>` : '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Contiene lo que la persona ha contado: que no quede en ninguna caché.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>No hemos podido recibir tu mensaje | Asociación Justicia Poética</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/img/favicon-32.png" sizes="32x32">
<link rel="stylesheet" href="/assets/css/site.css">
</head>
<body>
<main id="contenido">
  <section>
    <div class="wrap wrap-narrow">
      <h1>${titular}</h1>
      <p class="lede">${explicacion}</p>
      <div class="form-note" style="margin-top:2rem">
        <p><strong>No lo dejes aquí.</strong> Estos canales funcionan y los atendemos igual.</p>
        <p style="margin-bottom:0">WhatsApp <a href="https://wa.me/34608141625" rel="noopener">608 14 16 25</a><br>
        Correo <a href="mailto:asociacionjusticiapoetica@gmail.com">asociacionjusticiapoetica@gmail.com</a></p>
      </div>
      ${recuperado}
      <div class="btn-row" style="margin-top:2rem">
        <a class="btn btn-primary" href="/necesito-ayuda.html">Volver al formulario</a>
      </div>
    </div>
  </section>
</main>
<button class="exit-bar" type="button" data-exit aria-label="Salir de esta página inmediatamente">Salir</button>
<script src="/assets/js/site.js" defer></script>
</body>
</html>`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Método no permitido');
  }

  const datos = req.body || {};

  // Trampa para robots: es un campo invisible que una persona nunca rellena.
  // Si viene lleno, respondemos como si todo hubiera ido bien y no enviamos nada.
  if (texto(datos.web)) {
    return res.redirect(303, '/solicitud-recibida.html');
  }

  const faltan = CAMPOS_OBLIGATORIOS.filter((c) => !texto(datos[c]));
  if (faltan.length) {
    return paginaDeError(
      res,
      'Faltaba algo por rellenar',
      'No hemos podido dar por recibida tu solicitud porque quedaban campos obligatorios sin completar. Vuelve atrás y revísalos.',
      datos.relato
    );
  }

  const linea = (clave, valor) => (valor ? `${ETIQUETAS[clave] || clave}: ${valor}\n` : '');

  let cuerpo = 'Nueva solicitud de ayuda recibida desde justiciapoetica.org\n';
  cuerpo += '='.repeat(62) + '\n\n';
  cuerpo += linea('nombre', texto(datos.nombre) || 'No lo ha indicado');
  cuerpo += linea('via', texto(datos.via));
  cuerpo += linea('contacto', texto(datos.contacto));
  cuerpo += linea('franja', FRANJAS[texto(datos.franja)] || 'Cualquier momento');
  cuerpo += '\n';
  cuerpo += linea('tipo', TIPOS[texto(datos.tipo)] || texto(datos.tipo));
  cuerpo += linea('provincia', texto(datos.provincia));
  if (texto(datos.menor)) cuerpo += 'AFECTA A UNA PERSONA MENOR DE EDAD\n';
  if (texto(datos.procedimiento)) cuerpo += 'Ya hay denuncia o procedimiento judicial abierto\n';
  if (texto(datos.tercero)) cuerpo += 'Escribe en nombre de otra persona\n';
  cuerpo += '\n' + '-'.repeat(62) + '\n\n';
  cuerpo += texto(datos.relato) + '\n\n';
  cuerpo += '-'.repeat(62) + '\n';
  cuerpo += 'Ha aceptado la política de privacidad.\n';
  cuerpo += 'Recibido el ' + new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) + '.\n';
  cuerpo += 'Comprometido un plazo de respuesta de 72 horas laborables.\n';

  const urgente = texto(datos.menor) ? '[MENOR] ' : '';
  const asunto = `${urgente}Solicitud de ayuda: ${TIPOS[texto(datos.tipo)] || 'sin clasificar'} (${texto(datos.provincia)})`;

  try {
    const transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporte.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: process.env.MAIL_TO,
      subject: asunto,
      text: cuerpo,
      // Si la persona ha dejado un correo, responder desde el gestor de correo
      // la contesta directamente a ella.
      replyTo: texto(datos.contacto).includes('@') ? texto(datos.contacto) : undefined
    });

    return res.redirect(303, '/solicitud-recibida.html');
  } catch (error) {
    // Solo el motivo del fallo. Nunca el contenido del formulario.
    console.error('Fallo al enviar una solicitud de ayuda:',
      error && error.code, error && error.responseCode, error && error.message);
    return paginaDeError(
      res,
      'No hemos podido recibir tu mensaje',
      'Ha fallado algo por nuestra parte, no por la tuya. Tu mensaje no nos ha llegado, así que por favor no des por hecho que lo hemos leído.',
      datos.relato
    );
  }
}
