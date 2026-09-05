import { redirect } from "next/navigation";

export default async function RepoEndpointsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/repos/${id}/definition`);
}
