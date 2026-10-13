import React from 'react';

interface BookLogoProps {
  className?: string;
  size?: number;
}

export const BookLogo: React.FC<BookLogoProps> = ({ className = "text-[#fbbf24]", size = 56 }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 64 64" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Reliure et couverture du livre */}
      <rect 
        x="12" 
        y="8" 
        width="40" 
        height="48" 
        rx="5" 
        stroke="currentColor" 
        strokeWidth="3.5" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
      />
      {/* Tranche / dos du livre à gauche */}
      <line 
        x1="19" 
        y1="8" 
        x2="19" 
        y2="56" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
      />
      {/* Ruban marque-page en haut */}
      <path 
        d="M26 8V18L30 15L34 18V8" 
        stroke="currentColor" 
        strokeWidth="2.5" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        fill="currentColor"
        fillOpacity="0.2"
      />
      {/* Lettre A élégante au centre */}
      <path 
        d="M26 43L32 25L38 43" 
        stroke="currentColor" 
        strokeWidth="3.2" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
      />
      <line 
        x1="28" 
        y1="37" 
        x2="36" 
        y2="37" 
        stroke="currentColor" 
        strokeWidth="2.8" 
        strokeLinecap="round" 
      />
    </svg>
  );
};
