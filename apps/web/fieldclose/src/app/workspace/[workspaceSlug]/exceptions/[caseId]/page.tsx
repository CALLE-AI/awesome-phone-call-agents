import { FieldCloseWorkbench } from "@/components/fieldclose-workbench";

export default async function ExceptionDetailPage({
  params,
}: {
  params: Promise<{ caseId: string; workspaceSlug: string }>;
}) {
  const { caseId, workspaceSlug } = await params;

  return (
    <FieldCloseWorkbench
      route={{ caseId, view: "exceptions", workspaceSlug }}
    />
  );
}
