import Image from "next/image";
import mark from "./logo.png";

// The agentcall mark: a little black hole whose glowing disk doubles as a
// headset. app/icon.png and app/apple-icon.png are the same artwork.
export function Logo({ size, className = "" }: { size?: number; className?: string }) {
  return <Image src={mark} alt="" width={size} height={size} className={className} priority={!!size} />;
}
