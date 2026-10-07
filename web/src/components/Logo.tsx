/**
 * Marca JR Saúde: brasão com monograma "JR", estetoscópio e linha de
 * batimento cardíaco — redesenhado em vetor a partir da fachada e da recepção.
 */
export function LogoMark({ size = 56, color = 'currentColor', accent = 'var(--gold-500)', title }: { size?: number; color?: string; accent?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size * 1.12}
      viewBox="0 0 100 112"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {/* brasão */}
      <path
        d="M50 4 L90 14 C91 15 92 16 92 18 V52 C92 78 74 96 50 108 C26 96 8 78 8 52 V18 C8 16 9 15 10 14 Z"
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* estetoscópio (arco + olivas) */}
      <path d="M36 20 C36 13 44 11 50 15 C56 11 64 13 64 20" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="36" cy="21.5" r="2.4" fill={color} />
      <circle cx="64" cy="21.5" r="2.4" fill={color} />
      {/* monograma */}
      <text
        x="50"
        y="66"
        textAnchor="middle"
        fontFamily="'Cormorant Garamond', Georgia, serif"
        fontWeight="700"
        fontSize="40"
        fill={color}
        letterSpacing="-2"
      >
        JR
      </text>
      {/* linha de batimento */}
      <path
        d="M22 80 H40 L44 72 L49 88 L54 66 L58 80 H78"
        fill="none"
        stroke={accent}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ name = 'JR SAÚDE', small }: { name?: string; small?: boolean }) {
  return (
    <span className={small ? 'wordmark wordmark-sm' : 'wordmark'} translate="no">
      {name}
    </span>
  );
}

/** Logo enviado pela clínica (se houver) ou a marca vetorial. */
export function ClinicLogo({ logoUrl, size = 44, color, accent, name }: { logoUrl?: string | null; size?: number; color?: string; accent?: string; name: string }) {
  if (logoUrl) return <img src={logoUrl} alt={name} style={{ height: size * 1.12, width: 'auto' }} />;
  return <LogoMark size={size} color={color} accent={accent} title={name} />;
}
