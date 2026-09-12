interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className = '' }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 247 195"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`object-contain mix-blend-difference ${className}`}
    >
      <path d="M185.5 0C195.165 0 203 7.83502 203 17.5C203 27.165 195.165 35 185.5 35H17.5C7.83502 35 0 27.165 0 17.5C0 7.83502 7.83502 0 17.5 0H185.5Z" fill="white" />
      <path d="M229.5 80C239.165 80 247 87.835 247 97.5C247 107.165 239.165 115 229.5 115L139.5 115C129.835 115 122 107.165 122 97.5C122 87.835 129.835 80 139.5 80L229.5 80Z" fill="white" />
      <path d="M93.5 80C103.165 80 111 87.835 111 97.5C111 107.165 103.165 115 93.5 115H60.5C50.835 115 43 107.165 43 97.5C43 87.835 50.835 80 60.5 80H93.5Z" fill="white" />
      <path d="M185.5 160C195.165 160 203 167.835 203 177.5C203 187.165 195.165 195 185.5 195H17.5C7.83502 195 0 187.165 0 177.5C0 167.835 7.83502 160 17.5 160H185.5Z" fill="white" />
    </svg>
  );
}