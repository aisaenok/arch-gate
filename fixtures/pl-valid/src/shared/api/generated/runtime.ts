export async function getApplication(id: string): Promise<unknown> {
  return fetch(`/applications/${id}`);
}
