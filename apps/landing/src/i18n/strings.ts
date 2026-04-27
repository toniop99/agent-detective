/** UI copy for the marketing landing (en + es). HTML fragments are authored here only — never from user input. */

export type Lang = 'en' | 'es';

export const langs: Lang[] = ['en', 'es'];

export const langStorageKey = 'ad-landing-lang';

export function isLang(value: string): value is Lang {
  return value === 'en' || value === 'es';
}

export type LandingStrings = {
  meta: { pageTitle: string; description: string };
  layout: {
    skipToContent: string;
    homeAria: string;
    themeInkAria: string;
    themeCasefileAria: string;
    themeLabelInk: string;
    themeLabelCasefile: string;
    navMain: string;
    docs: string;
    github: string;
    footerLicense: string;
    footerSource: string;
    footerDocs: string;
    languageNav: string;
    langEnglish: string;
    langSpanish: string;
  };
  client: {
    scrollNav: string;
    scrollStart: string;
    scrollPipeline: string;
    scrollEvidence: string;
    scrollDocket: string;
    scrollCta: string;
    toastCopied: string;
    themeAriaInk: string;
    themeAriaCasefile: string;
    themeLabelInk: string;
    themeLabelCasefile: string;
  };
  hero: {
    badgeOpenSource: string;
    badgeSelfHosted: string;
    badgePlugins: string;
    titleBefore: string;
    titleHighlight: string;
    titleAfter: string;
    subtitleHtml: string;
    readDocs: string;
    viewGithub: string;
    pullImage: string;
    copy: string;
    keyboardHint: string;
    metaLineHtml: string;
    exhibitLabel: string;
    heroImageAlt: string;
    starsAlt: string;
    licenseAlt: string;
  };
  pipeline: {
    headingCore: string;
    headingSources: string;
    body: string;
  };
  features: {
    sectionLabel: string;
    title: string;
    quote: string;
    figCaption: string;
    items: readonly { title: string; body: string }[];
  };
  flow: {
    sectionLabel: string;
    title: string;
    introHtml: string;
    steps: readonly string[];
  };
  cta: {
    title: string;
    bodyHtml: string;
    getStarted: string;
    openGithub: string;
  };
};

