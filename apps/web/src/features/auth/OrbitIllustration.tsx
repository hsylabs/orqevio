/**
 * Brand illustration: agents orbit tasks and documents; the vault sits
 * outside their path, sealed. Purely decorative.
 */
export function OrbitIllustration() {
  return (
    <svg viewBox="0 0 420 420" className="h-auto w-full max-w-[420px]" role="img" aria-label="Los agentes orbitan tus tareas y documentos; la bóveda queda fuera de su alcance">
      <defs>
        <radialGradient id="core" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="var(--ink)" stopOpacity="0.92" />
          <stop offset="100%" stopColor="var(--ink)" />
        </radialGradient>
      </defs>
      <circle cx="210" cy="210" r="168" fill="none" stroke="var(--line-strong)" strokeDasharray="2 7" strokeLinecap="round" />
      <circle cx="210" cy="210" r="104" fill="none" stroke="var(--line-strong)" />

      {/* Agent travelling on the outer orbit */}
      <g className="orbit-spin" style={{ transformOrigin: '210px 210px' }}>
        <circle cx="210" cy="42" r="15" fill="var(--agent)" opacity="0.14" />
        <circle cx="210" cy="42" r="8" fill="var(--agent)" />
        <path d="M206.5 42h7M210 38.5v7" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
      </g>

      {/* Inner modules */}
      <g>
        <circle cx="118" cy="162" r="25" fill="var(--surface)" stroke="var(--line-strong)" />
        <rect x="106" y="152" width="7" height="19" rx="2" fill="var(--accent)" />
        <rect x="115.5" y="152" width="7" height="13" rx="2" fill="var(--accent)" opacity="0.6" />
        <rect x="125" y="152" width="7" height="9" rx="2" fill="var(--accent)" opacity="0.35" />
        <text x="118" y="206" textAnchor="middle" className="fill-ink-2 text-[15px] font-medium">Tareas</text>
      </g>
      <g>
        <circle cx="302" cy="162" r="25" fill="var(--surface)" stroke="var(--line-strong)" />
        <rect x="291" y="150" width="22" height="25" rx="3" fill="none" stroke="var(--ink-2)" strokeWidth="1.8" />
        <path d="M296 158h12M296 163h12M296 168h7" stroke="var(--ink-2)" strokeWidth="1.8" strokeLinecap="round" />
        <text x="302" y="206" textAnchor="middle" className="fill-ink-2 text-[15px] font-medium">Documentos</text>
      </g>

      {/* Core */}
      <circle cx="210" cy="226" r="34" fill="url(#core)" />
      <path d="M220.5 214.5A14 14 0 1 0 224.5 226" fill="none" stroke="var(--sheet)" strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="222.6" cy="212.6" r="3.6" fill="var(--accent)" />

      {/* Sealed vault, beyond the agent orbit */}
      <g>
        <circle cx="372" cy="356" r="34" fill="var(--sheet)" stroke="var(--ok)" strokeWidth="1.5" strokeDasharray="3 4" />
        <rect x="359" y="352" width="26" height="20" rx="5" fill="var(--ink)" />
        <path d="M364 352v-5a8 8 0 0 1 16 0v5" fill="none" stroke="var(--ink)" strokeWidth="3" />
        <circle cx="372" cy="361" r="2.6" fill="var(--sheet)" />
        <text x="372" y="408" textAnchor="middle" className="fill-ink-2 text-[15px] font-medium">Bóveda</text>
      </g>
      <style>{`
        .orbit-spin { animation: orbit 18s linear infinite; }
        @keyframes orbit { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .orbit-spin { animation: none; } }
      `}</style>
    </svg>
  )
}
