import { FieldCloseWorkbench } from "@/components/fieldclose-workbench";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return (
    <FieldCloseWorkbench route={{ view: "audit", workspaceSlug }} />
  );
}
