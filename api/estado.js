/**
 * Diagnóstico de configuración.
 *
 * Dice qué variables de entorno han llegado a la función y cuáles no.
 * **Nunca devuelve valores**, solo si están definidas y su longitud, que basta
 * para detectar el error clásico de pegar una clave a medias o con espacios.
 *
 * Existe para no tener que adivinar por qué falla algo tras un despliegue.
 * Se puede borrar cuando el proyecto esté asentado.
 */

const ESPERADAS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'CARNET_SECRET',
  'CRON_SECRET',
  'SITIO_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'MAIL_TO',
  'MAIL_FROM'
];

/** Canales de aviso. Son opcionales: si faltan, no se avisa de los fallos. */
const OPCIONALES = [
  'TELEGRAM_TOKEN',
  'TELEGRAM_CHAT_ID',
  'ALERTA_WEBHOOK',
  'ALERTA_SMTP_HOST',
  'ALERTA_MAIL_TO'
];

export default async function handler(req, res) {
  const variables = {};
  for (const nombre of [...ESPERADAS, ...OPCIONALES]) {
    const v = process.env[nombre];
    variables[nombre] = v == null || v === ''
      ? (OPCIONALES.includes(nombre) ? 'sin configurar (opcional)' : 'AUSENTE')
      : `presente (${v.length} caracteres${v !== v.trim() ? ', OJO: tiene espacios al principio o al final' : ''})`;
  }

  // Prefijo esperado de las claves de Stripe, para detectar que se haya pegado
  // la clave equivocada en el campo equivocado.
  const pistas = {};
  if (process.env.STRIPE_SECRET_KEY) {
    pistas.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY.startsWith('sk_')
      ? 'empieza por sk_, correcto' : 'NO empieza por sk_, revisa qué se pegó ahí';
  }
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    pistas.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')
      ? 'empieza por whsec_, correcto' : 'NO empieza por whsec_, revisa qué se pegó ahí';
  }

  // TEMPORAL: dispara un aviso de prueba para comprobar que el canal llega.
  // Quitar en cuanto esté verificado: deja que cualquiera provoque una
  // notificación, aunque el freno de quince minutos limite el ruido.
  let aviso = 'no disparado (añade ?aviso=1)';
  if (req.query.aviso) {
    try {
      const { avisarDeFallo } = await import('../lib/alerta.js');
      const canales = await avisarDeFallo(
        'PRUEBA del canal de avisos',
        { donde: 'comprobación manual', codigo: 'ninguno' },
        'Esto es una prueba. No ha fallado nada y no hay nadie esperando.\nSi lees esto, el aviso funciona.'
      );
      aviso = canales.length ? `enviado por: ${canales.join(', ')}` : 'ningún canal configurado';
    } catch (e) {
      aviso = `FALLA :: ${e && e.message}`;
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    aviso,
    entorno: process.env.VERCEL_ENV || 'desconocido',
    region: process.env.VERCEL_REGION || 'desconocida',
    variables,
    pistas
  });
}
