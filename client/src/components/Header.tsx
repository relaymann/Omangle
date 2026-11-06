import LogoContent from "./LogoContent";
import { ModeToggle } from "./ModeToggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-5 sm:px-8 py-3 border-b border-orange-500/30 shadow-sm bg-white dark:bg-black w-full h-16">
      <a href="/" aria-label="Omangle home" className="flex items-center gap-3">
        <svg viewBox="0 0 100 100" role="img" aria-label="Omangle mark" className="h-10 w-10 rounded-md">
          <LogoContent />
        </svg>
        <span className="text-xl font-medium tracking-[0.18em] text-black dark:text-white">OMANGLE</span>
      </a>
      <ModeToggle />
    </header>
  );
}
