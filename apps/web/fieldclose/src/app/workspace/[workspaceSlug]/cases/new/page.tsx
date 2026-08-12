import { FieldCloseWorkbench } from "@/components/fieldclose-workbench";

export default async function NewCasePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return (
    <FieldCloseWorkbench
      route={{ newCase: true, view: "cases", workspaceSlug }}
    />
  );
}
