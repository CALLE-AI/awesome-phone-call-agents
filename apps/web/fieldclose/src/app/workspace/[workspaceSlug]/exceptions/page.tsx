import { FieldCloseWorkbench } from "@/components/fieldclose-workbench";

export default async function ExceptionsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return (
    <FieldCloseWorkbench route={{ view: "exceptions", workspaceSlug }} />
  );
}
