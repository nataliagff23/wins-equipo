# CLAUDE.md — Wins Equipo (Imperians Agency)

## Descripción General

Aplicación web SPA para **Imperians Agency** que permite al equipo registrar logros ("wins"), gestionar retos/desafíos, y hacer seguimiento del progreso mensual hacia una meta de victorias.

---

## Arquitectura

### Tipo de Proyecto
- **Single HTML file** — toda la app vive en `WinsEquipo.html` (CSS + JS + HTML)
- **React 18** cargado vía CDN (UMD build, sin bundler)
- **Babel Standalone** para transpilación JSX en el navegador
- **Sin build process** — se abre directamente en el navegador o se despliega como archivo estático

### Despliegue
- **Plataforma:** Vercel
- **Config:** `vercel.json` redirige todo a `/WinsEquipo.html`
- **Dev local:** abrir `WinsEquipo.html` directo en el navegador (requiere internet para CDNs y Airtable)

---

## Backend — Airtable

```javascript
const AT = {
  token: "patE3pKIZVZjdmNFC...",   // Personal Access Token
  baseId: "appT08Cl4u2lVE1Td",
  wins: "WinsBoard",
  retos: "RetosBoard"
};
```

### Tablas Airtable

**WinsBoard** — Campos:
| Campo       | Descripción                    |
|-------------|-------------------------------|
| WIN         | Descripción del logro          |
| Categoria   | Categoría del win              |
| Responsable | Miembro del equipo             |
| Cliente     | Nombre del cliente             |
| Fecha       | Fecha formateada (DD MMM YYYY) |
| DesdReto    | Boolean — viene de un reto     |
| Mes         | Número de mes (0–11)           |
| Anio        | Año completo                   |

**RetosBoard** — Campos:
| Campo       | Descripción                          |
|-------------|-------------------------------------|
| Descripcion | Descripción del reto                 |
| Autor       | Quién lo creó                        |
| Tipo        | Tipo de reto                         |
| Fecha       | Fecha formateada                     |
| Resuelto    | Boolean — si fue resuelto            |
| Resolucion  | Notas sobre cómo se resolvió         |
| ResueltoPor | Miembro que resolvió el reto         |

### Funciones API
- `atGetAll(table)` — GET con paginación (offset automático)
- `atCreate(table, fields)` — POST para crear registro
- `atUpdate(table, id, fields)` — PATCH para actualizar registro

---

## Modelos de Datos

### Win
```javascript
{
  _id: string,         // Airtable record ID
  description: string, // Texto del logro
  category: string,    // Categoría
  author: string,      // Nombre del responsable
  client: string,      // Nombre del cliente
  date: string,        // "DD MMM YYYY"
  fromChallenge: bool, // Viene de un reto resuelto
  month: number,       // 0-11
  year: number
}
```

### Challenge (Reto)
```javascript
{
  _id: string,
  description: string,
  author: string,
  week: string,        // Tipo de reto
  date: string,
  solved: boolean,
  resolucion: string,  // Cómo se resolvió
  resueltoPor: string  // Quién lo resolvió
}
```

---

## Funcionalidades Principales

### 1. Wins Board
- Crear, ver y editar wins
- Filtrar por mes actual automáticamente
- 10 categorías: "Campaña exitosa", "Retención", "Reconocimiento", "Mejora de proceso", "Ahorro", "Comunicación", "Aprendizaje", "Colaboración", "Satisfacción cliente", "Otro"
- Efecto confetti al crear un win
- Descargar wins del mes en CSV

### 2. Retos (Challenges)
- Crear, ver y editar retos
- 4 tipos: "Semana actual", "Reto general", "Reto urgente", "Reto mensual"
- Marcar como resuelto con nota de resolución y responsable
- Al resolver, automáticamente crea un win asociado
- Descargar todos los retos en CSV

### 3. Progreso Mensual
- Copa trofeo animada SVG que se llena según wins del mes
- Meta mensual: 20 wins (configurable en código)
- Mensajes motivacionales según porcentaje alcanzado
- Animación de pulso al llegar a la meta

