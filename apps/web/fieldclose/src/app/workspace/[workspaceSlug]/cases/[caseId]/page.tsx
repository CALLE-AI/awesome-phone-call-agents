import { FieldCloseWorkbench } from "@/components/fieldclose-workbench";

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ caseId: string; workspaceSlug: string }>;
}) {
  const { caseId, workspaceSlug } = await params;

  return (
    <FieldCloseWorkbench
      route={{ caseId, view: "cases", workspaceSlug }}
    />
  );
}