export const strings: Record<Lang, LandingStrings> = {
  en: {
    meta: {
      pageTitle:
        'Agent Detective | AI code analysis for Jira, Slack & your repo',
      description:
        'Event-driven AI code analysis. Plugins normalize Jira, Telegram, Slack and more; repo-grounded insight, optional PR automation, self-hosted observability.',
    },
    layout: {
      skipToContent: 'Skip to content',
      homeAria: 'Agent Detective home',
      themeInkAria: 'Use warm case file colors',
      themeCasefileAria: 'Use default night ink colors',
      themeLabelInk: 'Case file',
      themeLabelCasefile: 'Night',
      navMain: 'Main',
      docs: 'Docs',
      github: 'GitHub',
      footerLicense: 'MIT License',
      footerSource: 'Source on GitHub',
      footerDocs: 'Documentation',
      languageNav: 'Language',
      langEnglish: 'English',
      langSpanish: 'Español',
    },
    client: {
      scrollNav: 'On this page',
      scrollStart: 'Start',
      scrollPipeline: 'Pipeline',
      scrollEvidence: 'Case notes',
      scrollDocket: 'Docket',
      scrollCta: 'Get started',
      toastCopied: 'Copied to clipboard',
      themeAriaInk: 'Use warm case file colors',
      themeAriaCasefile: 'Use default night ink colors',
      themeLabelInk: 'Case file',
      themeLabelCasefile: 'Night',
    },
    hero: {
      badgeOpenSource: 'Open source',
      badgeSelfHosted: 'Self-hosted',
      badgePlugins: 'Plugin architecture',
      titleBefore: 'Triage at the ',
      titleHighlight: 'codebase',
      titleAfter: ', not just the ticket',
      subtitleHtml:
        'Your agents listen where work happens—<strong class="text-paper-50 font-medium">Jira, Telegram, Slack</strong>—and answer with <span class="text-evidence-300/90">grounded, repo-level insight</span>, not generic filler. One core; plugins and config define the rest.',
      readDocs: 'Read the docs',
      viewGithub: 'View on GitHub',
      pullImage: 'Pull image',
      copy: 'Copy',
      keyboardHint:
        'Press <kbd class="text-paper-200/60 border-paper-200/20 rounded border px-1 py-0.5">1</kbd>–<kbd class="text-paper-200/60 border-paper-200/20 rounded border px-1 py-0.5">5</kbd> to jump sections (desktop)',
      metaLineHtml:
        'Container-ready (GHCR), JSON + env configuration, Zod-typed options. <a class="text-evidence-300/80 hover:underline" href="/docs/config/configuration-hub">Configuration hub</a> · <a class="text-evidence-300/80 hover:underline" href="/docs/operator/docker/">Docker</a>',
      exhibitLabel: 'Exhibit A — case visualization',
      heroImageAlt:
        'Risograph-style artwork: magnifier, case tab, and code marks—triage, not stock tech art',
      starsAlt: 'GitHub star count for agent-detective',
      licenseAlt: 'Repository license',
    },
    pipeline: {
      headingCore: 'One core.',
      headingSources: ' Many sources.',
      body: 'Adapters and plugins turn webhooks and APIs into a single task shape—so the agent always runs the same way, no matter which tool rang the bell.',
    },
    features: {
      sectionLabel: 'Case notes',
      title: 'Built for real incidents, not slide decks',
      quote: '“One process from signal to story—tickets in, diffs and comments out.”',
      figCaption: 'Fig. 1 — risograph-style path: signal to write-up',
      items: [
        {
          title: 'Source-agnostic events',
          body: 'Webhooks and adapters become one task model—Jira, chat, or your own plugin. The agent runner does not care who knocked.',
        },
        {
          title: 'Repo-grounded analysis',
          body: 'Local repositories and matching connect incidents to the right tree. Output stays honest to the code you run.',
        },
        {
          title: 'Operator-ready',
          body: 'Fastify, health, metrics, structured logs, JSON and env. Ship with Docker from GHCR when you are done iterating locally.',
        },
      ],
    },
    flow: {
      sectionLabel: 'Docket',
      title: 'From webhook to well-grounded write-up',
      introHtml:
        'The same path every time: <strong class="text-paper-50">normalize</strong>, <strong class="text-paper-50">analyze</strong>, <strong class="text-paper-50">answer</strong>. You keep control of config, secrets, and where the model runs. Embed AI into your engineering workflow as a governed, extensible automation service.',
      steps: [
        'Event arrives: Jira, Slack, or your adapter—normalized into a single task model.',
        'The core agent uses local repo context and your matching rules to analyze and reason.',
        'Output where you need it: issue comments, optional PR flow, and full observability trail.',
      ],
    },
    cta: {
      title: 'Ready to wire your first incident?',
      bodyHtml:
        'The docs walk through plugins, <span class="text-paper-200/90 font-mono text-sm">config/default.json</span>, Docker, and production checks—no guesswork.',
      getStarted: 'Get started',
      openGithub: 'Open GitHub',
    },
  },
  es: {
    meta: {
      pageTitle:
        'Agent Detective | Análisis de código con IA para Jira, Slack y tu repo',
      description:
        'Análisis de código con IA orientado a eventos. Plugins normalizan Jira, Telegram, Slack y más; información anclada al repositorio, automatización opcional de PRs y observabilidad en tu propia infraestructura.',
    },
    layout: {
      skipToContent: 'Ir al contenido',
      homeAria: 'Inicio de Agent Detective',
      themeInkAria: 'Usar colores cálidos de expediente',
      themeCasefileAria: 'Usar colores nocturnos por defecto',
      themeLabelInk: 'Expediente',
      themeLabelCasefile: 'Noche',
      navMain: 'Principal',
      docs: 'Docs',
      github: 'GitHub',
      footerLicense: 'Licencia MIT',
      footerSource: 'Código en GitHub',
      footerDocs: 'Documentación',
      languageNav: 'Idioma',
      langEnglish: 'English',
      langSpanish: 'Español',
    },
    client: {
      scrollNav: 'En esta página',
      scrollStart: 'Inicio',
      scrollPipeline: 'Pipeline',
      scrollEvidence: 'Notas',
      scrollDocket: 'Expediente',
      scrollCta: 'Empezar',
      toastCopied: 'Copiado al portapapeles',
      themeAriaInk: 'Usar colores cálidos de expediente',
      themeAriaCasefile: 'Usar colores nocturnos por defecto',
      themeLabelInk: 'Expediente',
      themeLabelCasefile: 'Noche',
    },
    hero: {
      badgeOpenSource: 'Código abierto',
      badgeSelfHosted: 'Autoalojado',
      badgePlugins: 'Arquitectura de plugins',
      titleBefore: 'Triaje en la ',
      titleHighlight: 'base de código',
      titleAfter: ', no solo en el ticket',
      subtitleHtml:
        'Tus agentes escuchan donde ocurre el trabajo—<strong class="text-paper-50 font-medium">Jira, Telegram, Slack</strong>—y responden con <span class="text-evidence-300/90">contexto real del repositorio</span>, no relleno genérico. Un núcleo; plugins y configuración definen el resto.',
      readDocs: 'Leer la documentación',
      viewGithub: 'Ver en GitHub',
      pullImage: 'Imagen Docker',
      copy: 'Copiar',
      keyboardHint:
        'Pulsa <kbd class="text-paper-200/60 border-paper-200/20 rounded border px-1 py-0.5">1</kbd>–<kbd class="text-paper-200/60 border-paper-200/20 rounded border px-1 py-0.5">5</kbd> para saltar de sección (escritorio)',
      metaLineHtml:
        'Listo para contenedores (GHCR), JSON + variables de entorno, opciones tipadas con Zod. <a class="text-evidence-300/80 hover:underline" href="/docs/config/configuration-hub">Centro de configuración</a> · <a class="text-evidence-300/80 hover:underline" href="/docs/operator/docker/">Docker</a>',
      exhibitLabel: 'Exhibit A — visualización del caso',
      heroImageAlt:
        'Ilustración estilo risografía: lupa, pestaña de caso y marcas en el código—triaje, no arte genérico',
      starsAlt: 'Estrellas de GitHub del repositorio agent-detective',
      licenseAlt: 'Licencia del repositorio',
    },
    pipeline: {
      headingCore: 'Un núcleo.',
      headingSources: ' Muchas fuentes.',
      body: 'Adaptadores y plugins convierten webhooks y APIs en una misma forma de tarea: el agente siempre se ejecuta igual, sea cual sea la herramienta que tocó la campana.',
    },
    features: {
      sectionLabel: 'Notas del caso',
      title: 'Pensado para incidentes reales, no para diapositivas',
      quote: '“Un solo flujo de la señal al informe: entran tickets, salen diffs y comentarios.”',
      figCaption: 'Fig. 1 — camino estilo risografía: de la señal al informe',
      items: [
        {
          title: 'Eventos independientes de la fuente',
          body: 'Webhooks y adaptadores se unifican en un modelo de tarea: Jira, chat o tu propio plugin. Al ejecutor del agente no le importa quién llamó.',
        },
        {
          title: 'Análisis anclado al repo',
          body: 'Repositorios locales y reglas de coincidencia conectan el incidente con el árbol correcto. La salida se mantiene fiel al código que ejecutas.',
        },
        {
          title: 'Listo para operaciones',
          body: 'Fastify, salud, métricas, logs estructurados, JSON y entorno. Despliega con Docker desde GHCR cuando termines de iterar en local.',
        },
      ],
    },
    flow: {
      sectionLabel: 'Expediente',
      title: 'Del webhook al informe bien fundamentado',
      introHtml:
        'El mismo camino siempre: <strong class="text-paper-50">normalizar</strong>, <strong class="text-paper-50">analizar</strong>, <strong class="text-paper-50">responder</strong>. Tú controlas la configuración, los secretos y dónde corre el modelo. Integra la IA en tu flujo de ingeniería como un servicio gobernado y extensible.',
      steps: [
        'Llega el evento: Jira, Slack o tu adaptador—normalizado a un único modelo de tarea.',
        'El agente del núcleo usa el contexto del repo local y tus reglas de matching para analizar y razonar.',
        'Salida donde la necesitas: comentarios en incidencias, flujo opcional de PRs y trazabilidad completa de observabilidad.',
      ],
    },
    cta: {
      title: '¿Listo para conectar tu primer incidente?',
      bodyHtml:
        'La documentación recorre plugins, <span class="text-paper-200/90 font-mono text-sm">config/default.json</span>, Docker y comprobaciones de producción—sin adivinar.',
      getStarted: 'Empezar',
      openGithub: 'Abrir GitHub',
    },
  },
};

export function landingPath(lang: Lang): string {
  return `/${lang}/`;
}
