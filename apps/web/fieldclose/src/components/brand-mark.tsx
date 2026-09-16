import Image from "next/image";

type BrandMarkProps = {
  labelled?: boolean;
};

export function BrandMark({ labelled = false }: BrandMarkProps) {
  return (
    <Image
      alt={labelled ? "FieldClose" : ""}
      aria-hidden={labelled ? undefined : true}
      className="brand-mark"
      draggable={false}
      height="144"
      src="/brand/fieldclose-mark.svg"
      unoptimized
      width="144"
    />
  );
}
