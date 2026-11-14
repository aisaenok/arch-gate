import axios from "axios";

const client = axios.create();

export async function getApplication(id: string) {
  return client.get(`/api/applications/${id}`);
}
