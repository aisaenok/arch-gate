const request = fetch;

export async function getApplication(id: string) {
  return request(`/api/applications/${id}`);
}
