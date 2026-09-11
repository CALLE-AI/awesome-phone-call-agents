import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { getOrCreateBrand } from "@/lib/brand";
import BrandSettings from "./_components/BrandSettings";

export const metadata = { title: "Brand — Settings — Arc Platform" };

/* The heading, the breadcrumb and the section nav belong to the layout now.
   This page is the Brand section and nothing else. */
export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const brand = await getOrCreateBrand(userId);

  return <BrandSettings initialName={brand.name} />;
}
