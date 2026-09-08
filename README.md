# Lamisatrip

App para organizar viajes con amigos: gastos compartidos, balances, alias/CBU, cierre del viaje y sorteos.

## Stack

- Next.js
- Vercel
- Supabase Cloud para backend
- PWA para instalar en Android desde el navegador

## Desarrollo local

```bash
npm install
npm run dev
```

## Deploy automatico

El proyecto esta preparado para importarse en Vercel desde GitHub. Cada push a `main` dispara un deploy automatico.

## Backend

El esquema inicial esta en `supabase/schema.sql`.

## Pruebas

```bash
npm test
npm run test:supabase
```

`test:supabase` necesita `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` cargadas en el entorno.
