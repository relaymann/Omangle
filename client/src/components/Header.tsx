import { ModeToggle } from "./ModeToggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-5 sm:px-8 py-3 border-b border-orange-500/30 shadow-sm bg-white dark:bg-black w-full h-16">
      <a href="/" aria-label="Omangle home" className="flex h-12 w-[min(52vw,220px)] items-center overflow-hidden">
        <img src="/logo.png" alt="Omangle" className="h-auto w-full object-cover" />
      </a>
      <ModeToggle />
    </header>
  );
}
