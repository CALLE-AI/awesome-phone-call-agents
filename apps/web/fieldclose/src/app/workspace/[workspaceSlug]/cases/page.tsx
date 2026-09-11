import { FieldCloseWorkbench } from "@/components/fieldclose-workbench";

export default async function CasesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return (
    <FieldCloseWorkbench route={{ view: "cases", workspaceSlug }} />
  );
}
