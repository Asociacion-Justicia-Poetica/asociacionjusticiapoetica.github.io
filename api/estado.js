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

export default function handler(req, res) {
  const variables = {};
  for (const nombre of ESPERADAS) {
    const v = process.env[nombre];
    variables[nombre] = v == null || v === ''
      ? 'AUSENTE'
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

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    entorno: process.env.VERCEL_ENV || 'desconocido',
    region: process.env.VERCEL_REGION || 'desconocida',
    variables,
    pistas
  });
}
