/** @type {import('tailwindcss').Config} */
// Tema "Césped" — la interfaz se apoya en el material del juego: césped, pintura blanca
// y las dos líneas virtuales de la transmisión (azul = línea de golpeo, amarilla = la línea que importa).
// - `slate` se remapea a verdes de césped nocturno: las clases existentes se re-visten solas.
// - Colores con trabajo fijo: `linea` (amarillo: el umbral de 3.5 s, selección, acción principal),
//   `azul` (línea de golpeo, ofensiva), `peligro` (lo que pasa después de 3.5 s), `pintura`.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#f2f4ee',
          100: '#e3e9e2',
          200: '#c9d4cc',
          300: '#a9bcb1',
          400: '#8aa094',
          500: '#7d9487',
          600: '#5a7566',
          700: '#24443a',
          800: '#1b382d',
          900: '#113024',
          950: '#0c2219',
        },
        pintura: '#f2f4ee',
        linea: { DEFAULT: '#ffd43b', tinta: '#0c2219' },
        azul: '#4a8af4',
        peligro: '#f0525a',
        cesped: { DEFAULT: '#113024', claro: '#143829', noche: '#0c2219' },
      },
      fontFamily: {
        sans: ['Barlow', 'system-ui', '"Segoe UI"', 'sans-serif'],
        cifra: ['"Alfa Slab One"', 'Rockwell', 'Georgia', 'serif'],
      },
      borderRadius: { sm: '2px', DEFAULT: '3px', md: '4px', lg: '6px', xl: '6px', '2xl': '8px', '3xl': '10px' },
      fontSize: { xs: ['13px', '18px'] },
    },
  },
  plugins: [],
}
