# Web de la Asociación Justicia Poética

Sitio estático, sin framework ni proceso de compilación. Los archivos se sirven
tal cual. Se despliega en Vercel.

Para verlo en local basta con abrir `index.html` en el navegador, o levantar un
servidor sencillo:

```bash
python3 -m http.server 8000
```

## Estructura

```
index.html                Portada
necesito-ayuda.html       Solicitud de ayuda
poetas-guerreros.html     Alta de donantes recurrentes
la-asociacion.html        Quiénes somos, fines, valores, órganos de gobierno
causas.html               Estado de los procedimientos abiertos
caso-kote-cabezudo.html   Caso fundacional
transparencia.html        Documentación y datos de actividad
contacto.html             Canales y sede
gracias.html              Página de retorno tras el pago
aviso-legal.html          Aviso legal
privacidad.html           Política de privacidad
cookies.html              Política de cookies
404.html                  Página de error
assets/css/site.css       Todo el diseño en un único archivo
assets/js/site.js         Menú, salida rápida, validación de formularios
assets/fonts/             Tipografías autoalojadas (Cormorant Garamond y Public Sans)
assets/img/               Logotipo horizontal (verde y blanco), emblema y favicon
```

La cabecera y el pie están duplicados en cada página porque no hay proceso de
compilación. Si se tocan, hay que tocarlos en todas.

## Criterios de diseño

- Un solo tema por página, claro por defecto, con modo oscuro por preferencia
  del sistema.
- Paleta tomada directamente del logotipo: verde profundo `#124a48`, verde de
  fondo `#0c3c36`, dorado `#c69636` y papel hueso `#f2efe9`.
- El dorado nunca se usa para texto pequeño sobre fondo claro, porque no llega a
  contraste. Vive sobre el verde oscuro y en detalles.
- Serif (Cormorant Garamond) en los titulares, para hablar el idioma del
  logotipo. Sans (Public Sans) en texto corrido, botones y formularios, donde
  manda la legibilidad.
- Movimiento mínimo y siempre respetando `prefers-reduced-motion`. Este sitio lo
  visita gente en crisis.
- Botón de salida rápida y aviso sobre el historial en la página de solicitud de
  ayuda.
- Tipografías autoalojadas y sin cookies: la simple visita no comunica nada a
  servidores de terceros. Si algún día se añade analítica, hay que actualizar
  `cookies.html` y poner un banner con rechazo tan accesible como la aceptación.

## Accesibilidad

Verificado sobre las trece páginas, a 1280 y 375 píxeles de ancho, en tema claro
y oscuro: sin desbordamiento horizontal, sin saltos en la jerarquía de
encabezados, sin enlaces ni anclas rotas y sin ningún texto por debajo del
contraste AA.

## Notas internas

El estado de las causas, la lista de tareas pendientes y el contexto del
proyecto están en `CLAUDE.md`, que no forma parte de este repositorio.
