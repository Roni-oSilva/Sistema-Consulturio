import { useId } from 'react';

/**
 * Ilustrações "de vidro" (gradientes azul → ciano com brilho limão),
 * no espírito das renderizações 3D da referência, desenhadas em SVG.
 */
function Defs({ id, dark }: { id: string; dark?: boolean }) {
  return (
    <defs>
      <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={dark ? '#e4f1ff' : '#9fd0ff'} />
        <stop offset="0.55" stopColor={dark ? '#8cc4f5' : '#3d8fe0'} />
        <stop offset="1" stopColor={dark ? '#3f86cf' : '#0a4c9a'} />
      </linearGradient>
      <radialGradient id={`${id}-glow`} cx="0.5" cy="0.55" r="0.5">
        <stop offset="0" stopColor="#7dffa0" stopOpacity="0.95" />
        <stop offset="0.6" stopColor="#48e26e" stopOpacity="0.35" />
        <stop offset="1" stopColor="#48e26e" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="10" stdDeviation="8" floodColor="#0a3a6e" floodOpacity="0.28" />
      </filter>
    </defs>
  );
}

/** Coração de vidro com estetoscópio — consultas */
export function ArtHeart({ dark }: { dark?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 160 150" aria-hidden="true">
      <Defs id={id} dark={dark} />
      <g filter={`url(#${id}-soft)`}>
        <path
          d="M80 132 C40 104 14 82 14 54 C14 33 30 18 50 18 C63 18 73 25 80 36 C87 25 97 18 110 18 C130 18 146 33 146 54 C146 82 120 104 80 132 Z"
          fill={`url(#${id}-body)`}
          stroke="#ffffff"
          strokeOpacity="0.7"
          strokeWidth="2"
        />
        <ellipse cx="80" cy="74" rx="44" ry="34" fill={`url(#${id}-glow)`} />
        <path d="M34 50 C36 36 46 29 58 30" fill="none" stroke={`url(#${id}-shine)`} strokeWidth="9" strokeLinecap="round" />
        <path d="M52 74 H68 L74 62 L82 88 L90 68 L95 74 H110" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** Coluna de vidro — fisioterapia / atendimentos */
export function ArtSpine({ dark }: { dark?: boolean }) {
  const id = useId().replace(/:/g, '');
  const vert = [
    { x: 66, y: 12, w: 40 },
    { x: 60, y: 38, w: 44 },
    { x: 54, y: 64, w: 48 },
    { x: 52, y: 90, w: 50 },
    { x: 56, y: 116, w: 48 },
  ];
  return (
    <svg viewBox="0 0 160 150" aria-hidden="true">
      <Defs id={id} dark={dark} />
      <g filter={`url(#${id}-soft)`}>
        {vert.map((v, i) => (
          <g key={i}>
            <rect x={v.x} y={v.y} width={v.w} height="20" rx="9" fill={`url(#${id}-body)`} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.5" />
            <rect x={v.x + 6} y={v.y + 3} width={v.w * 0.45} height="5" rx="2.5" fill="#ffffff" opacity="0.6" />
            {i < vert.length - 1 && <ellipse cx={v.x + v.w / 2} cy={v.y + 23} rx={v.w * 0.32} ry="3.2" fill="#6afa8a" opacity="0.9" />}
          </g>
        ))}
        <ellipse cx="80" cy="76" rx="50" ry="56" fill={`url(#${id}-glow)`} opacity="0.45" />
      </g>
    </svg>
  );
}

/** Tubo de ensaio de vidro com batimento — exames */
export function ArtTube({ dark }: { dark?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 160 150" aria-hidden="true">
      <Defs id={id} dark={dark} />
      <g filter={`url(#${id}-soft)`} transform="rotate(-18 80 75)">
        <rect x="62" y="8" width="36" height="12" rx="5" fill="#ffffff" opacity="0.95" />
        <path d="M66 20 H94 V112 C94 124 87 132 80 132 C73 132 66 124 66 112 Z" fill={`url(#${id}-body)`} opacity="0.55" stroke="#ffffff" strokeWidth="2" />
        <path d="M66 70 H94 V112 C94 124 87 132 80 132 C73 132 66 124 66 112 Z" fill="#6afa8a" opacity="0.85" />
        <ellipse cx="80" cy="70" rx="14" ry="3" fill="#b8fcc8" />
        <rect x="70" y="26" width="6" height="80" rx="3" fill="#ffffff" opacity="0.55" />
      </g>
      <path d="M18 104 H44 L52 88 L62 120 L72 96 L78 104 H142" fill="none" stroke={dark ? '#ffffff' : '#2f78c4'} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}
