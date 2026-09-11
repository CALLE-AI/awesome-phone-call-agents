import { FamilyWorkspaceView } from "../../FamilyWorkspaceView";
export default async function SeniorPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <FamilyWorkspaceView section="senior" seniorId={id} />; }