### 4. Equipo y Clientes
**Miembros del equipo** (hardcoded):
`Natalia`, `Paulo`, `Eliana`, `Alejandro`, `Manuela`, `Laura`, `Valentina`, `Santiago`

**Clientes** (20+ nombres en dropdown)

---

## Componentes React

| Componente       | Descripción                                        |
|------------------|---------------------------------------------------|
| `Particle`       | Partícula de confetti animada                      |
| `ImperiansLogo`  | Muestra el logo de la agencia                      |
| `TrophyCup`      | Copa SVG con nivel de llenado dinámico             |
| `WinCard`        | Tarjeta de win con botón de editar                 |
| `ChallengeCard`  | Tarjeta de reto con botones de resolver/editar     |
| `AgencyWins`     | Componente principal — estado y lógica completa    |

---

## Estado (React Hooks)

```javascript
view              // 'wins' | 'challenges'
wins              // array de wins
challenges        // array de retos
loading           // boolean
error             // string | null
showWinForm       // boolean — modal crear win
showChallengeForm // boolean — modal crear reto
solveModal        // { id, description } | null
editWin           // win object | null
editChallenge     // challenge object | null
wf                // win form fields { description, category, author, client }
cf                // challenge form fields { description, week, author }
sf                // solve form fields { author, note }
ew                // edit win fields
ec                // edit challenge fields
particles         // array — confetti
```

---

## Design System

### Colores (CSS Variables)
```css
--bg:       #0d0d0d   /* Fondo principal */
--card:     #1a1a1a   /* Fondo tarjetas */
--gold:     #d4af37   /* Acento dorado */
--purple:   #7b5ea7   /* Acento púrpura */
--text:     #f0f0f0   /* Texto principal */
--subtext:  #888888   /* Texto secundario */
--border:   #2a2a2a   /* Bordes */
--success:  #4caf50   /* Verde éxito */
--danger:   #e53935   /* Rojo error/urgente */
```

### Tipografía
- Fuente: **Inter** (Google Fonts)
- Estilo general: dark theme con acentos dorado/púrpura

### Patrones UI
- Grid de tarjetas: `auto-fill, minmax(315px, 1fr)`
- Animaciones con `cubic-bezier` easing
- Actualizaciones optimistas (UI primero, backend async)
- Notificaciones de error descartables

---

## Responsividad

| Breakpoint   | Cambios                                   |
|--------------|------------------------------------------|
| `< 768px`    | Grid de 1 columna, navegación compacta   |
| `< 380px`    | Botones más pequeños, tipografía reducida |

---

## Convenciones de Código

- **Idioma UI:** Español
- Prefijo `at` para funciones de Airtable
- Constantes en UPPERCASE
- Variables y funciones en camelCase
- Validación de campos antes de enviar formularios
- Try-catch en todas las operaciones Airtable

---

## Archivos del Proyecto

```
Wins Equipo/
├── WinsEquipo.html          # App completa (toda la lógica aquí)
├── vercel.json              # Configuración Vercel
├── CLAUDE.md                # Este archivo
├── README.md                # Readme del proyecto
├── .gitignore
└── Branding Imperians/
    └── logo.png             # Logo de la agencia
```

---

## Notas Importantes para Desarrollo

1. **Token Airtable expuesto** en el código fuente — no es ideal para seguridad pero es aceptable para uso interno del equipo
2. **Sin bundler** — no usar `import/export`, todo debe ser funciones/variables en el mismo scope
3. **Sin npm** — no hay `package.json`, las dependencias van como `<script>` CDN en el HTML
4. **Datos del mes actual** se filtran en el frontend, no en Airtable (se traen todos los registros)
5. Al resolver un reto, se crea automáticamente un win con `fromChallenge: true`
6. Las fechas se formatean con un helper custom (`fmt(date)`) — formato "DD MMM YYYY" en español
