const base = fetch;
const request = base;

export async function getApplication(id: string) {
  return request(`/api/applications/${id}`);
}
