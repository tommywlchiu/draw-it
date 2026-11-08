import { ART } from "./index";

// Renders one of the game's hand-built cartoon drawings. The markup is our own, never user input.
export function Art({ name, className = "" }: { name: string; className?: string }) {
  const svg = ART[name];
  if (!svg) return null;
  return <svg className={`art ${className}`} viewBox="0 0 120 120" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const hasArt = (name: string) => name in ART;
