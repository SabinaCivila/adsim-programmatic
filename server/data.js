// Catálogos y constantes del mundo simulado.
// Todo lo que sea "contenido" del mercado (segmentos, intereses, eventos disponibles)
// vive aquí para poder ajustarlo sin tocar la lógica del motor.

const EDADES = ['18-24', '25-34', '35-44', '45-54'];
const UBICACIONES = ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Bilbao', 'Las Palmas'];
const DISPOSITIVOS = ['movil', 'ordenador', 'tablet'];
const INTERESES = ['tecnologia', 'viajes', 'alimentacion', 'moda', 'deporte', 'finanzas', 'educacion', 'entretenimiento'];
const HORARIOS = ['manana', 'tarde', 'noche'];
const TIPOS_CONTENIDO = ['redes_sociales', 'video', 'busqueda', 'noticias', 'blog'];
const FORMATOS = ['banner', 'video', 'native', 'social'];

const OBJETIVOS = [
  { id: 'impresiones', label: 'Maximizar impresiones' },
  { id: 'clics', label: 'Generar clics' },
  { id: 'conversiones', label: 'Conseguir conversiones' },
  { id: 'roas', label: 'Maximizar ROAS' },
  { id: 'notoriedad', label: 'Notoriedad de marca (alcance)' },
  { id: 'cpc_bajo', label: 'Minimizar CPC' },
  { id: 'cpa_bajo', label: 'Minimizar CPA' },
];

const ESTRATEGIAS = [
  { id: 'cpm_fijo', label: 'CPM fijo (pujar cerca del máximo siempre)' },
  { id: 'maximizar_conversiones', label: 'Maximizar conversiones (puja más alto en oportunidades con más probabilidad de convertir)' },
  { id: 'maximizar_alcance', label: 'Maximizar alcance (pujar bajo para estirar el presupuesto)' },
  { id: 'cpa_objetivo', label: 'CPA objetivo (ajusta la puja para no superar un coste por conversión)' },
  { id: 'roas_objetivo', label: 'ROAS objetivo (ajusta la puja según el ingreso esperado)' },
];

// Precio base "de mercado" por impresión (euros) y CTR/CVR base por interés.
// Son los valores que los eventos de mercado y la demanda pueden multiplicar.
const SEGMENT_BASE = {
  tecnologia: { baseCPM: 1.6, baseCTR: 0.045, baseCVR: 0.06, revenuePerConversion: 60 },
  viajes: { baseCPM: 2.1, baseCTR: 0.035, baseCVR: 0.05, revenuePerConversion: 80 },
  alimentacion: { baseCPM: 1.1, baseCTR: 0.05, baseCVR: 0.08, revenuePerConversion: 25 },
  moda: { baseCPM: 1.4, baseCTR: 0.055, baseCVR: 0.07, revenuePerConversion: 45 },
  deporte: { baseCPM: 1.3, baseCTR: 0.04, baseCVR: 0.06, revenuePerConversion: 35 },
  finanzas: { baseCPM: 2.4, baseCTR: 0.02, baseCVR: 0.03, revenuePerConversion: 100 },
  educacion: { baseCPM: 1.2, baseCTR: 0.03, baseCVR: 0.05, revenuePerConversion: 50 },
  entretenimiento: { baseCPM: 1.0, baseCTR: 0.06, baseCVR: 0.09, revenuePerConversion: 20 },
};

// Biblioteca de eventos que el profesor puede activar.
// `target` indica sobre qué interés actúan (o 'global' para todos).
// `effect` describe qué multiplican: demanda (sube CPM/competencia), ctr o cvr.
const EVENTOS = [
  { id: 'tendencia_viral', label: 'Tendencia viral', description: 'Un influencer se vuelve viral y dispara la demanda del segmento.', effect: 'demand', multiplier: 1.8, defaultDurationMs: 90000 },
  { id: 'crisis_reputacion', label: 'Crisis de reputación', description: 'Una polémica hunde temporalmente el CTR del segmento.', effect: 'ctr', multiplier: 0.5, defaultDurationMs: 60000 },
  { id: 'cambio_algoritmo', label: 'Cambio de algoritmo', description: 'La plataforma cambia su algoritmo: el CTR general se vuelve más impredecible y baja.', effect: 'ctr', multiplier: 0.7, defaultDurationMs: 75000 },
  { id: 'aumento_competencia', label: 'Aumento de competencia', description: 'Nuevos anunciantes entran al segmento: sube la demanda y el CPM.', effect: 'demand', multiplier: 1.5, defaultDurationMs: 90000 },
  { id: 'audiencia_rentable', label: 'Audiencia inesperadamente rentable', description: 'Este segmento convierte mucho mejor de lo normal.', effect: 'cvr', multiplier: 1.6, defaultDurationMs: 75000 },
  { id: 'subida_cpm', label: 'Subida del CPM', description: 'El precio base de las impresiones del segmento sube.', effect: 'demand', multiplier: 1.4, defaultDurationMs: 60000 },
  { id: 'caida_ctr', label: 'Caída del CTR', description: 'El CTR del segmento cae de forma generalizada.', effect: 'ctr', multiplier: 0.6, defaultDurationMs: 60000 },
  { id: 'evento_deportivo', label: 'Evento deportivo', description: 'Gran evento deportivo: sube demanda y CTR del segmento deporte/entretenimiento.', effect: 'demand_ctr', multiplier: 1.5, defaultDurationMs: 90000 },
  { id: 'influencer_viral', label: 'Influencer viral', description: 'Un influencer concreto dispara el CTR del segmento.', effect: 'ctr', multiplier: 1.7, defaultDurationMs: 75000 },
  { id: 'cambio_consumidor', label: 'Cambio de comportamiento del consumidor', description: 'Los usuarios convierten menos de lo habitual en el segmento.', effect: 'cvr', multiplier: 0.6, defaultDurationMs: 75000 },
];

const CRITERIOS_RANKING = [
  { id: 'conversions', label: 'Conversiones totales' },
  { id: 'roas', label: 'ROAS' },
  { id: 'ctr', label: 'CTR' },
  { id: 'cpaInverse', label: 'CPA (menor es mejor)' },
  { id: 'efficiency', label: 'Eficiencia presupuestaria (ingreso / gasto)' },
  { id: 'objectiveCompliance', label: 'Cumplimiento del objetivo declarado' },
];

module.exports = {
  EDADES, UBICACIONES, DISPOSITIVOS, INTERESES, HORARIOS, TIPOS_CONTENIDO, FORMATOS,
  OBJETIVOS, ESTRATEGIAS, SEGMENT_BASE, EVENTOS, CRITERIOS_RANKING,
};
