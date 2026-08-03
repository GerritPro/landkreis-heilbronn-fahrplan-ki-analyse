import React from "react";

interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
}

export const Logo: React.FC<LogoProps> = ({
  className = "",
  showText = true,
  size = "md",
}) => {
  const heightMap = {
    sm: "h-8",
    md: "h-11",
    lg: "h-16",
  };

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* SVG Emblem recreating Landkreis Heilbronn Logo */}
      <svg
        viewBox="0 0 380 150"
        className={`${heightMap[size]} w-auto object-contain transition-transform hover:scale-102`}
        aria-label="Landkreis Heilbronn Logo"
      >
        <g id="logo-bars">
          {/* Red Angle Bracket Frame */}
          <path
            d="M 15,120 L 15,20 L 145,20 L 145,120 L 120,120 L 120,44 L 40,44 L 40,120 Z"
            fill="#E30613"
          />
          {/* 3 Vertical Bars: Green, Light Green/Lime, Yellow */}
          <rect x="165" y="20" width="24" height="100" fill="#82B822" rx="1" />
          <rect x="202" y="20" width="24" height="100" fill="#A7D02A" rx="1" />
          <rect x="239" y="20" width="24" height="100" fill="#E6D815" rx="1" />
        </g>
        {showText && (
          <text
            x="130"
            y="145"
            fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            fontWeight="900"
            fontSize="25"
            fill="#111827"
            letterSpacing="0.8"
          >
            LANDKREIS HEILBRONN
          </text>
        )}
      </svg>
    </div>
  );
};
