# ¿Se paga aquí? · SER Madrid

**https://matmat202.github.io/madrid-ser/**

Una web para el móvil: con tu ubicación, dice qué plazas SER hay a menos de 50 m (verde, azul,
alta rotación, naranja, roja), si se paga ahora mismo, el tiempo máximo y hasta cuándo puedes
quedarte, contando festivos de Madrid. En el distrito Centro añade la norma de su Zona de Bajas
Emisiones de Especial Protección: sin estar empadronado, un coche con etiqueta B o C no puede
aparcar en el SER, solo en un aparcamiento. Debajo, los tres aparcamientos municipales más cercanos.
La posición no sale del teléfono.

A phone page for Madrid's regulated street parking (SER): whether you pay at the spot you are
standing on, until when, and the nearest city car park.

## Datos

Portal de datos abiertos del Ayuntamiento de Madrid (CC BY 4.0): *SER. Calles y número de
plazas*, *SER. Parquímetros*, *Aparcamientos públicos municipales* y *Calendario laboral*.

## Pruebas

`node test.mjs` ejecuta la batería contra `ser.js` y `data.json`; `node test.mjs --plants`
comprueba además que cada fallo sembrado la pone en rojo.
