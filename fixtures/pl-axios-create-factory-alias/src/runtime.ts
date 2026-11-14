import axios from "axios";

const createClient = axios.create;
const client = createClient();

export async function getApplication(id: string) {
  return client.get(`/api/applications/${id}`);
}
