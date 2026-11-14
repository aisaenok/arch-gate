import axios from "axios";

const client = axios;

export async function getApplication(id: string) {
  return client.get(`/api/applications/${id}`);
}
